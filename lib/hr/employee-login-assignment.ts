/**
 * Who may be given a Khatario login when they are added or edited as an employee.
 * Attendance-only staff do not take a user seat. A sign-in role does.
 * Connect / WhatsApp agent assignment is intentionally not offered here.
 */

export const ADMIN_ROLE_KEYS = new Set(['primary_admin', 'admin']);
export const EXCLUDED_EMPLOYEE_ROLE_KEYS = new Set(['whatsapp_agent']);

export type LoginAssignmentInput = {
  roleId: string | null;
  /** Null when the role id is not an active role in this business. */
  roleKey: string | null;
  password: string | null;
  actorIsOwner: boolean;
  /** True when checkLimit('users') still has room for one more login. */
  seatsAllowed: boolean;
  /** True when this person already counts as a console user. */
  alreadyConsumesSeat: boolean;
};

export type LoginAssignmentDecision =
  | { ok: true; mode: 'attendance' }
  | { ok: true; mode: 'login'; roleId: string }
  | { ok: false; status: number; error: string; code: string };

export function decideEmployeeLoginAssignment(input: LoginAssignmentInput): LoginAssignmentDecision {
  const roleId = input.roleId?.trim() || null;
  if (!roleId) {
    return { ok: true, mode: 'attendance' };
  }

  if (!input.roleKey || EXCLUDED_EMPLOYEE_ROLE_KEYS.has(input.roleKey)) {
    return {
      ok: false,
      status: 400,
      error: 'That role is not available for an employee.',
      code: 'INVALID_ROLE',
    };
  }

  if (ADMIN_ROLE_KEYS.has(input.roleKey) && !input.actorIsOwner) {
    return {
      ok: false,
      status: 403,
      error: 'Only the business owner can assign an admin role.',
      code: 'ADMIN_ROLE_FORBIDDEN',
    };
  }

  if (!input.alreadyConsumesSeat && !input.seatsAllowed) {
    return {
      ok: false,
      status: 403,
      error: 'No login seats left. Add this person for attendance only, or upgrade your plan.',
      code: 'USER_SEAT_LIMIT',
    };
  }

  const password = input.password?.trim() || '';
  if (!input.alreadyConsumesSeat && !password) {
    return {
      ok: false,
      status: 400,
      error: 'A password is required when assigning a sign-in role.',
      code: 'PASSWORD_REQUIRED',
    };
  }
  if (password && (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))) {
    return {
      ok: false,
      status: 400,
      error: 'Password must be at least 8 characters and include a letter and a number.',
      code: 'PASSWORD_TOO_SHORT',
    };
  }

  return { ok: true, mode: 'login', roleId };
}

export function roleVisibleForEmployeeAssignment(
  roleKey: string,
  actorIsOwner: boolean,
): boolean {
  if (EXCLUDED_EMPLOYEE_ROLE_KEYS.has(roleKey)) return false;
  if (ADMIN_ROLE_KEYS.has(roleKey) && !actorIsOwner) return false;
  return true;
}
