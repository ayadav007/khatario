import { query, queryOne, queryRows } from '@/lib/db';
import type { LeaveEncashmentRateBasis } from '@/lib/hr/leave/types';

export async function computeEncashmentAmount(
  businessId: string,
  employeeId: string,
  days: number,
  basis: LeaveEncashmentRateBasis = 'basic_per_30',
): Promise<number> {
  const structure = await queryOne<{
    basic_salary: string;
    hra: string;
    transport_allowance: string;
    medical_allowance: string;
    special_allowance: string;
    other_allowances: string;
  }>(
    `SELECT basic_salary, hra, transport_allowance, medical_allowance, special_allowance, other_allowances
     FROM salary_structures
     WHERE business_id = $1 AND employee_id = $2
       AND effective_from <= CURRENT_DATE
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY effective_from DESC LIMIT 1`,
    [businessId, employeeId],
  );

  if (!structure) return 0;

  const basic = Number(structure.basic_salary ?? 0);
  const gross =
    basic +
    Number(structure.hra ?? 0) +
    Number(structure.transport_allowance ?? 0) +
    Number(structure.medical_allowance ?? 0) +
    Number(structure.special_allowance ?? 0) +
    Number(structure.other_allowances ?? 0);

  const daily = basis === 'gross_per_30' ? gross / 30 : basic / 30;
  return Math.round(daily * days * 100) / 100;
}

export type EncashmentApplyResult = {
  amount: number;
  entries: Array<{ id: string; days: number; amount: number; leave_type_id: string }>;
};

export async function applyPendingLeaveEncashment(
  businessId: string,
  employeeId: string,
  salaryPaymentId: string,
): Promise<EncashmentApplyResult> {
  const pending = await queryRows<{
    id: string;
    days: string;
    amount: string;
    leave_type_id: string;
  }>(
    `SELECT id, days::text, amount::text, leave_type_id
     FROM leave_encashment_entries
     WHERE business_id = $1 AND employee_id = $2 AND status = 'pending'
     ORDER BY created_at ASC`,
    [businessId, employeeId],
  );

  if (pending.length === 0) return { amount: 0, entries: [] };

  let total = 0;
  const entries: EncashmentApplyResult['entries'] = [];

  for (const row of pending) {
    const amount = Number(row.amount);
    total += amount;
    entries.push({
      id: row.id,
      days: Number(row.days),
      amount,
      leave_type_id: row.leave_type_id,
    });

    await queryOne(
      `UPDATE leave_encashment_entries SET
         status = 'applied',
         salary_payment_id = $2,
         applied_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id, salaryPaymentId],
    );
  }

  return { amount: Math.round(total * 100) / 100, entries };
}

export async function getPendingEncashmentTotal(
  businessId: string,
  employeeId: string,
): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM leave_encashment_entries
     WHERE business_id = $1 AND employee_id = $2 AND status = 'pending'`,
    [businessId, employeeId],
  );
  return Number(row?.total ?? 0);
}
