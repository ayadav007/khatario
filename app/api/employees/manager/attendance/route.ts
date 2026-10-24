import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import {
  assertCanMarkEmployeeAttendance,
} from '@/lib/hr/manager-attendance-auth';
import { getAttendanceRollCallScope } from '@/lib/hr/attendance-roll-call-scope';
import { isReportingManager } from '@/lib/hr/manager-scope';
import { attendanceInClosedWagePeriod } from '@/lib/hr/staff-wage-posting';
import { viewerCanSeeWages } from '@/lib/hr/staff-wage-access';

export const dynamic = 'force-dynamic';

type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave' | 'off';

const VALID_STATUSES = new Set<AttendanceStatus>([
  'present',
  'absent',
  'half_day',
  'leave',
  'off',
]);

/**
 * GET /api/employees/manager/attendance?date=YYYY-MM-DD
 * Direct reports with attendance for roll-call UI.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date =
      searchParams.get('date') ??
      new Date().toISOString().slice(0, 10);

    const scope = await getAttendanceRollCallScope(actor.userId, actor.businessId);
    if (scope.scope === 'none' || scope.employeeIds.length === 0) {
      return NextResponse.json(
        { error: 'You do not have permission to mark attendance or there are no active employees.' },
        { status: 403 },
      );
    }

    if (!actor.isPortal) {
      try {
        await authorize(actor.userId, 'attendance', 'read', { businessId: actor.businessId });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          const isManager = await isReportingManager(actor.userId);
          if (!isManager) return error.toNextResponse();
        } else {
          throw error;
        }
      }
    }

    if (scope.employeeIds.length === 0) {
      return NextResponse.json({
        date,
        scope: scope.scope,
        team: [],
        summary: { present: 0, absent: 0, pending: 0, total: 0 },
      });
    }

    const placeholders = scope.employeeIds.map((_, i) => `$${i + 3}`).join(', ');
    const team = await queryRows<{
      id: string;
      employee_code: string;
      name: string;
      designation: string | null;
      attendance_id: string | null;
      attendance_status: AttendanceStatus | null;
      is_late: boolean | null;
      late_excused: boolean | null;
      late_minutes: number | null;
      pay_basis: 'daily' | 'monthly' | null;
      salary: string | null;
    }>(
      `SELECT e.id, e.employee_code, u.name, e.designation,
              e.pay_basis, e.salary::text AS salary,
              a.id AS attendance_id,
              a.status AS attendance_status,
              a.is_late,
              a.late_excused,
              a.late_minutes
       FROM employees e
       INNER JOIN users u ON u.id = e.id
       LEFT JOIN employee_attendance a
         ON a.employee_id = e.id AND a.date = $2::date
       WHERE e.business_id = $1 AND e.id IN (${placeholders})
       ORDER BY u.name`,
      [actor.businessId, date, ...scope.employeeIds],
    );

    let present = 0;
    let absent = 0;
    let half = 0;
    let off = 0;
    let pending = 0;
    for (const row of team) {
      if (!row.attendance_status) pending++;
      else if (row.attendance_status === 'present') present++;
      else if (row.attendance_status === 'half_day') half++;
      else if (row.attendance_status === 'off') off++;
      else absent++;
    }

    const canViewWages = await viewerCanSeeWages(actor.userId);
    const safeTeam = team.map((row) => ({
      id: row.id,
      employee_code: row.employee_code,
      name: row.name,
      designation: row.designation,
      attendance_id: row.attendance_id,
      attendance_status: row.attendance_status,
      is_late: row.is_late,
      late_excused: row.late_excused,
      late_minutes: row.late_minutes,
      pay_basis: canViewWages ? row.pay_basis : null,
      rate: canViewWages ? Number(row.salary ?? 0) : null,
    }));

    return NextResponse.json({
      date,
      scope: scope.scope,
      can_view_wages: canViewWages,
      team: safeTeam,
      summary: { present, absent, half, off, pending, total: team.length },
    });
  } catch (error: unknown) {
    console.error('[GET /api/employees/manager/attendance]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/employees/manager/attendance
 * Upsert one team member's attendance (auto-save from mobile roll-call).
 */
export async function PUT(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const employeeId = body.employee_id as string | undefined;
    const date = (body.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    const status = body.status as AttendanceStatus | undefined;
    const isLateInput = body.is_late as boolean | undefined;
    const lateExcusedInput = body.late_excused as boolean | undefined;

    if (!employeeId || !status || !VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: 'employee_id and status (present|absent|half_day|leave|off) are required' },
        { status: 400 },
      );
    }

    await assertCanMarkEmployeeAttendance(actor.userId, actor.businessId, employeeId);

    const employee = await queryOne<{ id: string }>(
      `SELECT id FROM employees WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [employeeId, actor.businessId],
    );
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    if (await attendanceInClosedWagePeriod(actor.businessId, employeeId, date)) {
      return NextResponse.json(
        { error: 'This day is in a wage period already posted to the books. Reverse that entry before changing attendance.' },
        { status: 409 },
      );
    }

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM employee_attendance WHERE employee_id = $1 AND date = $2::date`,
      [employeeId, date],
    );

    if (!existing) {
      const attendanceLimit = await limitExceededResponse(actor.businessId, 'attendance');
      if (attendanceLimit) return attendanceLimit;
    }

    const clearLate = status !== 'present';

    const row = await queryOne<{
      id: string;
      status: string;
      is_late: boolean;
      late_excused: boolean;
      late_minutes: number;
    }>(
      `INSERT INTO employee_attendance (
        employee_id, date, status, check_in_method,
        is_late, late_minutes, late_excused, late_marked_manual
      )
       VALUES (
        $1, $2::date, $3, 'manual',
        $4, $5, $6, $7
       )
       ON CONFLICT (employee_id, date) DO UPDATE SET
         status = EXCLUDED.status,
         is_late = CASE
           WHEN $8 THEN false
           WHEN $9::boolean IS NOT NULL THEN $9::boolean
           ELSE employee_attendance.is_late
         END,
         late_marked_manual = CASE
           WHEN $8 THEN false
           WHEN $9::boolean IS NOT NULL THEN $9::boolean
           ELSE employee_attendance.late_marked_manual
         END,
         late_minutes = CASE
           WHEN $8 THEN 0
           WHEN $9::boolean IS true THEN GREATEST(employee_attendance.late_minutes, 1)
           WHEN $9::boolean IS false THEN CASE
             WHEN employee_attendance.late_marked_manual THEN 0
             ELSE employee_attendance.late_minutes
           END
           ELSE employee_attendance.late_minutes
         END,
         late_excused = CASE
           WHEN $8 THEN false
           WHEN $10::boolean IS NOT NULL THEN $10::boolean
           ELSE employee_attendance.late_excused
         END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, status, is_late, late_excused, late_minutes`,
      [
        employeeId,
        date,
        status,
        clearLate ? false : isLateInput === true,
        clearLate ? 0 : isLateInput === true ? 1 : 0,
        clearLate ? false : lateExcusedInput === true,
        clearLate ? false : isLateInput === true,
        clearLate,
        clearLate ? null : isLateInput ?? null,
        clearLate ? null : lateExcusedInput ?? null,
      ],
    );

    return NextResponse.json({ success: true, attendance: row });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[PUT /api/employees/manager/attendance]', error);
    const status = message.includes('direct reports') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * POST /api/employees/manager/attendance
 * Save the day's register in one request.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const body = await request.json();
    const date = (body.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    const marks = Array.isArray(body.marks) ? body.marks : [];
    if (marks.length === 0) {
      return NextResponse.json({ error: 'No attendance to save' }, { status: 400 });
    }

    let saved = 0;
    for (const mark of marks) {
      const employeeId = mark?.employee_id as string | undefined;
      const status = mark?.status as AttendanceStatus | undefined;
      if (!employeeId || !status || !VALID_STATUSES.has(status)) {
        return NextResponse.json({ error: 'Each mark needs employee_id and a valid status' }, { status: 400 });
      }
      await assertCanMarkEmployeeAttendance(actor.userId, actor.businessId, employeeId);
      if (await attendanceInClosedWagePeriod(actor.businessId, employeeId, date)) {
        return NextResponse.json(
          { error: 'This day is in a wage period already posted to the books.' },
          { status: 409 },
        );
      }
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM employee_attendance WHERE employee_id = $1 AND date = $2::date`,
        [employeeId, date],
      );
      if (!existing) {
        const attendanceLimit = await limitExceededResponse(actor.businessId, 'attendance');
        if (attendanceLimit) return attendanceLimit;
      }
      const clearLate = status !== 'present';
      await queryOne(
        `INSERT INTO employee_attendance (employee_id, date, status, check_in_method, is_late, late_minutes, late_excused, late_marked_manual)
         VALUES ($1, $2::date, $3, 'manual', false, 0, false, false)
         ON CONFLICT (employee_id, date) DO UPDATE SET
           status = EXCLUDED.status,
           is_late = CASE WHEN $4 THEN false ELSE employee_attendance.is_late END,
           late_minutes = CASE WHEN $4 THEN 0 ELSE employee_attendance.late_minutes END,
           late_excused = CASE WHEN $4 THEN false ELSE employee_attendance.late_excused END,
           updated_at = CURRENT_TIMESTAMP`,
        [employeeId, date, status, clearLate],
      );
      saved++;
    }
    return NextResponse.json({ success: true, saved });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[POST /api/employees/manager/attendance]', error);
    const status = message.includes('direct reports') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
