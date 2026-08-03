import { queryRows } from '@/lib/db';

export async function fetchAttendanceRegister(
  businessId: string,
  year: number,
  month: number,
): Promise<unknown[][]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  const rows = await queryRows<{
    employee_code: string;
    employee_name: string;
    department: string | null;
    date: string;
    status: string;
    check_in_time: string | null;
    check_out_time: string | null;
    is_late: boolean;
    late_minutes: number;
  }>(
    `SELECT e.employee_code, u.name AS employee_name, e.department,
            a.date::text, a.status, a.check_in_time::text, a.check_out_time::text,
            a.is_late, a.late_minutes
     FROM employee_attendance a
     INNER JOIN employees e ON e.id = a.employee_id
     INNER JOIN users u ON u.id = e.id
     WHERE e.business_id = $1 AND a.date >= $2::date AND a.date <= $3::date
     ORDER BY a.date, u.name`,
    [businessId, start, end],
  );

  return rows.map((r) => [
    r.employee_code,
    r.employee_name,
    r.department ?? '',
    r.date,
    r.status,
    r.check_in_time ?? '',
    r.check_out_time ?? '',
    r.is_late ? 'Yes' : 'No',
    r.late_minutes,
  ]);
}

export async function fetchLeaveBalances(businessId: string, year: number): Promise<unknown[][]> {
  const rows = await queryRows<{
    employee_code: string;
    employee_name: string;
    leave_type: string;
    opening_balance: number;
    earned_days: number;
    used_days: number;
    carry_forward_days: number;
    current_balance: number;
  }>(
    `SELECT e.employee_code, u.name AS employee_name, lt.leave_name AS leave_type,
            lb.opening_balance, lb.earned_days, lb.used_days, lb.carry_forward_days, lb.current_balance
     FROM leave_balances lb
     INNER JOIN employees e ON e.id = lb.employee_id
     INNER JOIN users u ON u.id = e.id
     INNER JOIN leave_types lt ON lt.id = lb.leave_type_id
     WHERE e.business_id = $1 AND lb.year = $2 AND e.is_active = true
     ORDER BY u.name, lt.leave_name`,
    [businessId, year],
  );

  return rows.map((r) => [
    r.employee_code,
    r.employee_name,
    r.leave_type,
    r.opening_balance,
    r.earned_days,
    r.used_days,
    r.carry_forward_days,
    r.current_balance,
  ]);
}

export async function fetchLeaveConsumption(businessId: string, year: number): Promise<unknown[][]> {
  const rows = await queryRows<{
    employee_code: string;
    employee_name: string;
    leave_name: string;
    start_date: string;
    end_date: string;
    total_days: number;
    status: string;
  }>(
    `SELECT e.employee_code, u.name AS employee_name, lt.leave_name,
            lr.start_date::text, lr.end_date::text, lr.total_days, lr.status
     FROM leave_requests lr
     INNER JOIN employees e ON e.id = lr.employee_id
     INNER JOIN users u ON u.id = e.id
     INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE e.business_id = $1 AND lr.status IN ('approved', 'pending')
       AND EXTRACT(YEAR FROM lr.start_date)::int = $2
     ORDER BY lr.start_date DESC, u.name`,
    [businessId, year],
  );

  return rows.map((r) => [
    r.employee_code,
    r.employee_name,
    r.leave_name,
    r.start_date,
    r.end_date,
    r.total_days,
    r.status,
  ]);
}

export async function fetchLeaveNegativeBalances(businessId: string, year: number): Promise<unknown[][]> {
  const rows = await queryRows<{
    employee_code: string;
    employee_name: string;
    leave_type: string;
    current_balance: number;
  }>(
    `SELECT e.employee_code, u.name AS employee_name, lt.leave_name AS leave_type, lb.current_balance
     FROM leave_balances lb
     INNER JOIN employees e ON e.id = lb.employee_id
     INNER JOIN users u ON u.id = e.id
     INNER JOIN leave_types lt ON lt.id = lb.leave_type_id
     WHERE e.business_id = $1 AND lb.year = $2 AND lb.current_balance < 0
     ORDER BY lb.current_balance, u.name`,
    [businessId, year],
  );

  return rows.map((r) => [r.employee_code, r.employee_name, r.leave_type, r.current_balance]);
}

export async function fetchLeaveAccrualRegister(businessId: string, year: number): Promise<unknown[][]> {
  const rows = await queryRows<{
    accrual_month: string;
    ran_at: string;
    summary: Record<string, unknown>;
  }>(
    `SELECT accrual_month::text, ran_at::text, summary
     FROM leave_accrual_runs
     WHERE business_id = $1
       AND EXTRACT(YEAR FROM accrual_month)::int IN ($2, $2 + 1)
     ORDER BY accrual_month DESC`,
    [businessId, year],
  );

  return rows.map((r) => [
    r.accrual_month,
    r.ran_at,
    String((r.summary as { credited?: number })?.credited ?? ''),
    String((r.summary as { employees?: number })?.employees ?? ''),
  ]);
}

export async function fetchLeaveCarryForward(businessId: string, year: number): Promise<unknown[][]> {
  const rows = await queryRows<{
    leave_year: number;
    ran_at: string;
    summary: Record<string, unknown>;
  }>(
    `SELECT leave_year, ran_at::text, summary
     FROM leave_year_end_runs
     WHERE business_id = $1 AND leave_year = $2
     ORDER BY ran_at DESC`,
    [businessId, year],
  );

  return rows.map((r) => [
    r.leave_year,
    r.ran_at,
    String((r.summary as { processed?: number })?.processed ?? ''),
    String((r.summary as { encashment_total?: number })?.encashment_total ?? ''),
  ]);
}

export async function fetchLeaveEncashment(businessId: string, year: number): Promise<unknown[][]> {
  const rows = await queryRows<{
    employee_code: string;
    employee_name: string;
    leave_name: string;
    leave_year: number;
    days: number;
    amount: number;
    status: string;
    salary_month: string | null;
  }>(
    `SELECT e.employee_code, u.name AS employee_name, lt.leave_name,
            le.leave_year, le.days, le.amount, le.status, sp.salary_month
     FROM leave_encashment_entries le
     INNER JOIN employees e ON e.id = le.employee_id
     INNER JOIN users u ON u.id = e.id
     INNER JOIN leave_types lt ON lt.id = le.leave_type_id
     LEFT JOIN salary_payments sp ON sp.id = le.salary_payment_id
     WHERE le.business_id = $1 AND le.leave_year = $2
     ORDER BY le.created_at DESC`,
    [businessId, year],
  );

  return rows.map((r) => [
    r.employee_code,
    r.employee_name,
    r.leave_name,
    r.leave_year,
    r.days,
    r.amount,
    r.status,
    r.salary_month ?? '',
  ]);
}

export async function fetchPayrollRegister(
  businessId: string,
  year: number,
  month: number,
): Promise<unknown[][]> {
  const salaryMonth = `${year}-${String(month).padStart(2, '0')}`;

  const rows = await queryRows<{
    employee_code: string;
    employee_name: string;
    department: string | null;
    gross_salary: number;
    net_salary: number;
    attendance_deduction: number;
    status: string;
    payment_date: string | null;
  }>(
    `SELECT e.employee_code, u.name AS employee_name, e.department,
            sp.gross_salary, sp.net_salary, sp.attendance_deduction, sp.status,
            sp.payment_date::text
     FROM salary_payments sp
     INNER JOIN employees e ON e.id = sp.employee_id
     INNER JOIN users u ON u.id = e.id
     WHERE sp.business_id = $1 AND sp.salary_month = $2
     ORDER BY u.name`,
    [businessId, salaryMonth],
  );

  return rows.map((r) => [
    r.employee_code,
    r.employee_name,
    r.department ?? '',
    r.gross_salary,
    r.net_salary,
    r.attendance_deduction,
    r.status,
    r.payment_date ?? '',
  ]);
}

export async function fetchOvertimeRegister(
  businessId: string,
  year: number,
  month: number,
): Promise<unknown[][]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  const rows = await queryRows<{
    employee_code: string;
    employee_name: string;
    department: string | null;
    request_date: string;
    total_hours: number;
    compensation_choice: string | null;
    status: string;
    reason: string | null;
  }>(
    `SELECT e.employee_code, u.name AS employee_name, e.department,
            o.request_date::text, o.total_hours, o.compensation_choice, o.status, o.reason
     FROM overtime_requests o
     INNER JOIN employees e ON e.id = o.employee_id
     INNER JOIN users u ON u.id = e.id
     WHERE o.business_id = $1 AND o.request_date >= $2::date AND o.request_date <= $3::date
     ORDER BY o.request_date, u.name`,
    [businessId, start, end],
  );

  return rows.map((r) => [
    r.employee_code,
    r.employee_name,
    r.department ?? '',
    r.request_date,
    r.total_hours,
    r.compensation_choice ?? '',
    r.status,
    r.reason ?? '',
  ]);
}

export async function fetchHeadcount(businessId: string): Promise<unknown[][]> {
  const rows = await queryRows<{
    department: string | null;
    employment_type: string;
    active_count: number;
  }>(
    `SELECT COALESCE(NULLIF(trim(department), ''), 'Unassigned') AS department,
            employment_type,
            COUNT(*)::int AS active_count
     FROM employees
     WHERE business_id = $1 AND is_active = true
     GROUP BY 1, 2
     ORDER BY 1, 2`,
    [businessId],
  );

  return rows.map((r) => [r.department, r.employment_type, r.active_count]);
}
