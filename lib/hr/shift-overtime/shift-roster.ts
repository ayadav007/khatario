import { query, queryOne, queryRows } from '@/lib/db';
import { attendanceDateYmd } from '@/lib/hr/attendance-date';
import { isWeeklyOffForEmployee } from '@/lib/hr/shift-overtime/weekly-off';
import { isHolidayForEmployee } from '@/lib/hr/shift-overtime/holiday-lists';
import {
  DEFAULT_SHIFT_ROSTER_SETTINGS,
  type RosterCell,
  type ShiftRosterEntry,
  type ShiftRosterSettings,
} from '@/lib/hr/shift-overtime/shift-roster-shared';

export type { RosterCell, ShiftRosterEntry, ShiftRosterSettings } from '@/lib/hr/shift-overtime/shift-roster-shared';

const DEFAULT_ROSTER_SETTINGS = DEFAULT_SHIFT_ROSTER_SETTINGS;

export function parseShiftRosterSettings(raw: unknown): ShiftRosterSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ROSTER_SETTINGS };
  const o = raw as Record<string, unknown>;
  return {
    auto_mark_absent: o.auto_mark_absent !== false,
    absent_grace_minutes_after_shift_start: Math.max(
      0,
      Number(o.absent_grace_minutes_after_shift_start ?? 120),
    ),
  };
}

export async function getShiftRosterSettings(businessId: string): Promise<ShiftRosterSettings> {
  const row = await queryOne<{ shift_roster_settings: unknown }>(
    `SELECT shift_roster_settings FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return parseShiftRosterSettings(row?.shift_roster_settings);
}

export async function saveShiftRosterSettings(
  businessId: string,
  settings: ShiftRosterSettings,
): Promise<ShiftRosterSettings> {
  const parsed = parseShiftRosterSettings(settings);
  await queryOne(
    `UPDATE business_settings SET shift_roster_settings = $2::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1`,
    [businessId, JSON.stringify(parsed)],
  );
  return parsed;
}

export function weekDatesFromStart(weekStartYmd: string): string[] {
  const [y, m, d] = weekStartYmd.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    return attendanceDateYmd(dt);
  });
}

export function normalizeWeekStart(dateOrWeekStart: string): string {
  const [y, m, d] = dateOrWeekStart.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return attendanceDateYmd(dt);
}

export async function fetchRosterWeek(input: {
  businessId: string;
  weekStart: string;
  department?: string;
  branchId?: string;
  employeeIds?: string[];
}) {
  const weekStart = normalizeWeekStart(input.weekStart);
  const days = weekDatesFromStart(weekStart);
  const weekEnd = days[6];

  let empSql = `
    SELECT e.id, e.employee_code, u.name AS employee_name, e.department, e.default_shift_id
    FROM employees e
    INNER JOIN users u ON u.id = e.id
    WHERE e.business_id = $1 AND e.is_active = true`;
  const empParams: unknown[] = [input.businessId];

  if (input.department) {
    empParams.push(input.department);
    empSql += ` AND e.department = $${empParams.length}`;
  }
  if (input.branchId) {
    empParams.push(input.branchId);
    empSql += ` AND e.branch_id = $${empParams.length}`;
  }
  if (input.employeeIds?.length) {
    const placeholders = input.employeeIds.map((_, i) => `$${empParams.length + i + 1}`).join(', ');
    empParams.push(...input.employeeIds);
    empSql += ` AND e.id IN (${placeholders})`;
  }
  empSql += ` ORDER BY u.name`;

  const employees = await queryRows<{
    id: string;
    employee_code: string;
    employee_name: string;
    department: string | null;
    default_shift_id: string | null;
  }>(empSql, empParams);

  const rosterRows = await queryRows<{
    employee_id: string;
    roster_date: string;
    shift_id: string | null;
    is_day_off: boolean;
    shift_name: string | null;
    start_time: string | null;
    end_time: string | null;
  }>(
    `SELECT r.employee_id, r.roster_date::text, r.shift_id, r.is_day_off,
            s.shift_name, s.start_time::text, s.end_time::text
     FROM shift_roster_entries r
     LEFT JOIN shifts s ON s.id = r.shift_id
     WHERE r.business_id = $1 AND r.roster_date >= $2::date AND r.roster_date <= $3::date`,
    [input.businessId, weekStart, weekEnd],
  );

  const cells: Record<string, RosterCell> = {};
  for (const row of rosterRows) {
    cells[`${row.employee_id}|${row.roster_date.slice(0, 10)}`] = {
      shift_id: row.shift_id,
      is_day_off: row.is_day_off,
      shift_name: row.shift_name,
      start_time: row.start_time,
      end_time: row.end_time,
    };
  }

  const shifts = await queryRows<{
    id: string;
    shift_name: string;
    start_time: string;
    end_time: string;
  }>(
    `SELECT id, shift_name, start_time::text, end_time::text
     FROM shifts WHERE business_id = $1 AND is_active = true ORDER BY start_time`,
    [input.businessId],
  );

  return { week_start: weekStart, week_end: weekEnd, days, employees, cells, shifts };
}

export async function upsertRosterEntries(
  businessId: string,
  entries: ShiftRosterEntry[],
  assignedBy?: string,
): Promise<number> {
  let count = 0;
  for (const entry of entries) {
    if (!entry.employee_id || !entry.roster_date) continue;
    const isDayOff = entry.is_day_off === true;
    const shiftId = isDayOff ? null : entry.shift_id ?? null;

    await queryOne(
      `INSERT INTO shift_roster_entries (
         business_id, employee_id, roster_date, shift_id, is_day_off, assigned_by, notes, updated_at
       ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (business_id, employee_id, roster_date)
       DO UPDATE SET
         shift_id = EXCLUDED.shift_id,
         is_day_off = EXCLUDED.is_day_off,
         assigned_by = EXCLUDED.assigned_by,
         notes = EXCLUDED.notes,
         updated_at = CURRENT_TIMESTAMP`,
      [
        businessId,
        entry.employee_id,
        entry.roster_date.slice(0, 10),
        shiftId,
        isDayOff,
        assignedBy ?? null,
        entry.notes ?? null,
      ],
    );
    count++;
  }
  return count;
}

/** Fill week from default shift + weekly off / holidays as day off. */
export async function fillRosterFromDefaults(
  businessId: string,
  weekStart: string,
  assignedBy?: string,
  filters?: { department?: string; branchId?: string },
): Promise<number> {
  const { employees, days } = await fetchRosterWeek({
    businessId,
    weekStart,
    department: filters?.department,
    branchId: filters?.branchId,
  });

  const entries: ShiftRosterEntry[] = [];
  for (const emp of employees) {
    for (const day of days) {
      const weeklyOff = await isWeeklyOffForEmployee(businessId, emp.id, day);
      const holiday = await isHolidayForEmployee(businessId, emp.id, day);
      if (weeklyOff || holiday) {
        entries.push({
          business_id: businessId,
          employee_id: emp.id,
          roster_date: day,
          shift_id: null,
          is_day_off: true,
        });
      } else if (emp.default_shift_id) {
        entries.push({
          business_id: businessId,
          employee_id: emp.id,
          roster_date: day,
          shift_id: emp.default_shift_id,
          is_day_off: false,
        });
      }
    }
  }
  return upsertRosterEntries(businessId, entries, assignedBy);
}

export async function getRosterEntryForDate(
  businessId: string,
  employeeId: string,
  dateStr: string,
): Promise<{ shift_id: string | null; is_day_off: boolean } | null> {
  const row = await queryOne<{ shift_id: string | null; is_day_off: boolean }>(
    `SELECT shift_id, is_day_off FROM shift_roster_entries
     WHERE business_id = $1 AND employee_id = $2 AND roster_date = $3::date`,
    [businessId, employeeId, dateStr],
  );
  return row ?? null;
}

export async function isExpectedWorkDay(
  businessId: string,
  employeeId: string,
  dateStr: string,
): Promise<boolean> {
  const roster = await getRosterEntryForDate(businessId, employeeId, dateStr);
  if (roster) return !roster.is_day_off && !!roster.shift_id;

  if (await isWeeklyOffForEmployee(businessId, employeeId, dateStr)) return false;
  if (await isHolidayForEmployee(businessId, employeeId, dateStr)) return false;

  const emp = await queryOne<{ default_shift_id: string | null }>(
    `SELECT default_shift_id FROM employees WHERE id = $1 AND business_id = $2`,
    [employeeId, businessId],
  );
  return !!emp?.default_shift_id;
}
