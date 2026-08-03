import { query, queryOne, queryRows } from '@/lib/db';
import { checkUserPermissionWithAliases } from '@/lib/permissions';
import { resolveDepartmentHeadEmployeeId } from '@/lib/hr/department-head';
import { fetchOrgChartEmployees } from '@/lib/hr/org-chart';
import { getDefaultLeavePlan } from '@/lib/hr/leave/leave-plan';
import type { LeaveApprovalChainLevel, LeaveApprovalRoleType } from '@/lib/hr/leave/types';
import { syncApprovedLeaveToAttendance } from '@/lib/hr/leave-attendance-sync';

export type LeaveRequestApprovalRow = {
  id: string;
  leave_request_id: string;
  approval_level: number;
  level_label: string | null;
  role_type: LeaveApprovalRoleType;
  approver_user_id: string | null;
  approver_name: string | null;
  status: string;
  hold_reason: string | null;
  comments: string | null;
  decided_at: string | null;
};

type ResolvedApprover = {
  level: number;
  label: string | null;
  role_type: LeaveApprovalRoleType;
  approver_user_id: string | null;
};

async function resolveChain(
  businessId: string,
  employeeId: string,
  chain: LeaveApprovalChainLevel[],
): Promise<ResolvedApprover[]> {
  const employee = await queryOne<{ reporting_manager_id: string | null; department: string | null }>(
    `SELECT reporting_manager_id, department FROM employees WHERE id = $1 AND business_id = $2`,
    [employeeId, businessId],
  );
  if (!employee) return [];

  const orgEmployees = await fetchOrgChartEmployees(businessId);
  const resolved: ResolvedApprover[] = [];
  let previousUserId: string | null = null;

  for (const step of chain.sort((a, b) => a.level - b.level)) {
    let approverUserId: string | null = null;
    switch (step.role_type) {
      case 'reporting_manager':
        approverUserId = employee.reporting_manager_id;
        break;
      case 'department_head':
        approverUserId = resolveDepartmentHeadEmployeeId(orgEmployees, employee.department, employeeId);
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
      if (!approverUserId || approverUserId === employeeId || approverUserId === previousUserId) continue;
      const valid = await queryOne(
        `SELECT e.id FROM employees e INNER JOIN users u ON u.id = e.id
         WHERE e.id = $1 AND e.business_id = $2 AND e.is_active = true AND u.is_active = true`,
        [approverUserId, businessId],
      );
      if (!valid) continue;
    } else if (resolved[resolved.length - 1]?.role_type === 'hr') {
      continue;
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

export async function bootstrapLeaveRequestApprovals(
  leaveRequestId: string,
  businessId: string,
  employeeId: string,
): Promise<boolean> {
  const plan = await getDefaultLeavePlan(businessId);
  if (!plan?.leave_approval_chain.length) return false;

  const resolved = await resolveChain(businessId, employeeId, plan.leave_approval_chain);
  if (resolved.length === 0) return false;

  await query(`DELETE FROM leave_request_approvals WHERE leave_request_id = $1`, [leaveRequestId]);

  for (let i = 0; i < resolved.length; i++) {
    const step = resolved[i];
    await query(
      `INSERT INTO leave_request_approvals (
         leave_request_id, business_id, approval_level, level_label, role_type, approver_user_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        leaveRequestId,
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

export async function listLeaveRequestApprovals(
  leaveRequestId: string,
): Promise<LeaveRequestApprovalRow[]> {
  return queryRows(
    `SELECT a.*, u.name AS approver_name
     FROM leave_request_approvals a
     LEFT JOIN users u ON u.id = a.approver_user_id
     WHERE a.leave_request_id = $1 ORDER BY a.approval_level`,
    [leaveRequestId],
  );
}

async function userIsHr(userId: string, businessId: string): Promise<boolean> {
  return checkUserPermissionWithAliases(userId, 'leave_requests', 'update');
}

export async function decideLeaveRequestApproval(input: {
  leaveRequestId: string;
  businessId: string;
  actorUserId: string;
  action: 'approve' | 'hold' | 'reject' | 'grant_exception';
  hold_reason?: string;
  comments?: string;
}): Promise<{ ok: true; request_status: string } | { ok: false; message: string }> {
  const request = await queryOne<{ status: string; employee_id: string }>(
    `SELECT lr.status, lr.employee_id
     FROM leave_requests lr
     INNER JOIN employees e ON e.id = lr.employee_id
     WHERE lr.id = $1 AND e.business_id = $2`,
    [input.leaveRequestId, input.businessId],
  );
  if (!request) return { ok: false, message: 'Leave request not found' };
  if (request.status !== 'pending') return { ok: false, message: 'Leave request is not pending' };

  if (input.action === 'reject') {
    if (!(await userIsHr(input.actorUserId, input.businessId))) {
      return { ok: false, message: 'Only HR can reject leave requests' };
    }
    await query(
      `UPDATE leave_request_approvals SET status = 'rejected', decided_at = CURRENT_TIMESTAMP
       WHERE leave_request_id = $1`,
      [input.leaveRequestId],
    );
    await queryOne(
      `UPDATE leave_requests SET status = 'rejected', rejection_reason = $2, rejected_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [input.leaveRequestId, input.comments ?? input.hold_reason ?? null],
    );
    return { ok: true, request_status: 'rejected' };
  }

  if (input.action === 'grant_exception') {
    const employee = await queryOne<{ department: string | null }>(
      `SELECT department FROM employees WHERE id = $1`,
      [request.employee_id],
    );
    const org = await fetchOrgChartEmployees(input.businessId);
    const deptHead = resolveDepartmentHeadEmployeeId(org, employee?.department, request.employee_id);
    if (deptHead !== input.actorUserId) {
      return { ok: false, message: 'Only department head can grant exception' };
    }
    const held = await queryOne<{ id: string }>(
      `SELECT id FROM leave_request_approvals
       WHERE leave_request_id = $1 AND status = 'on_hold' ORDER BY approval_level LIMIT 1`,
      [input.leaveRequestId],
    );
    if (!held) return { ok: false, message: 'No step on hold' };
    await query(
      `UPDATE leave_request_approvals SET status = 'approved', exception_granted_by = $2,
              exception_granted_at = CURRENT_TIMESTAMP, decided_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [held.id, input.actorUserId],
    );
    return advanceLeaveApproval(input.leaveRequestId, input.businessId, input.actorUserId);
  }

  const active = await queryOne<{ id: string; role_type: LeaveApprovalRoleType; approver_user_id: string | null }>(
    `SELECT id, role_type, approver_user_id FROM leave_request_approvals
     WHERE leave_request_id = $1 AND status IN ('awaiting', 'on_hold')
     ORDER BY approval_level LIMIT 1`,
    [input.leaveRequestId],
  );

  if (!active) {
    return advanceLeaveApproval(input.leaveRequestId, input.businessId, input.actorUserId);
  }

  if (active.role_type === 'hr') {
    if (!(await userIsHr(input.actorUserId, input.businessId))) {
      return { ok: false, message: 'Only HR can approve this step' };
    }
  } else if (active.approver_user_id !== input.actorUserId) {
    return { ok: false, message: 'You are not the approver for this step' };
  }

  if (input.action === 'hold') {
    if (active.role_type === 'hr') {
      return { ok: false, message: 'HR should approve or reject' };
    }
    if (!input.hold_reason?.trim()) return { ok: false, message: 'Reason required for pending' };
    await query(
      `UPDATE leave_request_approvals SET status = 'on_hold', hold_reason = $2, decided_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [active.id, input.hold_reason.trim()],
    );
    return { ok: true, request_status: 'pending' };
  }

  await query(
    `UPDATE leave_request_approvals SET status = 'approved', comments = $2, hold_reason = NULL, decided_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [active.id, input.comments?.trim() || null],
  );
  return advanceLeaveApproval(input.leaveRequestId, input.businessId, input.actorUserId);
}

async function advanceLeaveApproval(
  leaveRequestId: string,
  businessId: string,
  approverUserId: string,
): Promise<{ ok: true; request_status: string }> {
  const next = await queryOne<{ id: string }>(
    `SELECT id FROM leave_request_approvals
     WHERE leave_request_id = $1 AND status = 'pending'
     ORDER BY approval_level LIMIT 1`,
    [leaveRequestId],
  );

  if (next) {
    await query(`UPDATE leave_request_approvals SET status = 'awaiting' WHERE id = $1`, [next.id]);
    return { ok: true, request_status: 'pending' };
  }

  await queryOne(
    `UPDATE leave_requests SET status = 'approved', approved_by = $2, approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [leaveRequestId, approverUserId],
  );

  const approved = await queryOne<{
    employee_id: string;
    start_date: string;
    end_date: string;
    total_days: string;
    leave_name: string | null;
  }>(
    `SELECT lr.employee_id, lr.start_date::text, lr.end_date::text, lr.total_days::text, lt.leave_name
     FROM leave_requests lr
     LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.id = $1`,
    [leaveRequestId],
  );
  if (approved) {
    await syncApprovedLeaveToAttendance({
      businessId,
      employeeId: approved.employee_id,
      leaveRequestId,
      startDate: approved.start_date.slice(0, 10),
      endDate: approved.end_date.slice(0, 10),
      totalDays: Number(approved.total_days),
      leaveName: approved.leave_name ?? undefined,
    });
  }
  return { ok: true, request_status: 'approved' };
}

export async function listPendingLeaveChainApprovalsForUser(businessId: string, userId: string) {
  const isHr = await userIsHr(userId, businessId);

  const direct = await queryRows(
    `SELECT lr.id AS leave_request_id, u.name AS employee_name, e.employee_code,
            lt.leave_name, lr.start_date::text, lr.end_date::text, lr.total_days,
            a.approval_level, a.level_label, a.role_type, a.status, a.hold_reason
     FROM leave_request_approvals a
     INNER JOIN leave_requests lr ON lr.id = a.leave_request_id
     INNER JOIN employees e ON e.id = lr.employee_id
     INNER JOIN users u ON u.id = e.id
     INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE e.business_id = $1 AND lr.status = 'pending'
       AND a.approver_user_id = $2 AND a.status IN ('awaiting', 'on_hold')
       AND a.approval_level = (
         SELECT MIN(a2.approval_level) FROM leave_request_approvals a2
         WHERE a2.leave_request_id = lr.id AND a2.status IN ('awaiting', 'on_hold')
       )`,
    [businessId, userId],
  );

  const hrSteps = isHr
    ? await queryRows(
        `SELECT lr.id AS leave_request_id, u.name AS employee_name, e.employee_code,
                lt.leave_name, lr.start_date::text, lr.end_date::text, lr.total_days,
                a.approval_level, a.level_label, a.role_type, a.status, a.hold_reason
         FROM leave_request_approvals a
         INNER JOIN leave_requests lr ON lr.id = a.leave_request_id
         INNER JOIN employees e ON e.id = lr.employee_id
         INNER JOIN users u ON u.id = e.id
         INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
         WHERE e.business_id = $1 AND lr.status = 'pending'
           AND a.role_type = 'hr' AND a.status IN ('awaiting', 'on_hold')
           AND a.approval_level = (
             SELECT MIN(a2.approval_level) FROM leave_request_approvals a2
             WHERE a2.leave_request_id = lr.id AND a2.status IN ('awaiting', 'on_hold')
           )`,
        [businessId],
      )
    : [];

  return [...direct, ...hrSteps];
}
