/**
 * Sync approved leave → employee_attendance (industry-standard one-way link).
 */

import { query, queryOne, queryRows } from '@/lib/db';
import { enumerateWorkingDates } from '@/lib/leave-calculator';

export type LeaveAttendanceSyncInput = {
  businessId: string;
  employeeId: string;
  leaveRequestId: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  leaveName?: string;
};

export type LeaveAttendanceSyncResult = {
  synced: number;
  skipped: number;
};

function leaveNote(leaveRequestId: string, leaveName?: string): string {
  const label = leaveName?.trim() || 'Approved leave';
  return `leave_request:${leaveRequestId} — ${label}`;
}

/**
 * Upsert attendance for each working day in an approved leave range.
 * Does not overwrite present or holiday records.
 */
export async function syncApprovedLeaveToAttendance(
  input: LeaveAttendanceSyncInput,
): Promise<LeaveAttendanceSyncResult> {
  const dates = await enumerateWorkingDates(
    input.startDate,
    input.endDate,
    input.businessId,
  );

  if (dates.length === 0) {
    return { synced: 0, skipped: 0 };
  }

  const isHalfDay =
    Number(input.totalDays) > 0 &&
    Number(input.totalDays) < 1 &&
    dates.length === 1;
  const targetStatus = isHalfDay ? 'half_day' : 'leave';
  const notes = leaveNote(input.leaveRequestId, input.leaveName);

  let synced = 0;
  let skipped = 0;

  for (const date of dates) {
    const existing = await queryOne<{ status: string }>(
      `SELECT status FROM employee_attendance WHERE employee_id = $1 AND date = $2::date`,
      [input.employeeId, date],
    );

    if (existing && (existing.status === 'present' || existing.status === 'holiday')) {
      skipped += 1;
      continue;
    }

    await query(
      `INSERT INTO employee_attendance (
        employee_id, date, status, notes, check_in_method
      )
      VALUES ($1, $2::date, $3, $4, 'manual')
      ON CONFLICT (employee_id, date) DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP`,
      [input.employeeId, date, targetStatus, notes],
    );
    synced += 1;
  }

  return { synced, skipped };
}

/** Backfill attendance for already-approved leaves (e.g. after enabling sync). */
export async function backfillApprovedLeaveAttendanceForBusiness(
  businessId: string,
): Promise<{ requests: number; synced: number; skipped: number }> {
  const approved = await queryRows<{
    id: string;
    employee_id: string;
    start_date: string;
    end_date: string;
    total_days: number;
    leave_name: string;
  }>(
    `SELECT lr.id, lr.employee_id, lr.start_date, lr.end_date, lr.total_days, lt.leave_name
     FROM leave_requests lr
     INNER JOIN employees e ON lr.employee_id = e.id
     INNER JOIN leave_types lt ON lr.leave_type_id = lt.id
     WHERE e.business_id = $1 AND lr.status = 'approved'
     ORDER BY lr.start_date ASC`,
    [businessId],
  );

  let synced = 0;
  let skipped = 0;

  for (const row of approved) {
    const result = await syncApprovedLeaveToAttendance({
      businessId,
      employeeId: row.employee_id,
      leaveRequestId: row.id,
      startDate: String(row.start_date).slice(0, 10),
      endDate: String(row.end_date).slice(0, 10),
      totalDays: Number(row.total_days),
      leaveName: row.leave_name,
    });
    synced += result.synced;
    skipped += result.skipped;
  }

  return {
    requests: approved.length,
    synced,
    skipped,
  };
}
