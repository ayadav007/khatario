/**
 * Single registry: limitType → platform limit_key → usage count SQL.
 * Used by checkLimit and checkLimitInTransaction.
 */

export type LimitCheckType =
  | 'invoices'
  | 'customers'
  | 'items'
  | 'users'
  | 'whatsapp'
  | 'employees'
  | 'attendance'
  | 'leave_requests'
  | 'payroll'
  | 'suppliers'
  | 'purchases'
  | 'expenses'
  | 'estimates'
  | 'credit_notes'
  | 'sales_orders'
  | 'purchase_orders'
  | 'branches'
  | 'departments'
  | 'email'
  | 'salary_advances'
  | 'employee_expenses'
  | 'commissions'
  | 'employee_tasks'
  | 'holidays'
  | 'shifts'
  | 'designations'
  | 'performance_reviews';

export const LIMIT_KEY_BY_TYPE: Record<LimitCheckType, string> = {
  invoices: 'max_invoices_per_month',
  customers: 'max_customers',
  items: 'max_items',
  users: 'max_users',
  whatsapp: 'max_whatsapp_per_day',
  employees: 'max_employees',
  attendance: 'max_attendance_records_per_month',
  leave_requests: 'max_leave_requests_per_month',
  payroll: 'max_payroll_records_per_month',
  suppliers: 'max_suppliers',
  purchases: 'max_purchases_per_month',
  expenses: 'max_expenses_per_month',
  estimates: 'max_estimates_per_month',
  credit_notes: 'max_credit_notes_per_month',
  sales_orders: 'max_sales_orders_per_month',
  purchase_orders: 'max_purchase_orders_per_month',
  branches: 'max_branches',
  departments: 'max_departments',
  email: 'max_email_per_day',
  salary_advances: 'max_salary_advances_per_month',
  employee_expenses: 'max_employee_expenses_per_month',
  commissions: 'max_commissions_per_month',
  employee_tasks: 'max_employee_tasks_per_month',
  holidays: 'max_holidays',
  shifts: 'max_shifts',
  designations: 'max_designations',
  performance_reviews: 'max_performance_reviews_per_month',
};

/** JSONB fallback: registry limit_key → same key in features.limits. */
export const LIMIT_JSONB_KEY_MAP: Record<string, string> = Object.fromEntries(
  Object.values(LIMIT_KEY_BY_TYPE).map((k) => [k, k])
);

/** All limit types (for usage summary / notifications). */
export const ALL_LIMIT_CHECK_TYPES = Object.keys(LIMIT_KEY_BY_TYPE) as LimitCheckType[];

type CountQuery = { sql: string; params: [string] };

export function buildLimitCountQuery(limitType: LimitCheckType, businessId: string): CountQuery {
  const p: [string] = [businessId];
  const monthStart = `DATE_TRUNC('month', CURRENT_DATE)`;
  const todayStart = `CURRENT_DATE`;

  switch (limitType) {
    case 'invoices':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM invoices WHERE business_id = $1 AND created_at >= ${monthStart}`,
        params: p,
      };
    case 'customers':
      return { sql: `SELECT COUNT(*)::int AS count FROM customers WHERE business_id = $1`, params: p };
    case 'items':
      return { sql: `SELECT COUNT(*)::int AS count FROM items WHERE business_id = $1`, params: p };
    case 'users':
      return { sql: `SELECT COUNT(*)::int AS count FROM users WHERE business_id = $1`, params: p };
    case 'whatsapp':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM whatsapp_messages WHERE business_id = $1 AND sent_at >= ${todayStart}`,
        params: p,
      };
    case 'employees':
      return { sql: `SELECT COUNT(*)::int AS count FROM employees WHERE business_id = $1`, params: p };
    case 'attendance':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM employee_attendance ea
              INNER JOIN employees e ON e.id = ea.employee_id
              WHERE e.business_id = $1 AND ea.date >= ${monthStart}::date`,
        params: p,
      };
    case 'leave_requests':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM leave_requests lr
              INNER JOIN employees e ON e.id = lr.employee_id
              WHERE e.business_id = $1 AND lr.created_at >= ${monthStart}`,
        params: p,
      };
    case 'payroll':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM salary_payments WHERE business_id = $1 AND payment_date >= ${monthStart}`,
        params: p,
      };
    case 'suppliers':
      return { sql: `SELECT COUNT(*)::int AS count FROM suppliers WHERE business_id = $1`, params: p };
    case 'purchases':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM purchases WHERE business_id = $1 AND deleted_at IS NULL AND bill_date >= ${monthStart}::date`,
        params: p,
      };
    case 'expenses':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM expenses WHERE business_id = $1 AND expense_date >= ${monthStart}`,
        params: p,
      };
    case 'estimates':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM estimates WHERE business_id = $1 AND created_at >= ${monthStart}`,
        params: p,
      };
    case 'credit_notes':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM credit_notes WHERE business_id = $1 AND created_at >= ${monthStart}`,
        params: p,
      };
    case 'sales_orders':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM sales_orders WHERE business_id = $1 AND created_at >= ${monthStart}`,
        params: p,
      };
    case 'purchase_orders':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM purchase_orders WHERE business_id = $1 AND created_at >= ${monthStart}`,
        params: p,
      };
    case 'branches':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM branches WHERE business_id = $1 AND (is_active IS NULL OR is_active = true)`,
        params: p,
      };
    case 'departments':
      return {
        sql: `SELECT COUNT(DISTINCT department)::int AS count FROM employees WHERE business_id = $1 AND department IS NOT NULL AND TRIM(department) <> ''`,
        params: p,
      };
    case 'designations':
      return {
        sql: `SELECT COUNT(DISTINCT designation)::int AS count FROM employees WHERE business_id = $1 AND designation IS NOT NULL AND TRIM(designation) <> ''`,
        params: p,
      };
    case 'email':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM platform_email_logs WHERE business_id = $1 AND created_at >= ${todayStart}`,
        params: p,
      };
    case 'salary_advances':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM salary_advances WHERE business_id = $1 AND created_at >= ${monthStart}`,
        params: p,
      };
    case 'employee_expenses':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM employee_expenses ex
              INNER JOIN employees e ON e.id = ex.employee_id
              WHERE e.business_id = $1 AND ex.submitted_at >= ${monthStart}`,
        params: p,
      };
    case 'commissions':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM commission_earnings ce
              INNER JOIN employees e ON e.id = ce.employee_id
              WHERE e.business_id = $1 AND ce.created_at >= ${monthStart}`,
        params: p,
      };
    case 'employee_tasks':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM tasks WHERE business_id = $1 AND created_at >= ${monthStart}`,
        params: p,
      };
    case 'holidays':
      return { sql: `SELECT COUNT(*)::int AS count FROM holidays WHERE business_id = $1`, params: p };
    case 'shifts':
      return { sql: `SELECT COUNT(*)::int AS count FROM shifts WHERE business_id = $1`, params: p };
    case 'performance_reviews':
      return {
        sql: `SELECT COUNT(*)::int AS count FROM employee_performance ep
              INNER JOIN employees e ON e.id = ep.employee_id
              WHERE e.business_id = $1 AND ep.created_at >= ${monthStart}`,
        params: p,
      };
    default: {
      const _exhaustive: never = limitType;
      return _exhaustive;
    }
  }
}
