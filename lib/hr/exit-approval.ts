import { query, queryOne, queryRows } from '@/lib/db';
import { checkUserPermissionWithAliases } from '@/lib/permissions';
import { resolveDepartmentHeadEmployeeId } from '@/lib/hr/department-head';
import {
  getHrExitSettings,
  type ExitApprovalChainLevel,
  type ExitApproverRoleType,
} from '@/lib/hr/exit-settings';
import { fetchOrgChartEmployees } from '@/lib/hr/org-chart';

export type ExitApprovalRow = {
  id: string;
  exit_id: string;
  approval_level: number;
  level_label: string | null;
  role_type: ExitApproverRoleType;
  approver_user_id: string | null;
  approver_name: string | null;
  status: string;
  hold_reason: string | null;
  comments: string | null;
  exception_granted_by: string | null;
  exception_granted_at: string | null;
  decided_at: string | null;
};

export type ResolvedExitApprover = {
  level: number;
  label: string | null;
  role_type: ExitApproverRoleType;
  approver_user_id: string | null;
};

export async function resolveExitApprovalChain(
  businessId: string,
  employeeId: string,
  chain: ExitApprovalChainLevel[],
): Promise<ResolvedExitApprover[]> {
  const employee = await queryOne<{
    reporting_manager_id: string | null;
    department: string | null;
  }>(
    `SELECT reporting_manager_id, department FROM employees WHERE id = $1 AND business_id = $2`,
    [employeeId, businessId],
  );
  if (!employee) throw new Error('Employee not found');

  const orgEmployees = await fetchOrgChartEmployees(businessId);
  const resolved: ResolvedExitApprover[] = [];
  let previousUserId: string | null = null;

  for (const step of chain.sort((a, b) => a.level - b.level)) {
    let approverUserId: string | null = null;

    switch (step.role_type) {
      case 'reporting_manager':
        approverUserId = employee.reporting_manager_id;
        break;
      case 'department_head':
        approverUserId = resolveDepartmentHeadEmployeeId(
          orgEmployees,
          employee.department,
          employeeId,
        );
        break;
      case 'specific_employee':
        approverUserId = step.employee_id ?? null;
        break;
      case 'hr':
        approverUserId = null;
        break;
      default:
        break;
    }

    if (step.role_type !== 'hr') {
      if (!approverUserId || approverUserId === employeeId) continue;
      if (approverUserId === previousUserId) continue;

      const valid = await queryOne<{ id: string }>(
        `SELECT e.id FROM employees e
         INNER JOIN users u ON u.id = e.id
         WHERE e.id = $1 AND e.business_id = $2 AND e.is_active = true AND u.is_active = true`,
        [approverUserId, businessId],
      );
      if (!valid) continue;
    } else {
      const last = resolved[resolved.length - 1];
      if (last?.role_type === 'hr') continue;
    }

    resolved.push({
      level: resolved.length + 1,
      label: step.label?.trim() || null,
      role_type: step.role_type,
      approver_user_id: approverUserId,
    });
    previousUserId = approverUserId;
  }

  return resolved;
}

export async function bootstrapExitApprovalChain(
  exitId: string,
  businessId: string,
  employeeId: string,
): Promise<void> {
  const cfg = await getHrExitSettings(businessId);

  if (
    cfg.exit_max_approval_levels != null &&
    cfg.exit_approval_chain.length > cfg.exit_max_approval_levels
  ) {
    throw new Error(
      `Exit approval chain template has too many levels (max ${cfg.exit_max_approval_levels})`,
    );
  }

  const resolved = await resolveExitApprovalChain(businessId, employeeId, cfg.exit_approval_chain);
  if (resolved.length === 0) {
    throw new Error(
      'Could not resolve exit approvers. Assign reporting managers, departments, or update the approval chain in Exit settings.',
    );
  }
  if (resolved.length < cfg.exit_min_approval_levels) {
    throw new Error(
      `Only ${resolved.length} approver(s) could be resolved; at least ${cfg.exit_min_approval_levels} required.`,
    );
  }

  await query(`DELETE FROM employee_exit_approvals WHERE exit_id = $1`, [exitId]);

  for (let i = 0; i < resolved.length; i++) {
    const step = resolved[i];
    await query(
      `INSERT INTO employee_exit_approvals (
         exit_id, business_id, approval_level, level_label, role_type,
         approver_user_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        exitId,
        businessId,
        step.level,
        step.label,
        step.role_type,
        step.approver_user_id,
        i === 0 ? 'awaiting' : 'pending',
      ],
    );
  }

  await query(
    `UPDATE employee_exits SET status = 'pending_approval', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [exitId],
  );
}

export async function listExitApprovals(exitId: string): Promise<ExitApprovalRow[]> {
  return queryRows<ExitApprovalRow>(
    `SELECT a.id, a.exit_id, a.approval_level, a.level_label, a.role_type,
            a.approver_user_id, u.name AS approver_name, a.status, a.hold_reason,
            a.comments, a.exception_granted_by::text, a.exception_granted_at::text,
            a.decided_at::text
     FROM employee_exit_approvals a
     LEFT JOIN users u ON u.id = a.approver_user_id
     WHERE a.exit_id = $1
     ORDER BY a.approval_level ASC`,
    [exitId],
  );
}

export async function getActiveExitApprovalLevel(exitId: string): Promise<number | null> {
  const row = await queryOne<{ approval_level: number }>(
    `SELECT approval_level FROM employee_exit_approvals
     WHERE exit_id = $1 AND status IN ('awaiting', 'on_hold')
     ORDER BY approval_level ASC LIMIT 1`,
    [exitId],
  );
  return row?.approval_level ?? null;
}

async function userIsHrExitApprover(userId: string, businessId: string): Promise<boolean> {
  return checkUserPermissionWithAliases(userId, 'employees', 'update');
}

export async function canActOnExitApprovalStep(
  exitId: string,
  businessId: string,
  actorUserId: string,
): Promise<{ ok: true; level: number; role_type: ExitApproverRoleType } | { ok: false; message: string }> {
  const exit = await queryOne<{ status: string }>(
    `SELECT status FROM employee_exits WHERE id = $1 AND business_id = $2`,
    [exitId, businessId],
  );
  if (!exit) return { ok: false, message: 'Exit not found' };
  if (!['pending_approval', 'approval_on_hold'].includes(exit.status)) {
    return { ok: false, message: 'Exit is not awaiting approval' };
  }

  const activeLevel = await getActiveExitApprovalLevel(exitId);
  if (activeLevel == null) return { ok: false, message: 'No active approval step' };

  const step = await queryOne<{ role_type: ExitApproverRoleType; approver_user_id: string | null }>(
    `SELECT role_type, approver_user_id FROM employee_exit_approvals
     WHERE exit_id = $1 AND approval_level = $2 AND status IN ('awaiting', 'on_hold')`,
    [exitId, activeLevel],
  );
  if (!step) return { ok: false, message: 'Approval step not found' };

  if (step.role_type === 'hr') {
    if (!(await userIsHrExitApprover(actorUserId, businessId))) {
      return { ok: false, message: 'Only HR can act on this approval step' };
    }
    return { ok: true, level: activeLevel, role_type: step.role_type };
  }

  if (step.approver_user_id !== actorUserId) {
    return { ok: false, message: 'You are not the approver for the current step' };
  }
  return { ok: true, level: activeLevel, role_type: step.role_type };
}

export async function getDepartmentHeadUserIdForExit(
  exitId: string,
  businessId: string,
): Promise<string | null> {
  const row = await queryOne<{ employee_id: string; department: string | null }>(
    `SELECT ex.employee_id, e.department
     FROM employee_exits ex
     INNER JOIN employees e ON e.id = ex.employee_id
     WHERE ex.id = $1 AND ex.business_id = $2`,
    [exitId, businessId],
  );
  if (!row) return null;
  const orgEmployees = await fetchOrgChartEmployees(businessId);
  return resolveDepartmentHeadEmployeeId(orgEmployees, row.department, row.employee_id);
}

export async function decideExitApproval(input: {
  exitId: string;
  businessId: string;
  actorUserId: string;
  action: 'approve' | 'hold' | 'reject' | 'grant_exception';
  hold_reason?: string;
  comments?: string;
}): Promise<{ ok: true; exit_status: string } | { ok: false; message: string }> {
  const exit = await queryOne<{ status: string }>(
    `SELECT status FROM employee_exits WHERE id = $1 AND business_id = $2`,
    [input.exitId, input.businessId],
  );
  if (!exit) return { ok: false, message: 'Exit not found' };

  if (input.action === 'reject') {
    if (!(await userIsHrExitApprover(input.actorUserId, input.businessId))) {
      return { ok: false, message: 'Only HR can reject an exit request' };
    }
    if (!['pending_approval', 'approval_on_hold'].includes(exit.status)) {
      return { ok: false, message: 'Exit cannot be rejected in its current state' };
    }
    await query(
      `UPDATE employee_exit_approvals
       SET status = 'rejected', comments = $2, decided_at = CURRENT_TIMESTAMP
       WHERE exit_id = $1 AND status IN ('awaiting', 'on_hold', 'pending')`,
      [input.exitId, input.comments?.trim() || input.hold_reason?.trim() || null],
    );
    await query(
      `UPDATE employee_exits SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [input.exitId],
    );
    return { ok: true, exit_status: 'cancelled' };
  }

  if (input.action === 'grant_exception') {
    const deptHeadId = await getDepartmentHeadUserIdForExit(input.exitId, input.businessId);
    if (!deptHeadId || deptHeadId !== input.actorUserId) {
      return { ok: false, message: 'Only the department head can grant an exception' };
    }

    const heldStep = await queryOne<{ id: string }>(
      `SELECT id FROM employee_exit_approvals
       WHERE exit_id = $1 AND status = 'on_hold'
       ORDER BY approval_level ASC LIMIT 1`,
      [input.exitId],
    );
    if (!heldStep) {
      return { ok: false, message: 'No step is on hold' };
    }

    await query(
      `UPDATE employee_exit_approvals
       SET status = 'approved',
           exception_granted_by = $2,
           exception_granted_at = CURRENT_TIMESTAMP,
           comments = COALESCE($3, comments),
           decided_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [heldStep.id, input.actorUserId, input.comments?.trim() || null],
    );

    const exitStatus = await advanceExitApprovalChain(input.exitId, input.businessId, input.actorUserId);
    return { ok: true, exit_status: exitStatus };
  }

  const canAct = await canActOnExitApprovalStep(input.exitId, input.businessId, input.actorUserId);
  if (!canAct.ok) return canAct;

  const step = await queryOne<{ id: string; role_type: ExitApproverRoleType }>(
    `SELECT id, role_type FROM employee_exit_approvals
     WHERE exit_id = $1 AND approval_level = $2`,
    [input.exitId, canAct.level],
  );
  if (!step) return { ok: false, message: 'Approval step not found' };

  if (input.action === 'hold') {
    if (step.role_type === 'hr') {
      return { ok: false, message: 'HR should reject or approve; use hold only for department approvers' };
    }
    const reason = input.hold_reason?.trim();
    if (!reason) return { ok: false, message: 'A reason is required when marking as pending' };

    await query(
      `UPDATE employee_exit_approvals
       SET status = 'on_hold', hold_reason = $2, decided_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [step.id, reason],
    );
    await query(
      `UPDATE employee_exits SET status = 'approval_on_hold', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [input.exitId],
    );
    return { ok: true, exit_status: 'approval_on_hold' };
  }

  if (input.action === 'approve') {
    await query(
      `UPDATE employee_exit_approvals
       SET status = 'approved',
           comments = $2,
           hold_reason = NULL,
           decided_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [step.id, input.comments?.trim() || null],
    );

    const exitStatus = await advanceExitApprovalChain(
      input.exitId,
      input.businessId,
      input.actorUserId,
    );
    return { ok: true, exit_status: exitStatus };
  }

  return { ok: false, message: 'Unknown action' };
}

async function advanceExitApprovalChain(
  exitId: string,
  businessId: string,
  approverUserId: string,
): Promise<string> {
  const nextPending = await queryOne<{ id: string }>(
    `SELECT id FROM employee_exit_approvals
     WHERE exit_id = $1 AND status = 'pending'
     ORDER BY approval_level ASC LIMIT 1`,
    [exitId],
  );

  if (nextPending) {
    await query(
      `UPDATE employee_exit_approvals SET status = 'awaiting' WHERE id = $1`,
      [nextPending.id],
    );
    await query(
      `UPDATE employee_exits SET status = 'pending_approval', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [exitId],
    );
    return 'pending_approval';
  }

  await finalizeExitAfterApprovals(exitId, businessId, approverUserId);
  return 'in_notice';
}

async function finalizeExitAfterApprovals(
  exitId: string,
  businessId: string,
  approverId: string,
) {
  await queryOne(
    `UPDATE employee_exits SET
       status = 'in_notice',
       approved_at = CURRENT_TIMESTAMP,
       approved_by = $3,
       last_working_date = COALESCE(
         last_working_date,
         (CURRENT_DATE + (notice_period_days || 0) * INTERVAL '1 day')::date
       ),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2`,
    [exitId, businessId, approverId],
  );
}

export async function listPendingExitApprovalsForUser(
  businessId: string,
  userId: string,
): Promise<
  {
    exit_id: string;
    employee_name: string;
    employee_code: string;
    approval_level: number;
    level_label: string | null;
    role_type: ExitApproverRoleType;
    status: string;
    hold_reason: string | null;
    created_at: string;
  }[]
> {
  const isHr = await userIsHrExitApprover(userId, businessId);

  const direct = await queryRows(
    `SELECT ex.id AS exit_id, u.name AS employee_name, e.employee_code,
            a.approval_level, a.level_label, a.role_type, a.status, a.hold_reason,
            ex.created_at::text
     FROM employee_exit_approvals a
     INNER JOIN employee_exits ex ON ex.id = a.exit_id
     INNER JOIN employees e ON e.id = ex.employee_id
     INNER JOIN users u ON u.id = e.id
     WHERE ex.business_id = $1
       AND ex.exit_type = 'resignation'
       AND ex.status IN ('pending_approval', 'approval_on_hold')
       AND a.approver_user_id = $2
       AND a.status IN ('awaiting', 'on_hold')
       AND a.approval_level = (
         SELECT MIN(a2.approval_level) FROM employee_exit_approvals a2
         WHERE a2.exit_id = ex.id AND a2.status IN ('awaiting', 'on_hold')
       )
     ORDER BY ex.created_at ASC`,
    [businessId, userId],
  );

  const hrSteps = isHr
    ? await queryRows(
        `SELECT ex.id AS exit_id, u.name AS employee_name, e.employee_code,
                a.approval_level, a.level_label, a.role_type, a.status, a.hold_reason,
                ex.created_at::text
         FROM employee_exit_approvals a
         INNER JOIN employee_exits ex ON ex.id = a.exit_id
         INNER JOIN employees e ON e.id = ex.employee_id
         INNER JOIN users u ON u.id = e.id
         WHERE ex.business_id = $1
           AND ex.exit_type = 'resignation'
           AND ex.status IN ('pending_approval', 'approval_on_hold')
           AND a.role_type = 'hr'
           AND a.status IN ('awaiting', 'on_hold')
           AND a.approval_level = (
             SELECT MIN(a2.approval_level) FROM employee_exit_approvals a2
             WHERE a2.exit_id = ex.id AND a2.status IN ('awaiting', 'on_hold')
           )
         ORDER BY ex.created_at ASC`,
        [businessId],
      )
    : [];

  const onHoldRows = await queryRows<{ exit_id: string }>(
    `SELECT DISTINCT ex.id AS exit_id
     FROM employee_exit_approvals a
     INNER JOIN employee_exits ex ON ex.id = a.exit_id
     WHERE ex.business_id = $1 AND ex.status = 'approval_on_hold' AND a.status = 'on_hold'`,
    [businessId],
  );

  const exceptionQueue = [];
  for (const row of onHoldRows) {
    const deptHeadId = await getDepartmentHeadUserIdForExit(row.exit_id, businessId);
    if (deptHeadId !== userId) continue;

    const detail = await queryOne(
      `SELECT ex.id AS exit_id, u.name AS employee_name, e.employee_code,
              a.approval_level, a.level_label, a.role_type, a.hold_reason, ex.created_at::text
       FROM employee_exit_approvals a
       INNER JOIN employee_exits ex ON ex.id = a.exit_id
       INNER JOIN employees e ON e.id = ex.employee_id
       INNER JOIN users u ON u.id = e.id
       WHERE ex.id = $1 AND a.status = 'on_hold'
       ORDER BY a.approval_level ASC LIMIT 1`,
      [row.exit_id],
    );
    if (detail) {
      exceptionQueue.push({ ...detail, status: 'exception_needed' });
    }
  }

  const merged = [...direct, ...hrSteps, ...exceptionQueue];
  const seen = new Set<string>();
  return merged.filter((row) => {
    const key = `${row.exit_id}:${row.approval_level}:${row.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function deleteExitApprovals(exitId: string): Promise<void> {
  await query(`DELETE FROM employee_exit_approvals WHERE exit_id = $1`, [exitId]);
}
