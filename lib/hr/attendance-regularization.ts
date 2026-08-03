import { query, queryOne, queryRows } from '@/lib/db';
import { attendanceDateYmd } from '@/lib/hr/attendance-date';
import { applyLateFieldsOnCheckIn } from '@/lib/hr/attendance-policy';
import { resolveShiftForEmployeeOnDate } from '@/lib/hr/shift-overtime/shift-assignment';
import {
  DEFAULT_REGULARIZATION_SETTINGS,
  type RegularizationRequestRow,
  type RegularizationRequestType,
  type RegularizationSettings,
  type SubmitRegularizationInput,
} from '@/lib/hr/attendance-regularization-shared';

export type {
  RegularizationRequestRow,
  RegularizationRequestType,
  RegularizationSettings,
  SubmitRegularizationInput,
} from '@/lib/hr/attendance-regularization-shared';

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nullableLimit(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Math.floor(num(v, 0));
  return n > 0 ? n : null;
}

export function parseRegularizationSettings(raw: unknown): RegularizationSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_REGULARIZATION_SETTINGS };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    allow_missing_punch: o.allow_missing_punch !== false,
    allow_override_existing: o.allow_override_existing === true,
    allow_delete_logs: o.allow_delete_logs === true,
    max_requests_per_week: nullableLimit(o.max_requests_per_week),
    max_requests_per_month: nullableLimit(o.max_requests_per_month),
    max_backdate_days: Math.max(0, Math.floor(num(o.max_backdate_days, 1))),
    min_minutes_for_partial: Math.max(0, Math.floor(num(o.min_minutes_for_partial, 15))),
    require_reason: o.require_reason !== false,
  };
}

export async function getRegularizationSettings(businessId: string): Promise<RegularizationSettings> {
  const row = await queryOne<{ regularization_settings: unknown }>(
    `SELECT regularization_settings FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return parseRegularizationSettings(row?.regularization_settings);
}

export async function saveRegularizationSettings(
  businessId: string,
  partial: Partial<RegularizationSettings>,
): Promise<RegularizationSettings> {
  const current = await getRegularizationSettings(businessId);
  const merged: RegularizationSettings = { ...current, ...partial };

  const existing = await queryOne(`SELECT business_id FROM business_settings WHERE business_id = $1`, [
    businessId,
  ]);
  if (existing) {
    await query(
      `UPDATE business_settings SET regularization_settings = $2::jsonb WHERE business_id = $1`,
      [businessId, JSON.stringify(merged)],
    );
  } else {
    await query(
      `INSERT INTO business_settings (business_id, regularization_settings) VALUES ($1, $2::jsonb)`,
      [businessId, JSON.stringify(merged)],
    );
  }
  return merged;
}

type AttendanceSnapshot = {
  id: string | null;
  check_in_time: Date | null;
  check_out_time: Date | null;
  shift_id: string | null;
};

async function loadAttendance(employeeId: string, dateYmd: string): Promise<AttendanceSnapshot> {
  const row = await queryOne<{
    id: string;
    check_in_time: Date | null;
    check_out_time: Date | null;
    shift_id: string | null;
  }>(
    `SELECT id, check_in_time, check_out_time, shift_id
     FROM employee_attendance WHERE employee_id = $1 AND date = $2::date`,
    [employeeId, dateYmd],
  );
  return row ?? { id: null, check_in_time: null, check_out_time: null, shift_id: null };
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(`${fromYmd}T12:00:00`);
  const b = new Date(`${toYmd}T12:00:00`);
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function weekStartYmd(dateYmd: string): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function monthStartYmd(dateYmd: string): string {
  return `${dateYmd.slice(0, 7)}-01`;
}

async function countRequestsInRange(
  employeeId: string,
  fromYmd: string,
  toYmd: string,
): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM attendance_regularization_requests
     WHERE employee_id = $1
       AND attendance_date >= $2::date AND attendance_date <= $3::date
       AND status IN ('pending', 'approved')`,
    [employeeId, fromYmd, toYmd],
  );
  return parseInt(row?.count ?? '0', 10);
}

async function resolveShiftTimes(
  businessId: string,
  employeeId: string,
  dateYmd: string,
  shiftId: string | null,
): Promise<{ start: string | null; end: string | null }> {
  const effectiveShiftId =
    shiftId ?? (await resolveShiftForEmployeeOnDate(businessId, employeeId, dateYmd));
  if (!effectiveShiftId) return { start: null, end: null };
  const shift = await queryOne<{ start_time: string; end_time: string }>(
    `SELECT start_time::text, end_time::text FROM shifts WHERE id = $1`,
    [effectiveShiftId],
  );
  return { start: shift?.start_time ?? null, end: shift?.end_time ?? null };
}

function scheduledTimestamp(dateYmd: string, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(`${dateYmd}T00:00:00`);
  d.setHours(h, m ?? 0, 0, 0);
  return d;
}

function parseRequestedTime(dateYmd: string, value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (!value.includes('T') && value.length <= 8) {
    return scheduledTimestamp(dateYmd, value);
  }
  return d;
}

function isMissingType(t: RegularizationRequestType): boolean {
  return t === 'missing_check_in' || t === 'missing_check_out' || t === 'missing_both';
}

function isOverrideType(t: RegularizationRequestType): boolean {
  return t === 'override_check_in' || t === 'override_check_out';
}

function isDeleteType(t: RegularizationRequestType): boolean {
  return t === 'delete_check_in' || t === 'delete_check_out';
}

export async function validateRegularizationSubmit(params: {
  businessId: string;
  employeeId: string;
  input: SubmitRegularizationInput;
  settings?: RegularizationSettings;
}): Promise<{ ok: true; attendance: AttendanceSnapshot } | { ok: false; error: string }> {
  const settings = params.settings ?? (await getRegularizationSettings(params.businessId));
  if (!settings.enabled) {
    return { ok: false, error: 'Attendance regularization is not enabled for your organization' };
  }

  const { input } = params;
  const dateYmd = input.attendance_date.slice(0, 10);
  const today = attendanceDateYmd();
  if (daysBetween(dateYmd, today) > settings.max_backdate_days) {
    return {
      ok: false,
      error: `Cannot regularize attendance more than ${settings.max_backdate_days} day(s) in the past`,
    };
  }
  if (dateYmd > today) {
    return { ok: false, error: 'Cannot regularize future dates' };
  }

  if (settings.require_reason && !input.reason?.trim()) {
    return { ok: false, error: 'Reason is required' };
  }

  const manager = await queryOne<{ reporting_manager_id: string | null }>(
    `SELECT reporting_manager_id FROM employees WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [params.employeeId, params.businessId],
  );
  if (!manager?.reporting_manager_id) {
    return { ok: false, error: 'No reporting manager assigned — contact HR' };
  }

  const weekCount = await countRequestsInRange(
    params.employeeId,
    weekStartYmd(dateYmd),
    dateYmd,
  );
  if (settings.max_requests_per_week != null && weekCount >= settings.max_requests_per_week) {
    return {
      ok: false,
      error: `Weekly regularization limit reached (${settings.max_requests_per_week})`,
    };
  }

  const monthCount = await countRequestsInRange(
    params.employeeId,
    monthStartYmd(dateYmd),
    dateYmd,
  );
  if (settings.max_requests_per_month != null && monthCount >= settings.max_requests_per_month) {
    return {
      ok: false,
      error: `Monthly regularization limit reached (${settings.max_requests_per_month})`,
    };
  }

  const attendance = await loadAttendance(params.employeeId, dateYmd);
  const type = input.request_type;

  if (isMissingType(type) && !settings.allow_missing_punch) {
    return { ok: false, error: 'Missing punch regularization is not allowed' };
  }
  if (isOverrideType(type) && !settings.allow_override_existing) {
    return { ok: false, error: 'Overriding existing logs is not allowed' };
  }
  if (isDeleteType(type) && !settings.allow_delete_logs) {
    return { ok: false, error: 'Deleting attendance logs is not allowed' };
  }

  const reqIn = parseRequestedTime(dateYmd, input.requested_check_in);
  const reqOut = parseRequestedTime(dateYmd, input.requested_check_out);

  switch (type) {
    case 'missing_check_in':
      if (attendance.check_in_time) {
        return { ok: false, error: 'Check-in already exists — use override instead' };
      }
      if (!reqIn) return { ok: false, error: 'Requested check-in time is required' };
      break;
    case 'missing_check_out':
      if (!attendance.check_in_time) {
        return { ok: false, error: 'Check-in must exist before adding check-out' };
      }
      if (attendance.check_out_time) {
        return { ok: false, error: 'Check-out already exists — use override instead' };
      }
      if (!reqOut) return { ok: false, error: 'Requested check-out time is required' };
      if (reqOut <= attendance.check_in_time) {
        return { ok: false, error: 'Check-out must be after check-in' };
      }
      break;
    case 'missing_both':
      if (attendance.check_in_time || attendance.check_out_time) {
        return { ok: false, error: 'Use missing check-in or check-out for partial missing punches' };
      }
      if (!reqIn || !reqOut) {
        return { ok: false, error: 'Both check-in and check-out times are required' };
      }
      if (reqOut <= reqIn) {
        return { ok: false, error: 'Check-out must be after check-in' };
      }
      break;
    case 'override_check_in':
      if (!attendance.check_in_time) {
        return { ok: false, error: 'No check-in to override — use missing punch' };
      }
      if (!reqIn) return { ok: false, error: 'Requested check-in time is required' };
      break;
    case 'override_check_out':
      if (!attendance.check_out_time) {
        return { ok: false, error: 'No check-out to override — use missing punch' };
      }
      if (!reqOut) return { ok: false, error: 'Requested check-out time is required' };
      if (attendance.check_in_time && reqOut <= attendance.check_in_time) {
        return { ok: false, error: 'Check-out must be after check-in' };
      }
      break;
    case 'delete_check_in':
      if (!attendance.check_in_time) {
        return { ok: false, error: 'No check-in log to delete' };
      }
      break;
    case 'delete_check_out':
      if (!attendance.check_out_time) {
        return { ok: false, error: 'No check-out log to delete' };
      }
      break;
    case 'partial_late_in': {
      if (!attendance.check_in_time) {
        return { ok: false, error: 'Check-in required for late arrival regularization' };
      }
      if (!reqIn) return { ok: false, error: 'Requested check-in time is required' };
      const { start } = await resolveShiftTimes(
        params.businessId,
        params.employeeId,
        dateYmd,
        attendance.shift_id,
      );
      if (!start) {
        return { ok: false, error: 'Cannot verify late threshold — no shift assigned for this day' };
      }
      const scheduled = scheduledTimestamp(dateYmd, start);
      const actualLateMin = Math.floor(
        (attendance.check_in_time.getTime() - scheduled.getTime()) / 60_000,
      );
      if (actualLateMin < settings.min_minutes_for_partial) {
        return {
          ok: false,
          error: `Late arrival must be at least ${settings.min_minutes_for_partial} minutes to regularize`,
        };
      }
      break;
    }
    case 'partial_early_out': {
      if (!attendance.check_out_time) {
        return { ok: false, error: 'Check-out required for early departure regularization' };
      }
      if (!reqOut) return { ok: false, error: 'Requested check-out time is required' };
      const { end } = await resolveShiftTimes(
        params.businessId,
        params.employeeId,
        dateYmd,
        attendance.shift_id,
      );
      if (!end) {
        return {
          ok: false,
          error: 'Cannot verify early threshold — no shift assigned for this day',
        };
      }
      const scheduledEnd = scheduledTimestamp(dateYmd, end);
      const earlyMin = Math.floor(
        (scheduledEnd.getTime() - attendance.check_out_time.getTime()) / 60_000,
      );
      if (earlyMin < settings.min_minutes_for_partial) {
        return {
          ok: false,
          error: `Early departure must be at least ${settings.min_minutes_for_partial} minutes to regularize`,
        };
      }
      if (attendance.check_in_time && reqOut <= attendance.check_in_time) {
        return { ok: false, error: 'Check-out must be after check-in' };
      }
      break;
    }
    default:
      return { ok: false, error: 'Invalid request type' };
  }

  return { ok: true, attendance };
}

export async function submitRegularizationRequest(params: {
  businessId: string;
  employeeId: string;
  input: SubmitRegularizationInput;
}): Promise<RegularizationRequestRow> {
  const validation = await validateRegularizationSubmit(params);
  if (!validation.ok) throw new Error(validation.error);

  const { attendance } = validation;
  const dateYmd = params.input.attendance_date.slice(0, 10);
  const manager = await queryOne<{ reporting_manager_id: string }>(
    `SELECT reporting_manager_id FROM employees WHERE id = $1`,
    [params.employeeId],
  );

  const reqIn = parseRequestedTime(dateYmd, params.input.requested_check_in);
  const reqOut = parseRequestedTime(dateYmd, params.input.requested_check_out);

  const row = await queryOne<RegularizationRequestRow>(
    `INSERT INTO attendance_regularization_requests (
       business_id, employee_id, attendance_id, attendance_date, request_type,
       original_check_in, original_check_out, requested_check_in, requested_check_out,
       reason, approver_user_id, status
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,'pending')
     RETURNING id, business_id, employee_id, attendance_id, attendance_date::text, request_type,
       original_check_in::text, original_check_out::text, requested_check_in::text, requested_check_out::text,
       reason, status, approver_user_id, approved_by, approved_at::text, rejected_by, rejected_at::text,
       rejection_reason, created_at::text`,
    [
      params.businessId,
      params.employeeId,
      attendance.id,
      dateYmd,
      params.input.request_type,
      attendance.check_in_time,
      attendance.check_out_time,
      reqIn,
      reqOut,
      params.input.reason.trim(),
      manager!.reporting_manager_id,
    ],
  );
  if (!row) throw new Error('Failed to create request');
  return row;
}

export async function listRegularizationRequestsForEmployee(
  businessId: string,
  employeeId: string,
  limit = 50,
): Promise<RegularizationRequestRow[]> {
  return queryRows(
    `SELECT id, business_id, employee_id, attendance_id, attendance_date::text, request_type,
            original_check_in::text, original_check_out::text, requested_check_in::text, requested_check_out::text,
            reason, status, approver_user_id, approved_by, approved_at::text, rejected_by, rejected_at::text,
            rejection_reason, created_at::text
     FROM attendance_regularization_requests
     WHERE business_id = $1 AND employee_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [businessId, employeeId, limit],
  );
}

export type PendingRegularization = RegularizationRequestRow & {
  employee_code: string;
  employee_name: string;
};

export async function listPendingRegularizationsForManager(
  businessId: string,
  managerEmployeeId: string,
): Promise<PendingRegularization[]> {
  return queryRows(
    `SELECT r.id, r.business_id, r.employee_id, r.attendance_id, r.attendance_date::text, r.request_type,
            r.original_check_in::text, r.original_check_out::text, r.requested_check_in::text, r.requested_check_out::text,
            r.reason, r.status, r.approver_user_id, r.approved_by, r.approved_at::text, r.rejected_by, r.rejected_at::text,
            r.rejection_reason, r.created_at::text,
            e.employee_code, u.name AS employee_name
     FROM attendance_regularization_requests r
     INNER JOIN employees e ON e.id = r.employee_id
     INNER JOIN users u ON u.id = e.id
     WHERE r.business_id = $1 AND r.status = 'pending' AND r.approver_user_id = $2
     ORDER BY r.created_at ASC`,
    [businessId, managerEmployeeId],
  );
}

async function recomputeAttendanceHours(attendanceId: string): Promise<void> {
  const row = await queryOne<{ check_in_time: Date | null; check_out_time: Date | null }>(
    `SELECT check_in_time, check_out_time FROM employee_attendance WHERE id = $1`,
    [attendanceId],
  );
  if (!row?.check_in_time || !row.check_out_time) {
    await query(`UPDATE employee_attendance SET total_hours = NULL WHERE id = $1`, [attendanceId]);
    return;
  }
  const hours = (row.check_out_time.getTime() - row.check_in_time.getTime()) / 3_600_000;
  await query(`UPDATE employee_attendance SET total_hours = $2 WHERE id = $1`, [
    attendanceId,
    Math.round(Math.max(0, hours) * 100) / 100,
  ]);
}

async function applyApprovedRegularization(requestId: string): Promise<void> {
  const req = await queryOne<{
    id: string;
    business_id: string;
    employee_id: string;
    attendance_id: string | null;
    attendance_date: string;
    request_type: RegularizationRequestType;
    requested_check_in: Date | null;
    requested_check_out: Date | null;
    reason: string;
  }>(
    `SELECT id, business_id, employee_id, attendance_id, attendance_date::text AS attendance_date,
            request_type, requested_check_in, requested_check_out, reason
     FROM attendance_regularization_requests WHERE id = $1`,
    [requestId],
  );
  if (!req) throw new Error('Request not found');

  const dateYmd = req.attendance_date.slice(0, 10);
  let attendanceId = req.attendance_id;
  const noteSuffix = ` [Regularized: ${req.reason.slice(0, 120)}]`;

  if (!attendanceId) {
    const shiftId = await resolveShiftForEmployeeOnDate(req.business_id, req.employee_id, dateYmd);
    const created = await queryOne<{ id: string }>(
      `INSERT INTO employee_attendance (employee_id, date, shift_id, status)
       VALUES ($1, $2::date, $3, 'present')
       ON CONFLICT (employee_id, date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [req.employee_id, dateYmd, shiftId],
    );
    attendanceId = created!.id;
    await query(
      `UPDATE attendance_regularization_requests SET attendance_id = $2 WHERE id = $1`,
      [requestId, attendanceId],
    );
  }

  const type = req.request_type;
  const shiftId = await resolveShiftForEmployeeOnDate(req.business_id, req.employee_id, dateYmd);

  if (type === 'missing_check_in' || type === 'override_check_in' || type === 'partial_late_in') {
    const checkIn = req.requested_check_in!;
    const lateFields = await applyLateFieldsOnCheckIn({
      businessId: req.business_id,
      checkIn,
      dateYmd,
      shiftId,
    });
    await query(
      `UPDATE employee_attendance
       SET check_in_time = $2, check_in_method = 'manual', status = 'present',
           is_late = $3, late_minutes = $4,
           notes = COALESCE(notes, '') || $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [attendanceId, checkIn, lateFields.is_late, lateFields.late_minutes, noteSuffix],
    );
  } else if (
    type === 'missing_check_out' ||
    type === 'override_check_out' ||
    type === 'partial_early_out'
  ) {
    await query(
      `UPDATE employee_attendance
       SET check_out_time = $2, check_out_method = 'manual',
           notes = COALESCE(notes, '') || $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [attendanceId, req.requested_check_out, noteSuffix],
    );
  } else if (type === 'missing_both') {
    const checkIn = req.requested_check_in!;
    const lateFields = await applyLateFieldsOnCheckIn({
      businessId: req.business_id,
      checkIn,
      dateYmd,
      shiftId,
    });
    await query(
      `UPDATE employee_attendance
       SET check_in_time = $2, check_out_time = $3,
           check_in_method = 'manual', check_out_method = 'manual', status = 'present',
           is_late = $4, late_minutes = $5,
           notes = COALESCE(notes, '') || $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        attendanceId,
        checkIn,
        req.requested_check_out,
        lateFields.is_late,
        lateFields.late_minutes,
        noteSuffix,
      ],
    );
  } else if (type === 'delete_check_in') {
    await query(
      `UPDATE employee_attendance
       SET check_in_time = NULL, check_in_method = NULL, check_in_location_lat = NULL, check_in_location_lng = NULL,
           is_late = false, late_minutes = 0,
           notes = COALESCE(notes, '') || $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [attendanceId, noteSuffix],
    );
  } else if (type === 'delete_check_out') {
    await query(
      `UPDATE employee_attendance
       SET check_out_time = NULL, check_out_method = NULL, check_out_location_lat = NULL, check_out_location_lng = NULL,
           notes = COALESCE(notes, '') || $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [attendanceId, noteSuffix],
    );
  }

  await recomputeAttendanceHours(attendanceId);
}

export async function decideRegularizationRequest(input: {
  requestId: string;
  businessId: string;
  managerEmployeeId: string;
  action: 'approve' | 'reject';
  rejection_reason?: string;
}): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const req = await queryOne<{ id: string; status: string; approver_user_id: string | null }>(
    `SELECT id, status, approver_user_id FROM attendance_regularization_requests
     WHERE id = $1 AND business_id = $2`,
    [input.requestId, input.businessId],
  );
  if (!req) return { ok: false, error: 'Request not found' };
  if (req.status !== 'pending') return { ok: false, error: 'Request is no longer pending' };
  if (req.approver_user_id !== input.managerEmployeeId) {
    return { ok: false, error: 'Only the assigned reporting manager can act on this request' };
  }

  if (input.action === 'approve') {
    await applyApprovedRegularization(input.requestId);
    await query(
      `UPDATE attendance_regularization_requests
       SET status = 'approved', approved_by = $2, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [input.requestId, input.managerEmployeeId],
    );
    return { ok: true, status: 'approved' };
  }

  await query(
    `UPDATE attendance_regularization_requests
     SET status = 'rejected', rejected_by = $2, rejected_at = CURRENT_TIMESTAMP,
         rejection_reason = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [input.requestId, input.managerEmployeeId, input.rejection_reason?.trim() || null],
  );
  return { ok: true, status: 'rejected' };
}
