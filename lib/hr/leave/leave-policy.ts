import { queryOne, queryRows } from '@/lib/db';
import { checkUserPermissionWithAliases } from '@/lib/permissions';
import {
  getDefaultPlanBundle,
  getLeavePlanTypeRule,
} from '@/lib/hr/leave/leave-plan';
import type { LeavePlan, LeavePlanRestriction, LeavePlanTypeRule } from '@/lib/hr/leave/types';
import { getLeaveYear } from '@/lib/hr/leave/types';

export type LeaveApplicationInput = {
  businessId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
  attachmentUrl?: string | null;
  actorUserId: string;
  isPortalSelfApply: boolean;
  totalDays: number;
};

export async function validateLeaveApplication(input: LeaveApplicationInput): Promise<void> {
  const { plan, restrictions } = await getDefaultPlanBundle(input.businessId);
  const rule = await getLeavePlanTypeRule(plan.id, input.leaveTypeId);
  if (!rule) throw new Error('Leave type is not configured in the leave plan');

  const employee = await queryOne<{
    probation_status: string | null;
    joining_date: string | null;
  }>(
    `SELECT probation_status, joining_date::text FROM employees WHERE id = $1 AND business_id = $2`,
    [input.employeeId, input.businessId],
  );
  if (!employee) throw new Error('Employee not found');

  if (input.isPortalSelfApply) {
    if (!rule.employee_can_apply) {
      throw new Error('Employees cannot apply for this leave type themselves');
    }
    const canApplyOnBehalf = await canApplyOnBehalfOf(input.actorUserId, input.businessId, plan);
    if (input.actorUserId !== input.employeeId && !canApplyOnBehalf) {
      throw new Error('You are not allowed to apply leave on behalf of this employee');
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);

  if (rule.blocked_in_probation && employee.probation_status === 'in_probation') {
    throw new Error('This leave type is not available during probation');
  }

  if (rule.blocked_in_notice_period) {
    const inNotice = await queryOne(
      `SELECT id FROM employee_exits
       WHERE employee_id = $1 AND business_id = $2
         AND status IN ('pending_approval', 'approval_on_hold', 'in_notice')`,
      [input.employeeId, input.businessId],
    );
    if (inNotice) throw new Error('Leave cannot be applied while serving notice period');
  }

  if (!rule.allow_backdated && start < today) {
    throw new Error('Backdated leave applications are not allowed for this leave type');
  }

  if (rule.max_future_days != null) {
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + rule.max_future_days);
    if (start > maxDate) {
      throw new Error(`Leave cannot be applied more than ${rule.max_future_days} days in advance`);
    }
  }

  if (rule.min_notice_days > 0) {
    const noticeDeadline = new Date(today);
    noticeDeadline.setDate(noticeDeadline.getDate() + rule.min_notice_days);
    if (start < noticeDeadline) {
      throw new Error(`At least ${rule.min_notice_days} day(s) prior notice is required`);
    }
  }

  if (rule.requires_comment && !input.reason?.trim()) {
    throw new Error('A comment is required for this leave type');
  }

  if (
    rule.requires_attachment &&
    rule.attachment_min_days != null &&
    input.totalDays >= rule.attachment_min_days &&
    !input.attachmentUrl?.trim()
  ) {
    throw new Error('An attachment is required for this leave application');
  }

  if (
    rule.requires_attachment &&
    rule.attachment_min_days == null &&
    !input.attachmentUrl?.trim()
  ) {
    throw new Error('An attachment is required for this leave type');
  }

  await validateInterTypeRestrictions(input, restrictions);
  await validateOverlap(input);
}

async function canApplyOnBehalfOf(
  actorUserId: string,
  businessId: string,
  plan: LeavePlan,
): Promise<boolean> {
  if (plan.application_settings.hr_can_apply_on_behalf) {
    const isHr = await checkUserPermissionWithAliases(actorUserId, 'leave_requests', 'create');
    if (isHr) return true;
  }
  if (plan.application_settings.manager_can_apply_on_behalf) {
    const mgr = await queryOne<{ id: string }>(
      `SELECT id FROM employees WHERE reporting_manager_id = $1 AND business_id = $2 LIMIT 1`,
      [actorUserId, businessId],
    );
    if (mgr) return true;
  }
  return false;
}

async function validateOverlap(input: LeaveApplicationInput): Promise<void> {
  const overlapping = await queryOne(
    `SELECT id FROM leave_requests
     WHERE employee_id = $1 AND status IN ('pending', 'approved')
       AND (
         (start_date <= $2 AND end_date >= $2) OR
         (start_date <= $3 AND end_date >= $3) OR
         (start_date >= $2 AND end_date <= $3)
       )`,
    [input.employeeId, input.startDate, input.endDate],
  );
  if (overlapping) throw new Error('You already have a leave request for this period');
}

async function validateInterTypeRestrictions(
  input: LeaveApplicationInput,
  restrictions: LeavePlanRestriction[],
): Promise<void> {
  for (const r of restrictions) {
    if (r.restriction_type === 'no_consecutive' && r.leave_type_id_b) {
      const adjacent = await queryOne(
        `SELECT id FROM leave_requests
         WHERE employee_id = $1 AND status IN ('pending', 'approved')
           AND leave_type_id IN ($2, $3)
           AND leave_type_id != $4
           AND (
             end_date = ($5::date - INTERVAL '1 day')::date OR
             start_date = ($6::date + INTERVAL '1 day')::date
           )`,
        [
          input.employeeId,
          r.leave_type_id_a,
          r.leave_type_id_b,
          input.leaveTypeId,
          input.startDate,
          input.endDate,
        ],
      );
      if (adjacent && input.leaveTypeId === r.leave_type_id_a) {
        throw new Error('This leave type cannot be combined consecutively with another restricted type');
      }
    }

    if (r.restriction_type === 'block_combination' && r.leave_type_id_b) {
      const blocked = await queryOne(
        `SELECT id FROM leave_requests
         WHERE employee_id = $1 AND status IN ('pending', 'approved')
           AND (
             (leave_type_id = $2 AND $3::date <= end_date AND $4::date >= start_date) OR
             (leave_type_id = $5 AND $3::date <= end_date AND $4::date >= start_date)
           )
           AND NOT (leave_type_id = $6 AND $3::date = start_date AND $4::date = end_date)`,
        [
          input.employeeId,
          r.leave_type_id_a,
          input.startDate,
          input.endDate,
          r.leave_type_id_b,
          input.leaveTypeId,
        ],
      );
      if (blocked) {
        throw new Error('These leave types cannot overlap in the same period');
      }
    }
  }
}

export function resolveLeaveYearForRequest(
  startDate: string,
  plan: { calendar_year_start_month: number },
): number {
  return getLeaveYear(startDate, plan.calendar_year_start_month);
}

export async function shouldAutoApprove(rule: LeavePlanTypeRule): Promise<boolean> {
  return !rule.requires_approval;
}
