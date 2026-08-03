import { queryOne } from '@/lib/db';
import { checkUserPermissionWithAliases } from '@/lib/permissions';
import {
  getDirectReportIds,
  getEmployeeIdForUser,
  isReportingManager,
} from '@/lib/hr/manager-scope';

export type EmployeeListScope = 'all' | 'team' | 'self';

/** Full roster visibility (HR admin, payroll, or destructive employee access). */
export async function hasFullEmployeeRosterAccess(userId: string): Promise<boolean> {
  if (await checkUserPermissionWithAliases(userId, 'employees', 'create')) return true;
  if (await checkUserPermissionWithAliases(userId, 'employees', 'delete')) return true;
  if (await checkUserPermissionWithAliases(userId, 'payroll', 'read')) return true;
  if (await checkUserPermissionWithAliases(userId, 'payroll', 'create')) return true;
  if (await checkUserPermissionWithAliases(userId, 'payroll', 'update')) return true;
  return false;
}

export async function resolveEmployeeListScope(
  actorUserId: string,
  businessId: string,
  scopeParam: string | null
): Promise<EmployeeListScope> {
  const fullAccess = await hasFullEmployeeRosterAccess(actorUserId);
  const actorEmployeeId = await getEmployeeIdForUser(actorUserId, businessId);
  const isManager = actorEmployeeId ? await isReportingManager(actorEmployeeId) : false;

  if (scopeParam === 'all' && fullAccess) return 'all';
  if (scopeParam === 'team' && actorEmployeeId && isManager) return 'team';
  if (scopeParam === 'self' && actorEmployeeId) return 'self';

  if (fullAccess) return 'all';
  if (actorEmployeeId && isManager) return 'team';
  if (actorEmployeeId) return 'self';
  return 'all';
}

export async function canAccessEmployeeRecord(
  actorUserId: string,
  businessId: string,
  targetEmployeeId: string
): Promise<boolean> {
  if (await hasFullEmployeeRosterAccess(actorUserId)) return true;

  const actorEmployeeId = await getEmployeeIdForUser(actorUserId, businessId);
  if (actorEmployeeId && actorEmployeeId === targetEmployeeId) return true;

  if (actorEmployeeId) {
    const directReports = await getDirectReportIds(businessId, actorEmployeeId);
    if (directReports.includes(targetEmployeeId)) return true;
  }

  // Read-only HR viewers without employee linkage keep business-wide read via RBAC.
  const hasEmployeesRead = await checkUserPermissionWithAliases(actorUserId, 'employees', 'read');
  if (hasEmployeesRead && !actorEmployeeId) return true;

  return false;
}

/** SQL fragment restricting employee rows by list scope. $1 = business_id. */
export function buildEmployeeScopeSql(
  scope: EmployeeListScope,
  actorEmployeeId: string | null,
  startParamIndex: number
): { sql: string; params: string[] } {
  if (scope === 'all' || !actorEmployeeId) {
    return { sql: '', params: [] };
  }

  if (scope === 'self') {
    return {
      sql: ` AND e.id = $${startParamIndex}`,
      params: [actorEmployeeId],
    };
  }

  return {
    sql: ` AND (
      e.id = $${startParamIndex}
      OR e.reporting_manager_id = $${startParamIndex}
    )`,
    params: [actorEmployeeId],
  };
}

export async function getActorEmployeeId(
  actorUserId: string,
  businessId: string
): Promise<string | null> {
  return getEmployeeIdForUser(actorUserId, businessId);
}
