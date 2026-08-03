import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import {
  fetchAnnouncements,
  fetchCelebrations,
  fetchOnLeaveToday,
  fetchPortalLeaveBalances,
  fetchUpcomingHolidays,
  countPendingApprovalsForManager,
  fetchEmployeeTasks,
} from '@/lib/employee-portal/portal-dashboard';
import { requirePortalSession, requirePortalFeature } from '@/lib/employee-portal/portal-route-guard';
import { isReportingManager } from '@/lib/hr/manager-scope';
import { attendanceDateYmd } from '@/lib/hr/attendance-date';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const { businessId, employeeId } = auth.session;
    const year = new Date().getFullYear();
    const today = attendanceDateYmd();

    const attendanceRow = await queryOne<{
      check_in_time: string | null;
      check_out_time: string | null;
    }>(
      `SELECT check_in_time::text, check_out_time::text
       FROM employee_attendance WHERE employee_id = $1 AND date = $2::date`,
      [employeeId, today],
    );

    const deniedAttendance = await requirePortalFeature(businessId, 'attendance');
    const deniedLeaves = await requirePortalFeature(businessId, 'leaves');

    const [holidays, onLeave, celebrations, announcements, tasks, isManager] =
      await Promise.all([
        fetchUpcomingHolidays(businessId, 3),
        fetchOnLeaveToday(businessId, employeeId),
        fetchCelebrations(businessId),
        fetchAnnouncements(businessId, 3),
        fetchEmployeeTasks(businessId, employeeId),
        isReportingManager(employeeId),
      ]);

    let leaveBalances: Awaited<ReturnType<typeof fetchPortalLeaveBalances>> = [];
    if (!deniedLeaves) {
      leaveBalances = await fetchPortalLeaveBalances(businessId, employeeId, year);
    }

    let pendingApprovals = 0;
    if (isManager) {
      pendingApprovals = await countPendingApprovalsForManager(businessId, employeeId);
    }

    return NextResponse.json({
      today: {
        date: today,
        attendance:
          deniedAttendance
            ? null
            : {
                checked_in: !!attendanceRow?.check_in_time,
                checked_out: !!attendanceRow?.check_out_time,
                check_in_time: attendanceRow?.check_in_time ?? null,
              },
      },
      leave_balances: leaveBalances.slice(0, 4),
      holidays,
      on_leave_today: onLeave,
      celebrations,
      announcements,
      pending_tasks: tasks.length,
      tasks_preview: tasks.slice(0, 5),
      pending_approvals: pendingApprovals,
      is_manager: isManager,
    });
  } catch (error) {
    console.error('[portal/dashboard GET]', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
