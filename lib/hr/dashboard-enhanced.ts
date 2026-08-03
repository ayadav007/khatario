import { queryOne, queryRows } from '@/lib/db';
import { format } from 'date-fns';

export type HrDashboardEnhanced = {
  headcount: number;
  pending_invites: number;
  pending_leaves: number;
  present_today: number;
  absent_today: number;
  in_probation: number;
  pending_exit_approvals: number;
  active_announcements: number;
  birthdays_this_week: number;
  new_joiners_this_month: number;
  date: string;
  notifications: Array<{ type: string; label: string; count: number; href: string }>;
};

export async function fetchHrDashboardEnhanced(businessId: string): Promise<HrDashboardEnhanced> {
  const today = format(new Date(), 'yyyy-MM-dd');

  const [
    headcount,
    pendingInvites,
    pendingLeaves,
    attendanceToday,
    inProbation,
    pendingExits,
    announcements,
    birthdays,
    newJoiners,
  ] = await Promise.all([
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM employees e
       INNER JOIN users u ON u.id = e.id
       WHERE e.business_id = $1 AND u.is_active = true`,
      [businessId],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM employees e
       INNER JOIN users u ON u.id = e.id
       WHERE e.business_id = $1 AND u.is_active = true
         AND e.portal_invited_at IS NOT NULL
         AND e.portal_registered_at IS NULL`,
      [businessId],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM leave_requests lr
       INNER JOIN employees e ON e.id = lr.employee_id
       WHERE e.business_id = $1 AND lr.status = 'pending'`,
      [businessId],
    ),
    queryOne<{ present: string; absent: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(a.status, 'absent') IN ('present', 'half_day'))::text AS present,
         COUNT(*) FILTER (WHERE COALESCE(a.status, 'absent') = 'absent')::text AS absent
       FROM employees e
       INNER JOIN users u ON u.id = e.id
       LEFT JOIN employee_attendance a ON a.employee_id = e.id AND a.date = $2::date
       WHERE e.business_id = $1 AND u.is_active = true`,
      [businessId, today],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM employees e
       INNER JOIN users u ON u.id = e.id
       WHERE e.business_id = $1 AND u.is_active = true
         AND e.probation_status = 'in_probation'`,
      [businessId],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM employee_exits
       WHERE business_id = $1 AND status IN ('pending_approval', 'approval_on_hold')`,
      [businessId],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM hr_announcements
       WHERE business_id = $1 AND is_active = true AND archived_at IS NULL
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
      [businessId],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM employees e
       INNER JOIN users u ON u.id = e.id
       WHERE e.business_id = $1 AND u.is_active = true
         AND e.date_of_birth IS NOT NULL
         AND EXTRACT(DOY FROM e.date_of_birth) BETWEEN EXTRACT(DOY FROM CURRENT_DATE)
           AND EXTRACT(DOY FROM CURRENT_DATE + INTERVAL '7 days')`,
      [businessId],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM employees e
       WHERE e.business_id = $1 AND e.joining_date >= date_trunc('month', CURRENT_DATE)::date`,
      [businessId],
    ),
  ]);

  const pendingInvitesN = parseInt(pendingInvites?.count ?? '0', 10);
  const pendingLeavesN = parseInt(pendingLeaves?.count ?? '0', 10);
  const pendingExitsN = parseInt(pendingExits?.count ?? '0', 10);
  const birthdaysN = parseInt(birthdays?.count ?? '0', 10);

  const notifications: HrDashboardEnhanced['notifications'] = [];
  if (pendingInvitesN > 0) {
    notifications.push({
      type: 'invites',
      label: 'Pending portal invites',
      count: pendingInvitesN,
      href: '/employees?filter=unregistered',
    });
  }
  if (pendingLeavesN > 0) {
    notifications.push({
      type: 'leaves',
      label: 'Leave approvals pending',
      count: pendingLeavesN,
      href: '/employees/leaves',
    });
  }
  if (pendingExitsN > 0) {
    notifications.push({
      type: 'exits',
      label: 'Exit approvals pending',
      count: pendingExitsN,
      href: '/hr/exits',
    });
  }
  if (birthdaysN > 0) {
    notifications.push({
      type: 'birthdays',
      label: 'Birthdays this week',
      count: birthdaysN,
      href: '/hr/dashboard',
    });
  }

  return {
    headcount: parseInt(headcount?.count ?? '0', 10),
    pending_invites: pendingInvitesN,
    pending_leaves: pendingLeavesN,
    present_today: parseInt(attendanceToday?.present ?? '0', 10),
    absent_today: parseInt(attendanceToday?.absent ?? '0', 10),
    in_probation: parseInt(inProbation?.count ?? '0', 10),
    pending_exit_approvals: pendingExitsN,
    active_announcements: parseInt(announcements?.count ?? '0', 10),
    birthdays_this_week: birthdaysN,
    new_joiners_this_month: parseInt(newJoiners?.count ?? '0', 10),
    date: today,
    notifications,
  };
}

export async function fetchEmployeeRosterReport(businessId: string, filter: 'registered' | 'unregistered' | 'new_joinings') {
  if (filter === 'unregistered') {
    return queryRows(
      `SELECT e.employee_code, u.name, e.department, e.designation,
              e.portal_invited_at::text, e.joining_date::text
       FROM employees e INNER JOIN users u ON u.id = e.id
       WHERE e.business_id = $1 AND u.is_active = true
         AND e.portal_invited_at IS NOT NULL AND e.portal_registered_at IS NULL
       ORDER BY u.name`,
      [businessId],
    );
  }
  if (filter === 'new_joinings') {
    return queryRows(
      `SELECT e.employee_code, u.name, e.department, e.designation, e.joining_date::text
       FROM employees e INNER JOIN users u ON u.id = e.id
       WHERE e.business_id = $1 AND u.is_active = true
         AND e.joining_date >= date_trunc('month', CURRENT_DATE)::date
       ORDER BY e.joining_date DESC`,
      [businessId],
    );
  }
  return queryRows(
    `SELECT e.employee_code, u.name, e.department, e.designation,
            e.portal_registered_at::text AS registered_at, e.joining_date::text
     FROM employees e INNER JOIN users u ON u.id = e.id
     WHERE e.business_id = $1 AND u.is_active = true
       AND e.portal_registered_at IS NOT NULL
     ORDER BY u.name`,
    [businessId],
  );
}
