/**
 * Industry-standard seat model (Billing + HR + Connect):
 *
 * - **Console seat (max_users):** owner, cashier, HR admin, WhatsApp agent — anyone who
 *   logs into the business app with a role. Attendance-only workers on the HR roster do
 *   NOT consume a seat (BambooHR / Gusto-style: roster ≠ admin seat).
 *
 * - **Employee slot (max_employees):** people on the HR payroll/attendance roster.
 */

/**
 * SQL fragment: Billing/HR console seats counted against those plans' max_users ($1 = business_id).
 * Connect agents (`seat_type = 'connect'`) are a separate pool on the Connect plan.
 */
export const CONSOLE_SEAT_COUNT_SQL = `
  SELECT COUNT(*)::int AS count
  FROM users u
  WHERE u.business_id = $1
    AND COALESCE(u.is_active, true) = true
    AND COALESCE(u.seat_type, 'billing') <> 'connect'
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

export type SeatFields = {
  is_active: boolean | null;
  is_primary_admin: boolean | null;
  role_id: string | null;
  /** The linked employees row's access_type; null/undefined when there is no employee row. */
  access_type: string | null;
  seat_type?: string | null;
};

/**
 * True when the user row counts against max_users, by the same rule as CONSOLE_SEAT_COUNT_SQL:
 * active, not a Connect agent, and (owner, or holds a role, or is not an attendance-only employee).
 * Keep this and the SQL above in step.
 */
export function userOccupiesConsoleSeat(u: SeatFields): boolean {
  if ((u.is_active ?? true) !== true) return false;
  if ((u.seat_type ?? 'billing') === 'connect') return false;
  return (
    (u.is_primary_admin ?? false) === true ||
    u.role_id != null ||
    (u.access_type ?? 'full') !== 'attendance_only'
  );
}

/** Active Connect agents, counted against the Connect plan's max_users ($1 = business_id). */
export const CONNECT_AGENT_SEAT_COUNT_SQL = `
  SELECT COUNT(*)::int AS count
  FROM users u
  WHERE u.business_id = $1
    AND COALESCE(u.is_active, true) = true
    AND u.seat_type = 'connect'
`;

/** Active employees on the HR roster ($1 = business_id). */
export const ACTIVE_EMPLOYEE_COUNT_SQL = `
  SELECT COUNT(*)::int AS count
  FROM employees
  WHERE business_id = $1
    AND COALESCE(is_active, true) = true
`;
