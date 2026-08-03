import { queryOne } from '@/lib/db';
import { deleteExitApprovals } from '@/lib/hr/exit-approval';
import { getHrExitSettings } from '@/lib/hr/exit-settings';
import { getExitDetail, initiateExit } from '@/lib/hr/exit-process';

export type EmployeeResignationView = {
  can_submit: boolean;
  exit_reasons: string[];
  active_exit: {
    id: string;
    status: string;
    reason: string | null;
    notice_period_days: number | null;
    last_working_date: string | null;
    resignation_submitted_at: string | null;
    created_at: string;
  } | null;
};

export async function getEmployeeResignationView(
  businessId: string,
  employeeId: string,
): Promise<EmployeeResignationView> {
  const settings = await getHrExitSettings(businessId);

  const active = await queryOne<{
    id: string;
    status: string;
    reason: string | null;
    notice_period_days: number | null;
    last_working_date: string | null;
    resignation_submitted_at: string | null;
    created_at: string;
  }>(
    `SELECT id, status, reason, notice_period_days, last_working_date::text,
            resignation_submitted_at::text, created_at::text
     FROM employee_exits
     WHERE employee_id = $1 AND business_id = $2
       AND status NOT IN ('completed', 'cancelled')
     ORDER BY created_at DESC
     LIMIT 1`,
    [employeeId, businessId],
  );

  return {
    can_submit: !active,
    exit_reasons: settings.exit_reasons,
    active_exit: active,
  };
}

export async function submitEmployeeResignation(input: {
  businessId: string;
  employeeId: string;
  reason: string;
  preferredLastWorkingDate?: string;
  notes?: string;
}): Promise<{ id: string }> {
  const view = await getEmployeeResignationView(input.businessId, input.employeeId);
  if (!view.can_submit) {
    throw new Error('You already have an active resignation or exit in progress');
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = await initiateExit({
    businessId: input.businessId,
    employeeId: input.employeeId,
    exitType: 'resignation',
    reason: input.reason,
    resignationSubmittedAt: today,
    lastWorkingDate: input.preferredLastWorkingDate,
    createdBy: input.employeeId,
  });

  if (input.notes?.trim()) {
    await queryOne(
      `UPDATE employee_exits SET notes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [result.id, input.notes.trim()],
    );
  }

  return result;
}

export async function cancelEmployeeResignation(
  businessId: string,
  employeeId: string,
): Promise<void> {
  const updated = await queryOne<{ id: string }>(
    `UPDATE employee_exits SET
       status = 'cancelled',
       updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND employee_id = $2
       AND status IN ('pending_approval', 'approval_on_hold')
     RETURNING id`,
    [businessId, employeeId],
  );
  if (!updated) {
    throw new Error('Only pending resignations can be withdrawn');
  }
  await deleteExitApprovals(updated.id);
}

export async function getEmployeeResignationDetail(businessId: string, employeeId: string) {
  const active = await queryOne<{ id: string }>(
    `SELECT id FROM employee_exits
     WHERE business_id = $1 AND employee_id = $2
       AND status NOT IN ('completed', 'cancelled')
     ORDER BY created_at DESC LIMIT 1`,
    [businessId, employeeId],
  );
  if (!active) return null;
  return getExitDetail(businessId, active.id);
}
