import { query, queryOne, queryRows } from '@/lib/db';
import { attendanceDateYmd } from '@/lib/hr/attendance-date';
import { getShiftRosterSettings } from '@/lib/hr/shift-overtime/shift-roster';

function addMinutesToTime(timeStr: string, minutes: number): string {
  const [h, m, s] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:${String(s ?? 0).padStart(2, '0')}`;
}

function istNowParts(): { dateYmd: string; timeStr: string } {
  const now = new Date();
  const dateYmd = attendanceDateYmd(now);
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
  return { dateYmd, timeStr: timeStr.length >= 8 ? timeStr.slice(0, 8) : `${timeStr}:00` };
}

/**
 * Mark absent for rostered work days with no check-in after grace period.
 */
export async function runShiftRosterAbsentMarking(options?: {
  businessId?: string;
  targetDate?: string;
}): Promise<{ marked: number; skipped: number }> {
  let marked = 0;
  let skipped = 0;

  const targetDate =
    options?.targetDate ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return attendanceDateYmd(d);
    })();

  let businessIds: string[] = [];
  if (options?.businessId) {
    businessIds = [options.businessId];
  } else {
    const rows = await queryRows<{ business_id: string }>(
      `SELECT business_id FROM business_settings
       WHERE (shift_roster_settings->>'auto_mark_absent')::boolean IS DISTINCT FROM false`,
    );
    businessIds = rows.map((r) => r.business_id);
  }

  for (const businessId of businessIds) {
    const settings = await getShiftRosterSettings(businessId);
    if (!settings.auto_mark_absent) continue;

    const rostered = await queryRows<{
      employee_id: string;
      shift_id: string;
      start_time: string;
    }>(
      `SELECT r.employee_id, r.shift_id, s.start_time::text AS start_time
       FROM shift_roster_entries r
       INNER JOIN shifts s ON s.id = r.shift_id
       INNER JOIN employees e ON e.id = r.employee_id
       WHERE r.business_id = $1 AND r.roster_date = $2::date
         AND r.is_day_off = false AND e.is_active = true`,
      [businessId, targetDate],
    );

    const { dateYmd: todayYmd, timeStr: nowTime } = istNowParts();
    const isToday = targetDate === todayYmd;

    for (const row of rostered) {
      if (isToday) {
        const cutoff = addMinutesToTime(row.start_time, settings.absent_grace_minutes_after_shift_start);
        if (nowTime < cutoff) {
          skipped++;
          continue;
        }
      }

      const existing = await queryOne<{ id: string; check_in_time: string | null; status: string }>(
        `SELECT id, check_in_time::text, status FROM employee_attendance
         WHERE employee_id = $1 AND date = $2::date`,
        [row.employee_id, targetDate],
      );

      if (existing?.check_in_time) {
        skipped++;
        continue;
      }

      if (existing?.status === 'leave') {
        skipped++;
        continue;
      }

      if (existing) {
        await query(
          `UPDATE employee_attendance
           SET status = 'absent', shift_id = COALESCE(shift_id, $2), updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND check_in_time IS NULL`,
          [existing.id, row.shift_id],
        );
      } else {
        await queryOne(
          `INSERT INTO employee_attendance (employee_id, date, shift_id, status)
           VALUES ($1, $2::date, $3, 'absent')`,
          [row.employee_id, targetDate, row.shift_id],
        );
      }
      marked++;
    }
  }

  return { marked, skipped };
}
