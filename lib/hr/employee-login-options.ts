import { queryOne, queryRows } from '@/lib/db';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import {
  isSystemRoleVisibleForModules,
  sortRolesForModules,
} from '@/lib/rbac-role-catalog';
import { checkLimit } from '@/lib/subscription';
import {
  decideEmployeeLoginAssignment,
  roleVisibleForEmployeeAssignment,
  type LoginAssignmentDecision,
} from '@/lib/hr/employee-login-assignment';

export type EmployeeLoginRoleOption = {
  id: string;
  role_key: string;
  role_name: string;
};

export async function loadEmployeeLoginOptions(businessId: string, actorUserId: string) {
  const actor = await queryOne<{ is_primary_admin: boolean | null }>(
    `SELECT is_primary_admin FROM users WHERE id = $1 AND business_id = $2`,
    [actorUserId, businessId],
  );
  const actorIsOwner = actor?.is_primary_admin === true;
  const seats = await checkLimit(businessId, 'users');
  const platformCtx = await getBusinessPlatformContext(businessId);
  const allRoles = await queryRows<EmployeeLoginRoleOption>(
    `SELECT id, role_key, role_name
     FROM user_roles
     WHERE business_id = $1 AND COALESCE(is_active, true) = true`,
    [businessId],
  );
  const visible = sortRolesForModules(
    allRoles.filter((role) => isSystemRoleVisibleForModules(role.role_key, platformCtx.enabledModules)),
    platformCtx.enabledModules,
  ).filter((role) => roleVisibleForEmployeeAssignment(role.role_key, actorIsOwner));

  return {
    actorIsOwner,
    canAssignLogin: seats.allowed,
    seats: { current: seats.current, limit: seats.limit },
    roles: visible.map((role) => ({
      id: role.id,
      role_key: role.role_key,
      role_name: role.role_name,
    })),
  };
}

export async function resolveEmployeeLoginDecision(params: {
  businessId: string;
  actorUserId: string;
  roleId: unknown;
  password: unknown;
  alreadyConsumesSeat: boolean;
}): Promise<LoginAssignmentDecision> {
  const roleId = typeof params.roleId === 'string' && params.roleId.trim() ? params.roleId.trim() : null;
  const password = typeof params.password === 'string' ? params.password : null;
  const actor = await queryOne<{ is_primary_admin: boolean | null }>(
    `SELECT is_primary_admin FROM users WHERE id = $1 AND business_id = $2`,
    [params.actorUserId, params.businessId],
  );
  const seats = await checkLimit(params.businessId, 'users');
  const role = roleId
    ? await queryOne<{ role_key: string }>(
        `SELECT role_key FROM user_roles
         WHERE id = $1 AND business_id = $2 AND COALESCE(is_active, true) = true`,
        [roleId, params.businessId],
      )
    : null;

  return decideEmployeeLoginAssignment({
    roleId,
    roleKey: role?.role_key ?? null,
    password,
    actorIsOwner: actor?.is_primary_admin === true,
    seatsAllowed: seats.allowed,
    alreadyConsumesSeat: params.alreadyConsumesSeat,
  });
}
