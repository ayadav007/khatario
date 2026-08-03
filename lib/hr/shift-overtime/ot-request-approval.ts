import { query, queryOne, queryRows } from '@/lib/db';
import { checkUserPermissionWithAliases } from '@/lib/permissions';
import { resolveDepartmentHeadEmployeeId } from '@/lib/hr/department-head';
import { fetchOrgChartEmployees } from '@/lib/hr/org-chart';
import { getOtPolicy } from '@/lib/hr/shift-overtime/ot-policy';
import { finalizeApprovedOtRequest } from '@/lib/hr/shift-overtime/ot-payroll';
import type { OtApprovalChainLevel, OtApprovalRoleType } from '@/lib/hr/shift-overtime/types';

async function resolveChain(
  businessId: string,
  employeeId: string,
  chain: OtApprovalChainLevel[],
) {
  const employee = await queryOne<{ reporting_manager_id: string | null; department: string | null }>(
    `SELECT reporting_manager_id, department FROM employees WHERE id = $1 AND business_id = $2`,
    [employeeId, businessId],
  );
  if (!employee) return [];

  const org = await fetchOrgChartEmployees(businessId);
  const resolved: Array<{
    level: number;
    label: string | null;
    role_type: OtApprovalRoleType;
    approver_user_id: string | null;
  }> = [];
  let prev: string | null = null;

  for (const step of chain.sort((a, b) => a.level - b.level)) {
    let uid: string | null = null;
    if (step.role_type === 'reporting_manager') uid = employee.reporting_manager_id;
    else if (step.role_type === 'department_head')
      uid = resolveDepartmentHeadEmployeeId(org, employee.department, employeeId);
    else if (step.role_type === 'specific_employee') uid = step.employee_id ?? null;

    if (step.role_type !== 'hr') {
      if (!uid || uid === employeeId || uid === prev) continue;
    } else if (resolved[resolved.length - 1]?.role_type === 'hr') continue;

    resolved.push({
      level: resolved.length + 1,
      label: step.label?.trim() || null,
      role_type: step.role_type,
      approver_user_id: uid,
    });
    prev = uid;
  }
  return resolved;
}

export async function bootstrapOtRequestApprovals(
  overtimeRequestId: string,
  businessId: string,
  employeeId: string,
): Promise<boolean> {
  const policy = await getOtPolicy(businessId);
  if (!policy?.approval_chain.length) return false;

  const resolved = await resolveChain(businessId, employeeId, policy.approval_chain);
  if (!resolved.length) return false;

  await query(`DELETE FROM overtime_request_approvals WHERE overtime_request_id = $1`, [
    overtimeRequestId,
  ]);

  for (let i = 0; i < resolved.length; i++) {
    const step = resolved[i];
    await query(
      `INSERT INTO overtime_request_approvals (
         overtime_request_id, business_id, approval_level, level_label, role_type, approver_user_id, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        overtimeRequestId,
        businessId,
        step.level,
        step.label,
        step.role_type,
        step.approver_user_id,
        i === 0 ? 'awaiting' : 'pending',
      ],
    );
  }
  return true;
}

async function userIsHr(userId: string): Promise<boolean> {
  return checkUserPermissionWithAliases(userId, 'leave_requests', 'update');
}

async function advance(
  overtimeRequestId: string,
  businessId: string,
  approverUserId: string,
): Promise<{ ok: true; request_status: string }> {
  const next = await queryOne<{ id: string }>(
    `SELECT id FROM overtime_request_approvals
     WHERE overtime_request_id = $1 AND status = 'pending'
     ORDER BY approval_level LIMIT 1`,
    [overtimeRequestId],
  );
  if (next) {
    await query(`UPDATE overtime_request_approvals SET status = 'awaiting' WHERE id = $1`, [next.id]);
    return { ok: true, request_status: 'pending' };
  }

  await queryOne(
    `UPDATE overtime_requests SET status = 'approved', approved_by = $2, approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [overtimeRequestId, approverUserId],
  );
  await finalizeApprovedOtRequest(overtimeRequestId, businessId);
  return { ok: true, request_status: 'approved' };
}

export async function decideOtRequestApproval(input: {
  overtimeRequestId: string;
  businessId: string;
  actorUserId: string;
  action: 'approve' | 'hold' | 'reject' | 'grant_exception';
  hold_reason?: string;
  comments?: string;
}): Promise<{ ok: true; request_status: string } | { ok: false; message: string }> {
  const request = await queryOne<{ status: string; employee_id: string }>(
    `SELECT status, employee_id FROM overtime_requests WHERE id = $1 AND business_id = $2`,
    [input.overtimeRequestId, input.businessId],
  );
  if (!request || request.status !== 'pending') {
    return { ok: false, message: 'Overtime request not found or not pending' };
  }

  if (input.action === 'reject') {
    if (!(await userIsHr(input.actorUserId))) {
      return { ok: false, message: 'Only HR can reject overtime requests' };
    }
    await query(
      `UPDATE overtime_request_approvals SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE overtime_request_id = $1`,
      [input.overtimeRequestId],
    );
    await queryOne(
      `UPDATE overtime_requests SET status = 'rejected', rejection_reason = $2, rejected_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [input.overtimeRequestId, input.comments ?? input.hold_reason ?? null],
    );
    return { ok: true, request_status: 'rejected' };
  }

  const active = await queryOne<{ id: string; role_type: OtApprovalRoleType; approver_user_id: string | null }>(
    `SELECT id, role_type, approver_user_id FROM overtime_request_approvals
     WHERE overtime_request_id = $1 AND status IN ('awaiting', 'on_hold')
     ORDER BY approval_level LIMIT 1`,
    [input.overtimeRequestId],
  );

  if (!active) return advance(input.overtimeRequestId, input.businessId, input.actorUserId);

  if (active.role_type === 'hr') {
    if (!(await userIsHr(input.actorUserId))) {
      return { ok: false, message: 'Only HR can approve this step' };
    }
  } else if (active.approver_user_id !== input.actorUserId) {
    return { ok: false, message: 'You are not the approver for this step' };
  }

  if (input.action === 'hold') {
    if (!input.hold_reason?.trim()) return { ok: false, message: 'Reason required' };
    await query(
      `UPDATE overtime_request_approvals SET status = 'on_hold', hold_reason = $2, decided_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [active.id, input.hold_reason.trim()],
    );
    return { ok: true, request_status: 'pending' };
  }

  await query(
    `UPDATE overtime_request_approvals SET status = 'approved', comments = $2, decided_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [active.id, input.comments?.trim() || null],
  );
  return advance(input.overtimeRequestId, input.businessId, input.actorUserId);
}

export async function listPendingOtApprovalsForUser(businessId: string, userId: string) {
  const isHr = await userIsHr(userId);
  const direct = await queryRows(
    `SELECT o.id AS overtime_request_id, u.name AS employee_name, e.employee_code,
            o.request_date::text, o.total_hours, o.reason,
            a.approval_level, a.level_label, a.role_type, a.status, a.hold_reason
     FROM overtime_request_approvals a
     INNER JOIN overtime_requests o ON o.id = a.overtime_request_id
     INNER JOIN employees e ON e.id = o.employee_id
     INNER JOIN users u ON u.id = e.id
     WHERE e.business_id = $1 AND o.status = 'pending'
       AND a.approver_user_id = $2 AND a.status IN ('awaiting', 'on_hold')
       AND a.approval_level = (
         SELECT MIN(a2.approval_level) FROM overtime_request_approvals a2
         WHERE a2.overtime_request_id = o.id AND a2.status IN ('awaiting', 'on_hold')
       )`,
    [businessId, userId],
  );
  const hrSteps = isHr
    ? await queryRows(
        `SELECT o.id AS overtime_request_id, u.name AS employee_name, e.employee_code,
                o.request_date::text, o.total_hours, o.reason,
                a.approval_level, a.level_label, a.role_type, a.status, a.hold_reason
         FROM overtime_request_approvals a
         INNER JOIN overtime_requests o ON o.id = a.overtime_request_id
         INNER JOIN employees e ON e.id = o.employee_id
         INNER JOIN users u ON u.id = e.id
         WHERE e.business_id = $1 AND o.status = 'pending'
           AND a.role_type = 'hr' AND a.status IN ('awaiting', 'on_hold')
           AND a.approval_level = (
             SELECT MIN(a2.approval_level) FROM overtime_request_approvals a2
             WHERE a2.overtime_request_id = o.id AND a2.status IN ('awaiting', 'on_hold')
           )`,
        [businessId],
      )
    : [];
  return [...direct, ...hrSteps];
}
