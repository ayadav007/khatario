import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { LeaveRequest } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

export type LeaveCalendarLeaveEvent = LeaveRequest & {
  leave_name: string;
  leave_code: string;
  employee_code: string;
  employee_name: string;
  event_kind: 'leave';
};

export type LeaveCalendarAttendanceEvent = {
  id: string;
  employee_id: string;
  date: string;
  status: 'absent' | 'half_day' | 'leave' | 'present' | 'holiday';
  employee_code: string;
  employee_name: string;
  event_kind: 'attendance';
};

export type LeaveCalendarDayEvent =
  | (LeaveCalendarLeaveEvent & { event_kind: 'leave' })
  | LeaveCalendarAttendanceEvent;

function pushToMap<T>(map: Record<string, T[]>, dateStr: string, item: T) {
  if (!map[dateStr]) map[dateStr] = [];
  map[dateStr].push(item);
}

/**
 * GET /api/employees/leave-calendar
 * Team calendar: leave requests + attendance (absent / half day).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const employeeId = searchParams.get('employee_id');

    if (!businessId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'business_id, start_date, and end_date are required' },
        { status: 400 },
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 },
      );
    }

    try {
      await authorize(userId, 'leave_requests', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let leaveSql = `
      SELECT 
        lr.id,
        lr.employee_id,
        lr.leave_type_id,
        lr.start_date,
        lr.end_date,
        lr.total_days,
        lr.status,
        lr.reason,
        lt.leave_name,
        lt.leave_code,
        e.employee_code,
        u.name as employee_name
      FROM leave_requests lr
      INNER JOIN leave_types lt ON lr.leave_type_id = lt.id
      INNER JOIN employees e ON lr.employee_id = e.id
      INNER JOIN users u ON e.id = u.id
      WHERE e.business_id = $1
      AND lr.status IN ('pending', 'approved')
      AND (
        (lr.start_date <= $2::date AND lr.end_date >= $2::date) OR
        (lr.start_date <= $3::date AND lr.end_date >= $3::date) OR
        (lr.start_date >= $2::date AND lr.end_date <= $3::date)
      )
    `;
    const leaveParams: string[] = [businessId, startDate, endDate];

    if (employeeId) {
      leaveSql += ` AND lr.employee_id = $4`;
      leaveParams.push(employeeId);
    }

    leaveSql += ` ORDER BY lr.start_date ASC`;

    const leaves = await queryRows<Omit<LeaveCalendarLeaveEvent, 'event_kind'>>(leaveSql, leaveParams);

    let attendanceSql = `
      SELECT
        a.id,
        a.employee_id,
        a.date::text as date,
        a.status,
        e.employee_code,
        u.name as employee_name
      FROM employee_attendance a
      INNER JOIN employees e ON a.employee_id = e.id
      INNER JOIN users u ON e.id = u.id
      WHERE e.business_id = $1
        AND a.date >= $2::date
        AND a.date <= $3::date
        AND a.status IN ('absent', 'half_day')
    `;
    const attendanceParams: string[] = [businessId, startDate, endDate];

    if (employeeId) {
      attendanceSql += ` AND a.employee_id = $4`;
      attendanceParams.push(employeeId);
    }

    attendanceSql += ` ORDER BY a.date ASC`;

    const attendanceRows = await queryRows<Omit<LeaveCalendarAttendanceEvent, 'event_kind'>>(attendanceSql, attendanceParams);

    const calendar: Record<string, LeaveCalendarLeaveEvent[]> = {};
    const attendance_calendar: Record<string, LeaveCalendarAttendanceEvent[]> = {};
    const events_by_date: Record<string, LeaveCalendarDayEvent[]> = {};

    for (const leave of leaves) {
      const start = new Date(leave.start_date);
      const end = new Date(leave.end_date);
      const current = new Date(start);
      const event: LeaveCalendarLeaveEvent = { ...leave, event_kind: 'leave' };

      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        pushToMap(calendar, dateStr, event);
        pushToMap(events_by_date, dateStr, event);
        current.setDate(current.getDate() + 1);
      }
    }

    for (const row of attendanceRows) {
      const dateStr = row.date.slice(0, 10);
      const event: LeaveCalendarAttendanceEvent = { ...row, date: dateStr, event_kind: 'attendance' };
      pushToMap(attendance_calendar, dateStr, event);
      pushToMap(events_by_date, dateStr, event);
    }

    return NextResponse.json({
      leaves,
      calendar,
      attendance: attendanceRows.map((r) => ({ ...r, event_kind: 'attendance' as const })),
      attendance_calendar,
      events_by_date,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Error fetching leave calendar:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
