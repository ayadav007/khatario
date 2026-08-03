import { queryOne, queryRows } from '@/lib/db';
import { checkUserPermissionWithAliases } from '@/lib/permissions';
import {
  getHrApprovalSettings,
  type HrApprovalMode,
  type HrApprovalSettings,
} from '@/lib/hr/hr-approval-settings';

export type ApprovalResource = 'leave' | 'expense';

export async function getDirectReportIds(
  businessId: string,
  managerEmployeeId: string
): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    `SELECT id FROM employees
     WHERE business_id = $1 AND reporting_manager_id = $2 AND is_active = true`,
    [businessId, managerEmployeeId]
  );
  return rows.map((r) => r.id);
}

export async function isReportingManager(employeeId: string): Promise<boolean> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM employees
     WHERE reporting_manager_id = $1 AND is_active = true`,
    [employeeId]
  );
  return parseInt(row?.count ?? '0', 10) > 0;
}

export async function getEmployeeIdForUser(
  userId: string,
  businessId: string
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM employees WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [userId, businessId]
  );
  return row?.id ?? null;
}

function modeForResource(settings: HrApprovalSettings, resource: ApprovalResource): HrApprovalMode {
  return resource === 'leave' ? settings.leave_mode : settings.expense_mode;
}

export async function userHasHrOverride(
  userId: string,
  businessId: string,
  resource: ApprovalResource,
  settings: HrApprovalSettings
): Promise<boolean> {
  if (!settings.allow_hr_override) return false;
  const module = resource === 'leave' ? 'leave_requests' : 'expenses';
  return checkUserPermissionWithAliases(userId, module, 'update');
}

export async function canApproveForEmployee(
  actorUserId: string,
  businessId: string,
  requesterEmployeeId: string,
  resource: ApprovalResource,
  settings?: HrApprovalSettings
): Promise<boolean> {
  const cfg = settings ?? (await getHrApprovalSettings(businessId));
  const mode = modeForResource(cfg, resource);

  if (mode === 'permission_any') {
    const module = resource === 'leave' ? 'leave_requests' : 'expenses';
    return checkUserPermissionWithAliases(actorUserId, module, 'update');
  }

  const actorEmployeeId = await getEmployeeIdForUser(actorUserId, businessId);
  if (!actorEmployeeId) {
    return userHasHrOverride(actorUserId, businessId, resource, cfg);
  }

  const requester = await queryOne<{ reporting_manager_id: string | null }>(
    `SELECT reporting_manager_id FROM employees WHERE id = $1 AND business_id = $2`,
    [requesterEmployeeId, businessId]
  );

  if (requester?.reporting_manager_id === actorEmployeeId) {
    return true;
  }

  if (mode === 'manager_direct_reports') {
    return userHasHrOverride(actorUserId, businessId, resource, cfg);
  }

  // manager_only — only direct manager
  return false;
}

export async function canActOnLeaveRequest(
  actorUserId: string,
  leaveRequestId: string,
  businessId: string
): Promise<boolean> {
  const row = await queryOne<{ employee_id: string }>(
    `SELECT lr.employee_id
     FROM leave_requests lr
     INNER JOIN employees e ON lr.employee_id = e.id
     WHERE lr.id = $1 AND e.business_id = $2`,
    [leaveRequestId, businessId]
  );
  if (!row) return false;
  return canApproveForEmployee(actorUserId, businessId, row.employee_id, 'leave');
}

export async function canActOnExpense(
  actorUserId: string,
  expenseId: string,
  businessId: string
): Promise<boolean> {
  const row = await queryOne<{ employee_id: string }>(
    `SELECT e.employee_id
     FROM employee_expenses e
     INNER JOIN employees emp ON e.employee_id = emp.id
     WHERE e.id = $1 AND emp.business_id = $2`,
    [expenseId, businessId]
  );
  if (!row) return false;
  return canApproveForEmployee(actorUserId, businessId, row.employee_id, 'expense');
}

/** SQL fragment: filter rows to direct reports of managerEmployeeId */
export function teamEmployeeFilterSql(
  column: string,
  paramIndex: number
): string {
  return `${column} IN (
    SELECT id FROM employees
    WHERE business_id = $1 AND reporting_manager_id = $${paramIndex} AND is_active = true
  )`;
}

export async function resolveListScope(
  actorUserId: string,
  businessId: string,
  resource: ApprovalResource,
  scopeParam: string | null
): Promise<'all' | 'team' | 'self'> {
  const settings = await getHrApprovalSettings(businessId);
  const mode = modeForResource(settings, resource);
  const actorEmployeeId = await getEmployeeIdForUser(actorUserId, businessId);
  const isManager = actorEmployeeId ? await isReportingManager(actorEmployeeId) : false;
  const hasHrRead =
    resource === 'leave'
      ? await checkUserPermissionWithAliases(actorUserId, 'leave_requests', 'read')
      : await checkUserPermissionWithAliases(actorUserId, 'expenses', 'read');

  if (scopeParam === 'all' && hasHrRead) return 'all';
  if (scopeParam === 'team' && actorEmployeeId && isManager) return 'team';
  if (scopeParam === 'self') return 'self';

  if (mode !== 'permission_any' && actorEmployeeId && isManager) return 'team';
  if (hasHrRead) return 'all';
  if (actorEmployeeId) return 'self';
  return 'all';
}

/** Detect reporting_manager_id cycle if newManagerId were set on employeeId */
export async function wouldCreateReportingCycle(
  businessId: string,
  employeeId: string,
  newManagerId: string | null
): Promise<boolean> {
  if (!newManagerId) return false;
  if (newManagerId === employeeId) return true;

  let current: string | null = newManagerId;
  const visited = new Set<string>();
  const maxDepth = 500;

  for (let i = 0; i < maxDepth && current; i++) {
    if (current === employeeId) return true;
    if (visited.has(current)) return true;
    visited.add(current);

    const row = await queryOne<{ reporting_manager_id: string | null }>(
      `SELECT reporting_manager_id FROM employees WHERE id = $1 AND business_id = $2`,
      [current, businessId]
    );
    current = row?.reporting_manager_id ?? null;
  }

  return false;
}

export function isEmployeePortalSession(request: { headers: { get(name: string): string | null } }): boolean {
  return request.headers.get('x-employee-portal-session') === '1';
}
