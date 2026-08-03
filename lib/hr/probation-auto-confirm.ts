import { queryRows, queryOne } from '@/lib/db';
import { getHrEmployeeSettings } from '@/lib/hr/employee-settings';

export type ProbationConfirmResult = {
  confirmed: number;
  employee_ids: string[];
};

/** Confirm employees whose probation ended and auto-confirm is enabled for the business. */
export async function runProbationAutoConfirm(businessId?: string): Promise<ProbationConfirmResult> {
  const businesses = businessId
    ? [{ business_id: businessId }]
    : await queryRows<{ business_id: string }>(
        `SELECT DISTINCT business_id FROM employees WHERE probation_status = 'in_probation'`,
      );

  const confirmedIds: string[] = [];

  for (const { business_id } of businesses) {
    const settings = await getHrEmployeeSettings(business_id);
    if (!settings.probation_auto_confirm) continue;

    const rows = await queryRows<{ id: string }>(
      `UPDATE employees SET
         probation_status = 'confirmed',
         updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1
         AND probation_status = 'in_probation'
         AND probation_end_date IS NOT NULL
         AND probation_end_date <= CURRENT_DATE
       RETURNING id`,
      [business_id],
    );
    confirmedIds.push(...rows.map((r) => r.id));
  }

  return { confirmed: confirmedIds.length, employee_ids: confirmedIds };
}

export async function applyProbationOnJoin(
  businessId: string,
  employeeId: string,
  joiningDate: string | null,
): Promise<void> {
  if (!joiningDate) {
    await queryOne(
      `UPDATE employees SET probation_status = 'not_applicable' WHERE id = $1`,
      [employeeId],
    );
    return;
  }

  const settings = await getHrEmployeeSettings(businessId);
  if (settings.probation_period_value <= 0) {
    await queryOne(
      `UPDATE employees SET probation_status = 'not_applicable', probation_end_date = NULL WHERE id = $1`,
      [employeeId],
    );
    return;
  }

  const joined = new Date(joiningDate);
  const end = new Date(joined);
  if (settings.probation_period_unit === 'weeks') {
    end.setDate(end.getDate() + settings.probation_period_value * 7);
  } else {
    end.setMonth(end.getMonth() + settings.probation_period_value);
  }

  await queryOne(
    `UPDATE employees SET
       probation_status = 'in_probation',
       probation_end_date = $2
     WHERE id = $1`,
    [employeeId, end.toISOString().slice(0, 10)],
  );
}
