/**
 * Writes today's check-in / check-out for one employee, with shift, roster and late rules.
 * Callers decide who may punch and whether the location is good enough; this only records it.
 */
import { insertAttendanceLimited } from '@/lib/hr/attendance-limit';
import { LimitRefusedError } from '@/lib/subscription/limit-lock';
import { query, queryOne } from '@/lib/db';
import { NextResponse } from 'next/server';
import { checkLimit } from '@/lib/subscription';
import { limitExceededReply } from '@/lib/subscription/limit-response';
import type { EmployeeAttendance } from '@/types/database';
import { applyLateFieldsOnCheckIn } from '@/lib/hr/attendance-policy';
import { attendanceDateYmd } from '@/lib/hr/attendance-date';
import { resolveShiftForEmployeeOnDate } from '@/lib/hr/shift-overtime/shift-assignment';
import { getRosterEntryForDate } from '@/lib/hr/shift-overtime/shift-roster';

export class AttendancePunchError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
  }
}

/** Shown to the employee who tried to punch. An employee cannot upgrade a plan, so it names the manager instead. */
export const ATTENDANCE_LIMIT_EMPLOYEE_MESSAGE =
  "Attendance could not be recorded: your employer's plan has reached its monthly attendance limit. Please tell your manager.";

/**
 * One in-app notification per business per day, on the first punch refused by the monthly attendance limit,
 * so the owner (who can upgrade) hears about it. Never throws: a notification failure must not change the refusal.
 */
export async function notifyAttendanceLimitReached(businessId: string): Promise<void> {
  try {
    await query(
      `INSERT INTO notifications (business_id, type, title, message, reference_type, created_at)
       SELECT $1, 'general', $2, $3, 'attendance_limit', CURRENT_TIMESTAMP
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE business_id = $1 AND reference_type = 'attendance_limit' AND created_at::date = CURRENT_DATE
        )`,
      [
        businessId,
        'Monthly attendance limit reached',
        "Staff could not check in today because your plan's monthly attendance limit is used up. Upgrade your HR plan to continue.",
      ],
    );
  } catch (err) {
    console.error('[attendance] limit notification failed', err);
  }
}

/**
 * The business is at its monthly attendance-record limit and this punch would add a new row.
 * HTTP callers answer with limitExceededReply('attendance', error.check); `check.message` is the employee-facing text.
 */
export class AttendanceLimitError extends AttendancePunchError {
  readonly check: { limit: number; current: number; message?: string };
  constructor(check: { limit: number; current: number; message?: string }) {
    super(ATTENDANCE_LIMIT_EMPLOYEE_MESSAGE, 'limit_exceeded', 403);
    this.check = { ...check, message: ATTENDANCE_LIMIT_EMPLOYEE_MESSAGE };
  }
}

/** For employee-facing punch routes: the standard 403 with the employee text (and the daily owner notice), or null. */
export async function employeeAttendanceLimitResponse(businessId: string): Promise<NextResponse | null> {
  const check = await checkLimit(businessId, 'attendance');
  if (check.allowed) return null;
  // A failed limit check is not the plan limit: no owner notice, and the try-again message.
  if (check.unavailable) return limitExceededReply('attendance', check);
  await notifyAttendanceLimitReached(businessId);
  return limitExceededReply('attendance', { ...check, message: ATTENDANCE_LIMIT_EMPLOYEE_MESSAGE });
}

/** The employee-facing refusal for a LimitRefusedError thrown by insertAttendanceLimited (same answer as above). */
export async function employeeLimitRefusedResponse(
  businessId: string,
  error: LimitRefusedError,
): Promise<NextResponse> {
  if (error.check.unavailable) return limitExceededReply('attendance', error.check);
  await notifyAttendanceLimitReached(businessId);
  return limitExceededReply('attendance', { ...error.check, message: ATTENDANCE_LIMIT_EMPLOYEE_MESSAGE });
}

export type PunchParams = {
  employeeId: string;
  businessId: string;
  method: string;
  lat?: number | null;
  lng?: number | null;
  deviceInfo?: string | null;
  ipAddress?: string | null;
  recognitionConfidence?: number | null;
  shiftId?: string | null;
};

async function logPunch(p: PunchParams, attendanceId: string, logType: 'check_in' | 'check_out', at: Date) {
  await query(
    `INSERT INTO attendance_logs (
      employee_id, attendance_id, log_type, log_time,
      location_lat, location_lng, device_info, ip_address,
      recognition_confidence, method
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      p.employeeId,
      attendanceId,
      logType,
      at,
      p.lat ?? null,
      p.lng ?? null,
      p.deviceInfo ?? null,
      p.ipAddress ?? null,
      p.recognitionConfidence ?? null,
      p.method,
    ],
  );
}

export async function recordCheckIn(p: PunchParams): Promise<EmployeeAttendance> {
  const today = attendanceDateYmd();
  let attendance = await queryOne<EmployeeAttendance>(
    'SELECT * FROM employee_attendance WHERE employee_id = $1 AND date = $2',
    [p.employeeId, today],
  );
  if (attendance?.check_in_time) {
    throw new AttendancePunchError('Already checked in today', 'ALREADY_CHECKED_IN');
  }

  const effectiveShiftId =
    p.shiftId ??
    attendance?.shift_id ??
    (await resolveShiftForEmployeeOnDate(p.businessId, p.employeeId, today));

  const rosterToday = await getRosterEntryForDate(p.businessId, p.employeeId, today);
  if (rosterToday?.is_day_off) {
    throw new AttendancePunchError('You are scheduled off today per the shift roster.', 'DAY_OFF');
  }

  const checkInTime = new Date();
  const lateFields = await applyLateFieldsOnCheckIn({
    businessId: p.businessId,
    checkIn: checkInTime,
    dateYmd: today,
    shiftId: effectiveShiftId,
  });

  if (attendance) {
    await query(
      `UPDATE employee_attendance
       SET check_in_time = $1, check_in_method = $2,
           check_in_location_lat = $3, check_in_location_lng = $4,
           status = 'present',
           is_late = $5, late_minutes = $6,
           shift_id = COALESCE($7, shift_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8`,
      [
        checkInTime,
        p.method,
        p.lat ?? null,
        p.lng ?? null,
        lateFields.is_late,
        lateFields.late_minutes,
        effectiveShiftId,
        attendance.id,
      ],
    );
    attendance = await queryOne<EmployeeAttendance>('SELECT * FROM employee_attendance WHERE id = $1', [
      attendance.id,
    ]);
  } else {
    // Only a new row for the day counts; updating an existing row (above) is never refused.
    try {
    attendance = await insertAttendanceLimited<EmployeeAttendance>(
      p.businessId, p.employeeId, today,
      `INSERT INTO employee_attendance (
        employee_id, date, check_in_time, check_in_method,
        check_in_location_lat, check_in_location_lng, status,
        shift_id, is_late, late_minutes
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'present', $7, $8, $9)
      RETURNING *`,
      [
        p.employeeId,
        today,
        checkInTime,
        p.method,
        p.lat ?? null,
        p.lng ?? null,
        effectiveShiftId,
        lateFields.is_late,
        lateFields.late_minutes,
      ],
    );
    } catch (error) {
      if (error instanceof LimitRefusedError) {
        if (error.check.unavailable) {
          throw new AttendancePunchError('Please try again in a moment.', 'limit_check_unavailable', 503);
        }
        await notifyAttendanceLimitReached(p.businessId);
        throw new AttendanceLimitError(error.check);
      }
      throw error;
    }
  }

  if (!attendance) {
    throw new AttendancePunchError('Failed to create or update attendance', 'WRITE_FAILED', 500);
  }
  await logPunch(p, attendance.id, 'check_in', checkInTime);
  return attendance;
}

export async function recordCheckOut(p: PunchParams): Promise<EmployeeAttendance> {
  const today = attendanceDateYmd();
  const attendance = await queryOne<EmployeeAttendance>(
    'SELECT * FROM employee_attendance WHERE employee_id = $1 AND date = $2',
    [p.employeeId, today],
  );
  if (!attendance) {
    throw new AttendancePunchError('No check-in found for today. Please check in first.', 'NOT_CHECKED_IN');
  }
  if (attendance.check_out_time) {
    throw new AttendancePunchError('Already checked out today', 'ALREADY_CHECKED_OUT');
  }

  const checkOutTime = new Date();
  await query(
    `UPDATE employee_attendance
     SET check_out_time = $1, check_out_method = $2,
         check_out_location_lat = $3, check_out_location_lng = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5`,
    [checkOutTime, p.method, p.lat ?? null, p.lng ?? null, attendance.id],
  );

  const updated = await queryOne<EmployeeAttendance>('SELECT * FROM employee_attendance WHERE id = $1', [
    attendance.id,
  ]);
  await logPunch(p, attendance.id, 'check_out', checkOutTime);
  return updated ?? attendance;
}
