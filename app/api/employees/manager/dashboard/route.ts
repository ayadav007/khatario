import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getDirectReportIds,
  getEmployeeIdForUser,
  isReportingManager,
} from '@/lib/hr/manager-scope';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

async function assertManagerAccess(userId: string, businessId: string) {
  const employeeId = await getEmployeeIdForUser(userId, businessId);
  const isManager = employeeId ? await isReportingManager(employeeId) : false;

  try {
    await authorize(userId, 'leave_requests', 'read', { businessId });
    return { employeeId, isHrAdmin: true, isManager };
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
  }

  try {
    await authorize(userId, 'employees', 'read', { businessId });
    if (isManager && employeeId) {
      return { employeeId, isHrAdmin: true, isManager: true };
    }
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
  }

  if (employeeId && isManager) {
    return { employeeId, isHrAdmin: false, isManager: true };
  }

  throw new AuthorizationError('Manager or HR access required', 'FORBIDDEN');
}

/**
 * GET /api/employees/manager/dashboard
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
    }

    let access: Awaited<ReturnType<typeof assertManagerAccess>>;
    try {
      access = await assertManagerAccess(userId, businessId);
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const { employeeId, isHrAdmin } = access;
    if (!employeeId) {
      return NextResponse.json({
        team_count: 0,
        pending_leaves: 0,
        pending_expenses: 0,
        present_today: 0,
        absent_today: 0,
      });
    }

    const teamIds = await getDirectReportIds(businessId, employeeId);
    const today = format(new Date(), 'yyyy-MM-dd');

    if (teamIds.length === 0) {
      return NextResponse.json({
        team_count: 0,
        pending_leaves: 0,
        pending_expenses: 0,
        present_today: 0,
        absent_today: 0,
        is_hr_admin: isHrAdmin,
      });
    }

    const placeholders = teamIds.map((_, i) => `$${i + 2}`).join(', ');

    const pendingLeaves = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM leave_requests lr
       WHERE lr.status = 'pending' AND lr.employee_id IN (${placeholders})`,
      teamIds
    );

    const pendingExpenses = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM employee_expenses ee
       WHERE ee.status = 'pending' AND ee.employee_id IN (${placeholders})`,
      teamIds
    );

    const todayParam = teamIds.length + 1;
    const attendanceToday = await queryRows<{ status: string; count: string }>(
      `SELECT COALESCE(a.status, 'absent') AS status, COUNT(*)::text AS count
       FROM employees e
       LEFT JOIN employee_attendance a ON a.employee_id = e.id AND a.date = $${todayParam}::date
       WHERE e.id IN (${placeholders})
       GROUP BY COALESCE(a.status, 'absent')`,
      [...teamIds, today]
    );

    let presentToday = 0;
    let absentToday = 0;
    for (const row of attendanceToday) {
      const c = parseInt(row.count, 10);
      if (row.status === 'present' || row.status === 'half_day') presentToday += c;
      else if (row.status === 'absent') absentToday += c;
    }

    return NextResponse.json({
      team_count: teamIds.length,
      pending_leaves: parseInt(pendingLeaves?.count ?? '0', 10),
      pending_expenses: parseInt(pendingExpenses?.count ?? '0', 10),
      present_today: presentToday,
      absent_today: absentToday,
      is_hr_admin: isHrAdmin,
    });
  } catch (error: unknown) {
    console.error('Error fetching manager dashboard:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
