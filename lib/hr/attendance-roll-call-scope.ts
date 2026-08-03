import { queryOne, queryRows } from '@/lib/db';
import { checkUserPermissionWithAliases } from '@/lib/permissions';
import { getDirectReportIds, getEmployeeIdForUser, isReportingManager } from '@/lib/hr/manager-scope';

export type AttendanceRollCallScope = 'team' | 'all' | 'none';

async function listActiveEmployeeIds(businessId: string): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    `SELECT e.id
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     WHERE e.business_id = $1 AND e.is_active = true AND u.is_active = true
     ORDER BY u.name`,
    [businessId],
  );
  return rows.map((r) => r.id);
}

export async function getAttendanceRollCallScope(
  actorUserId: string,
  businessId: string,
): Promise<{
  employeeIds: string[];
  scope: AttendanceRollCallScope;
  isReportingManager: boolean;
}> {
  const actor = await queryOne<{ is_primary_admin?: boolean }>(
    'SELECT is_primary_admin FROM users WHERE id = $1',
    [actorUserId],
  );

  const actorEmployeeId = await getEmployeeIdForUser(actorUserId, businessId);
  const isManager = actorEmployeeId ? await isReportingManager(actorEmployeeId) : false;

  // Business owner always sees full roster on roll call (matches authorize() bypass).
  if (actor?.is_primary_admin) {
    return {
      employeeIds: await listActiveEmployeeIds(businessId),
      scope: 'all',
      isReportingManager: isManager,
    };
  }

  if (isManager && actorEmployeeId) {
    const teamIds = await getDirectReportIds(businessId, actorEmployeeId);
    if (teamIds.length > 0) {
      return { employeeIds: teamIds, scope: 'team', isReportingManager: true };
    }
  }

  const canMark = await checkUserPermissionWithAliases(actorUserId, 'attendance', 'create');
  if (canMark) {
    return {
      employeeIds: await listActiveEmployeeIds(businessId),
      scope: 'all',
      isReportingManager: isManager,
    };
  }

  return { employeeIds: [], scope: 'none', isReportingManager: isManager };
}