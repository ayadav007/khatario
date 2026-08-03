import { query, queryOne, queryRows } from '@/lib/db';
import { computeOtMonetaryAmount } from '@/lib/hr/shift-overtime/ot-calculator';
import { getLeaveYear } from '@/lib/hr/leave/types';
import { getDefaultPlanBundle } from '@/lib/hr/leave/leave-plan';

export async function applyOtCompOffCredit(
  businessId: string,
  employeeId: string,
  leaveTypeId: string,
  days: number,
  requestDate: string,
): Promise<void> {
  const { plan } = await getDefaultPlanBundle(businessId);
  const leaveYear = getLeaveYear(requestDate, plan.calendar_year_start_month);

  await queryOne(
    `INSERT INTO leave_balances (employee_id, leave_type_id, year, earned_days, current_balance)
     VALUES ($1, $2, $3, 0, 0)
     ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`,
    [employeeId, leaveTypeId, leaveYear],
  );

  await queryOne(
    `UPDATE leave_balances SET
       earned_days = earned_days + $4,
       current_balance = current_balance + $4,
       updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
    [employeeId, leaveTypeId, leaveYear, days],
  );
}

export async function createOtPayrollEntry(
  businessId: string,
  employeeId: string,
  overtimeRequestId: string,
  amount: number,
): Promise<void> {
  await query(
    `INSERT INTO ot_payroll_entries (business_id, employee_id, overtime_request_id, amount, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [businessId, employeeId, overtimeRequestId, amount],
  );
}

export async function getPendingOtPayrollTotal(
  businessId: string,
  employeeId: string,
): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM ot_payroll_entries
     WHERE business_id = $1 AND employee_id = $2 AND status = 'pending'`,
    [businessId, employeeId],
  );
  return Number(row?.total ?? 0);
}

export async function applyPendingOtPayroll(
  businessId: string,
  employeeId: string,
  salaryPaymentId: string,
): Promise<{ amount: number; entries: number }> {
  const pending = await queryRows<{ id: string; amount: string }>(
    `SELECT id, amount::text FROM ot_payroll_entries
     WHERE business_id = $1 AND employee_id = $2 AND status = 'pending'`,
    [businessId, employeeId],
  );

  let total = 0;
  for (const row of pending) {
    total += Number(row.amount);
    await queryOne(
      `UPDATE ot_payroll_entries SET status = 'applied', salary_payment_id = $2, applied_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id, salaryPaymentId],
    );
  }
  return { amount: Math.round(total * 100) / 100, entries: pending.length };
}

export async function finalizeApprovedOtRequest(
  overtimeRequestId: string,
  businessId: string,
): Promise<void> {
  const req = await queryOne<{
    employee_id: string;
    request_date: string;
    duration_minutes: number;
    compensation_choice: string | null;
  }>(
    `SELECT employee_id, request_date::text, duration_minutes, compensation_choice
     FROM overtime_requests WHERE id = $1 AND business_id = $2`,
    [overtimeRequestId, businessId],
  );
  if (!req) return;

  const { policy } = await import('@/lib/hr/shift-overtime/ot-policy').then((m) =>
    m.getOtPolicyBundle(businessId),
  );

  const comp =
    req.compensation_choice === 'comp_off' ? 'comp_off' : 'monetary';

  if (comp === 'comp_off' && policy.comp_off_leave_type_id) {
    const { computeOtCompOffDays } = await import('@/lib/hr/shift-overtime/ot-calculator');
    const days = await computeOtCompOffDays({
      businessId,
      employeeId: req.employee_id,
      requestDate: req.request_date.slice(0, 10),
      durationMinutes: req.duration_minutes,
    });
    if (days > 0) {
      await applyOtCompOffCredit(
        businessId,
        req.employee_id,
        policy.comp_off_leave_type_id,
        days,
        req.request_date,
      );
    }
  } else {
    const amount = await computeOtMonetaryAmount({
      businessId,
      employeeId: req.employee_id,
      requestDate: req.request_date.slice(0, 10),
      durationMinutes: req.duration_minutes,
    });
    if (amount > 0) {
      await createOtPayrollEntry(businessId, req.employee_id, overtimeRequestId, amount);
    }
  }
}
