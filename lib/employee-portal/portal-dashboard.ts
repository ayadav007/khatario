import { queryRows, queryOne } from '@/lib/db';

export type PortalLeaveBalanceCard = {
  leave_type_id: string;
  leave_name: string;
  leave_code: string;
  available: number;
  consumed: number;
  accrued_so_far: number;
  annual_quota: number | null;
};

export type PortalLeaveRequestRow = {
  id: string;
  leave_name: string;
  start_date: string;
  end_date: string;
  total_days: number;
  status: string;
  reason: string | null;
  created_at: string;
  approved_at: string | null;
  approver_name: string | null;
  is_past: boolean;
};

export async function fetchPortalLeaveBalances(
  businessId: string,
  employeeId: string,
  year: number,
): Promise<PortalLeaveBalanceCard[]> {
  const rows = await queryRows<{
    leave_type_id: string;
    leave_name: string;
    leave_code: string;
    current_balance: string;
    used_days: string;
    earned_days: string;
    opening_balance: string;
    carry_forward_days: string;
    max_days_per_year: number | null;
  }>(
    `SELECT lb.leave_type_id, lt.leave_name, lt.leave_code,
            lb.current_balance, lb.used_days, lb.earned_days,
            lb.opening_balance, lb.carry_forward_days, lt.max_days_per_year
     FROM leave_balances lb
     INNER JOIN leave_types lt ON lt.id = lb.leave_type_id
     INNER JOIN employees e ON e.id = lb.employee_id
     WHERE e.business_id = $1 AND lb.employee_id = $2 AND lb.year = $3 AND lt.is_active = true
     ORDER BY lt.leave_name`,
    [businessId, employeeId, year],
  );

  return rows.map((r) => {
    const opening = Number(r.opening_balance) || 0;
    const earned = Number(r.earned_days) || 0;
    const carry = Number(r.carry_forward_days) || 0;
    const accrued = opening + earned + carry;
    return {
      leave_type_id: r.leave_type_id,
      leave_name: r.leave_name,
      leave_code: r.leave_code,
      available: Number(r.current_balance) || 0,
      consumed: Number(r.used_days) || 0,
      accrued_so_far: accrued,
      annual_quota: r.max_days_per_year,
    };
  });
}

export async function fetchPortalLeaveRequests(
  businessId: string,
  employeeId: string,
): Promise<PortalLeaveRequestRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await queryRows<{
    id: string;
    leave_name: string;
    start_date: string;
    end_date: string;
    total_days: string;
    status: string;
    reason: string | null;
    created_at: string;
    approved_at: string | null;
    approver_name: string | null;
  }>(
    `SELECT lr.id, lt.leave_name, lr.start_date::text, lr.end_date::text,
            lr.total_days, lr.status, lr.reason, lr.created_at::text,
            lr.approved_at::text, approver_user.name AS approver_name
     FROM leave_requests lr
     INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
     INNER JOIN employees e ON e.id = lr.employee_id
     LEFT JOIN employees approver ON approver.id = lr.approved_by
     LEFT JOIN users approver_user ON approver_user.id = approver.id
     WHERE e.business_id = $1 AND lr.employee_id = $2
     ORDER BY lr.start_date DESC, lr.created_at DESC
     LIMIT 200`,
    [businessId, employeeId],
  );

  return rows.map((r) => ({
    id: r.id,
    leave_name: r.leave_name,
    start_date: r.start_date,
    end_date: r.end_date,
    total_days: Number(r.total_days) || 0,
    status: r.status,
    reason: r.reason,
    created_at: r.created_at,
    approved_at: r.approved_at,
    approver_name: r.approver_name,
    is_past: r.end_date < today,
  }));
}

export async function fetchPortalLeaveInsights(
  businessId: string,
  employeeId: string,
  year: number,
): Promise<{
  weekly_pattern: Array<{ day: string; count: number }>;
  consumed_by_type: Array<{ name: string; days: number }>;
  monthly_stats: Array<{ month: string; days: number }>;
}> {
  const approved = await queryRows<{
    start_date: string;
    end_date: string;
    total_days: string;
    leave_name: string;
  }>(
    `SELECT lr.start_date::text, lr.end_date::text, lr.total_days, lt.leave_name
     FROM leave_requests lr
     INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
     INNER JOIN employees e ON e.id = lr.employee_id
     WHERE e.business_id = $1 AND lr.employee_id = $2
       AND lr.status IN ('approved', 'pending', 'partially_approved')
       AND EXTRACT(YEAR FROM lr.start_date) = $3`,
    [businessId, employeeId, year],
  );

  const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekly = dayOrder.map((day) => ({ day, count: 0 }));
  const byType = new Map<string, number>();
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: new Date(2000, i, 1).toLocaleString('en-IN', { month: 'short' }),
    days: 0,
  }));

  for (const row of approved) {
    const days = Number(row.total_days) || 0;
    byType.set(row.leave_name, (byType.get(row.leave_name) ?? 0) + days);

    const start = new Date(row.start_date);
    const monthIdx = start.getMonth();
    monthly[monthIdx].days += days;

    const jsDay = start.getDay();
    const idx = jsDay === 0 ? 6 : jsDay - 1;
    weekly[idx].count += days;
  }

  return {
    weekly_pattern: weekly,
    consumed_by_type: Array.from(byType.entries()).map(([name, days]) => ({ name, days })),
    monthly_stats: monthly,
  };
}

export async function fetchUpcomingHolidays(businessId: string, limit = 3) {
  return queryRows<{ holiday_date: string; holiday_name: string }>(
    `SELECT holiday_date::text, holiday_name FROM holidays
     WHERE business_id = $1 AND holiday_date >= CURRENT_DATE
     ORDER BY holiday_date ASC LIMIT $2`,
    [businessId, limit],
  );
}

export async function fetchOnLeaveToday(businessId: string, excludeEmployeeId?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const params: unknown[] = [businessId, today];
  let exclude = '';
  if (excludeEmployeeId) {
    exclude = ` AND e.id != $3`;
    params.push(excludeEmployeeId);
  }
  return queryRows<{ name: string; leave_name: string }>(
    `SELECT u.name, lt.leave_name
     FROM leave_requests lr
     INNER JOIN employees e ON e.id = lr.employee_id
     INNER JOIN users u ON u.id = e.id
     INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE e.business_id = $1 AND lr.status = 'approved'
       AND lr.start_date <= $2::date AND lr.end_date >= $2::date
       ${exclude}
     ORDER BY u.name LIMIT 20`,
    params,
  );
}

export async function fetchCelebrations(businessId: string) {
  const today = new Date();
  const md = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const mdTomorrow = `${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  const birthdays = await queryRows<{ name: string; when: 'today' | 'tomorrow' }>(
    `SELECT u.name,
            CASE
              WHEN to_char(e.date_of_birth, 'MM-DD') = $2 THEN 'today'
              ELSE 'tomorrow'
            END AS when
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     WHERE e.business_id = $1 AND e.is_active = true AND e.date_of_birth IS NOT NULL
       AND to_char(e.date_of_birth, 'MM-DD') IN ($2, $3)`,
    [businessId, md, mdTomorrow],
  );

  const anniversaries = await queryRows<{ name: string; years: number; when: 'today' | 'tomorrow' }>(
    `SELECT u.name,
            EXTRACT(YEAR FROM age(CURRENT_DATE, e.joining_date))::int AS years,
            CASE
              WHEN to_char(e.joining_date, 'MM-DD') = $2 THEN 'today'
              ELSE 'tomorrow'
            END AS when
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     WHERE e.business_id = $1 AND e.is_active = true AND e.joining_date IS NOT NULL
       AND to_char(e.joining_date, 'MM-DD') IN ($2, $3)
       AND e.joining_date < CURRENT_DATE`,
    [businessId, md, mdTomorrow],
  );

  return { birthdays, anniversaries };
}

export async function fetchAnnouncements(businessId: string, limit = 5) {
  return queryRows<{
    id: string;
    title: string;
    body: string | null;
    author_name: string | null;
    published_at: string;
  }>(
    `SELECT id, title, body, author_name, published_at::text
     FROM hr_announcements
     WHERE business_id = $1 AND is_active = true
     ORDER BY published_at DESC LIMIT $2`,
    [businessId, limit],
  );
}

export async function fetchEmployeeTasks(businessId: string, employeeId: string) {
  return queryRows<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    created_at: string;
    assigner_name: string | null;
  }>(
    `SELECT t.id, t.title, t.description, t.status, t.priority,
            t.due_date::text, t.created_at::text, assigner_user.name AS assigner_name
     FROM tasks t
     LEFT JOIN employees assigner ON assigner.id = t.assigned_by
     LEFT JOIN users assigner_user ON assigner_user.id = assigner.id
     WHERE t.business_id = $1 AND t.assigned_to = $2
       AND t.status NOT IN ('completed', 'cancelled')
     ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC
     LIMIT 100`,
    [businessId, employeeId],
  );
}

export async function countPendingApprovalsForManager(
  businessId: string,
  managerEmployeeId: string,
): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM leave_requests lr
     INNER JOIN employees e ON e.id = lr.employee_id
     WHERE e.business_id = $1 AND e.reporting_manager_id = $2 AND lr.status = 'pending'`,
    [businessId, managerEmployeeId],
  );
  return Number(row?.count ?? 0);
}
