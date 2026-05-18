import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { LeaveRequest } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/employees/leave-calendar
 * Get leave calendar for a date range
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const employeeId = searchParams.get('employee_id'); // Optional filter

    if (!businessId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'business_id, start_date, and end_date are required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (leave calendar is part of HR module)
    try {
      await authorize(userId, 'leave_requests', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let sql = `
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
        (lr.start_date <= $2 AND lr.end_date >= $2) OR
        (lr.start_date <= $3 AND lr.end_date >= $3) OR
        (lr.start_date >= $2 AND lr.end_date <= $3)
      )
    `;
    const params: any[] = [businessId, startDate, endDate];

    if (employeeId) {
      sql += ` AND lr.employee_id = $4`;
      params.push(employeeId);
    }

    sql += ` ORDER BY lr.start_date ASC`;

    const leaves = await queryRows<LeaveRequest & {
      leave_name: string;
      leave_code: string;
      employee_code: string;
      employee_name: string;
    }>(sql, params);

    // Group by date for calendar view
    const calendar: Record<string, Array<typeof leaves[0]>> = {};

    leaves.forEach(leave => {
      const start = new Date(leave.start_date);
      const end = new Date(leave.end_date);
      const current = new Date(start);

      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        if (!calendar[dateStr]) {
          calendar[dateStr] = [];
        }
        calendar[dateStr].push(leave);
        current.setDate(current.getDate() + 1);
      }
    });

    return NextResponse.json({
      leaves,
      calendar,
    });
  } catch (error: any) {
    console.error('Error fetching leave calendar:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

