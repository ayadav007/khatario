/**
 * Industry-standard seat model (Billing + HR + Connect):
 *
 * - **Console seat (max_users):** owner, cashier, HR admin, WhatsApp agent — anyone who
 *   logs into the business app with a role. Attendance-only workers on the HR roster do
 *   NOT consume a seat (BambooHR / Gusto-style: roster ≠ admin seat).
 *
 * - **Employee slot (max_employees):** people on the HR payroll/attendance roster.
 */

/** SQL fragment: users who count toward max_users for a business ($1 = business_id). */
export const CONSOLE_SEAT_COUNT_SQL = `
  SELECT COUNT(*)::int AS count
  FROM users u
  WHERE u.business_id = $1
    AND COALESCE(u.is_active, true) = true
    AND (
      COALESCE(u.is_primary_admin, false) = true
      OR u.role_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = u.id
          AND COALESCE(e.access_type, 'full') = 'attendance_only'
      )
    )
`;

/** Active employees on the HR roster ($1 = business_id). */
export const ACTIVE_EMPLOYEE_COUNT_SQL = `
  SELECT COUNT(*)::int AS count
  FROM employees
  WHERE business_id = $1
    AND COALESCE(is_active, true) = true
`;
