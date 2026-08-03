import { query, queryOne, queryRows } from '@/lib/db';
import { getDefaultPlanBundle, getLeavePlanTypeRules } from '@/lib/hr/leave/leave-plan';
import { computeEncashmentAmount } from '@/lib/hr/leave/leave-encashment-payroll';
import { getLeaveYearDateRange } from '@/lib/hr/leave/types';

export type YearEndPreviewRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  leave_type_id: string;
  leave_code: string;
  leave_name: string;
  current_balance: number;
  treatment: string;
  carry_forward: number;
  encash_days: number;
  encash_amount: number;
};

export async function previewLeaveYearEnd(
  businessId: string,
  leaveYear: number,
): Promise<YearEndPreviewRow[]> {
  const { plan } = await getDefaultPlanBundle(businessId);
  const rules = await getLeavePlanTypeRules(plan.id);
  const ruleByType = new Map(rules.map((r) => [r.leave_type_id, r]));

  const balances = await queryRows<{
    employee_id: string;
    employee_code: string;
    employee_name: string;
    leave_type_id: string;
    leave_code: string;
    leave_name: string;
    current_balance: string;
  }>(
    `SELECT lb.employee_id, e.employee_code, u.name AS employee_name,
            lb.leave_type_id, lt.leave_code, lt.leave_name, lb.current_balance::text
     FROM leave_balances lb
     INNER JOIN employees e ON e.id = lb.employee_id
     INNER JOIN users u ON u.id = e.id
     INNER JOIN leave_types lt ON lt.id = lb.leave_type_id
     WHERE e.business_id = $1 AND lb.year = $2`,
    [businessId, leaveYear],
  );

  const preview: YearEndPreviewRow[] = [];
  for (const b of balances) {
    const rule = ruleByType.get(b.leave_type_id);
    if (!rule) continue;

    let balance = Number(b.current_balance);
    if (balance < 0 && !rule.allow_negative_balance) balance = 0;
    if (balance <= 0 && rule.negative_balance_treatment === 'reset') continue;

    let carry = 0;
    let encashDays = 0;
    let encashAmount = 0;

    if (balance > 0) {
      if (rule.year_end_treatment === 'expire') {
        carry = 0;
        encashDays = 0;
      } else if (rule.year_end_treatment === 'carry_forward') {
        carry = rule.max_carry_forward_days != null
          ? Math.min(balance, rule.max_carry_forward_days)
          : balance;
      } else if (rule.year_end_treatment === 'encash') {
        encashDays = balance;
        encashAmount = await computeEncashmentAmount(businessId, b.employee_id, encashDays, plan.encashment_daily_rate_basis);
      } else if (rule.year_end_treatment === 'carry_or_encash') {
        carry = rule.max_carry_forward_days != null
          ? Math.min(balance, rule.max_carry_forward_days)
          : balance;
        encashDays = Math.max(0, balance - carry);
        if (encashDays > 0) {
          encashAmount = await computeEncashmentAmount(
            businessId,
            b.employee_id,
            encashDays,
            plan.encashment_daily_rate_basis,
          );
        }
      }
    } else if (balance < 0 && rule.negative_balance_treatment === 'carry_deficit') {
      carry = balance;
    }

    preview.push({
      employee_id: b.employee_id,
      employee_code: b.employee_code,
      employee_name: b.employee_name,
      leave_type_id: b.leave_type_id,
      leave_code: b.leave_code,
      leave_name: b.leave_name,
      current_balance: Number(b.current_balance),
      treatment: rule.year_end_treatment,
      carry_forward: carry,
      encash_days: encashDays,
      encash_amount: encashAmount,
    });
  }

  return preview;
}

export async function runLeaveYearEnd(
  businessId: string,
  leaveYear: number,
): Promise<{ processed: number; encashment_total: number }> {
  const existing = await queryOne(
    `SELECT id FROM leave_year_end_runs WHERE business_id = $1 AND leave_year = $2`,
    [businessId, leaveYear],
  );
  if (existing) throw new Error(`Year-end already processed for leave year ${leaveYear}`);

  const { plan } = await getDefaultPlanBundle(businessId);
  const nextYear = leaveYear + 1;
  const preview = await previewLeaveYearEnd(businessId, leaveYear);

  let processed = 0;
  let encashmentTotal = 0;

  for (const row of preview) {
    await queryOne(
      `UPDATE leave_balances SET
         used_days = used_days + $4,
         current_balance = 0,
         updated_at = CURRENT_TIMESTAMP
       WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
      [
        row.employee_id,
        row.leave_type_id,
        leaveYear,
        Math.max(0, row.current_balance),
      ],
    );

    if (row.carry_forward !== 0) {
      await queryOne(
        `INSERT INTO leave_balances (
           employee_id, leave_type_id, year, carry_forward_days, current_balance
         ) VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET
           carry_forward_days = leave_balances.carry_forward_days + EXCLUDED.carry_forward_days,
           current_balance = leave_balances.opening_balance + leave_balances.earned_days + leave_balances.carry_forward_days - leave_balances.used_days,
           updated_at = CURRENT_TIMESTAMP`,
        [row.employee_id, row.leave_type_id, nextYear, row.carry_forward],
      );
    }

    if (row.encash_days > 0 && row.encash_amount > 0) {
      await query(
        `INSERT INTO leave_encashment_entries (
           business_id, employee_id, leave_type_id, leave_year, days, amount, status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [
          businessId,
          row.employee_id,
          row.leave_type_id,
          leaveYear,
          row.encash_days,
          row.encash_amount,
        ],
      );
      encashmentTotal += row.encash_amount;
    }

    processed += 1;
  }

  await query(
    `INSERT INTO leave_year_end_runs (business_id, leave_year, summary)
     VALUES ($1, $2, $3::jsonb)`,
    [
      businessId,
      leaveYear,
      JSON.stringify({
        processed,
        encashment_total: encashmentTotal,
        range: getLeaveYearDateRange(leaveYear, plan.calendar_year_start_month),
      }),
    ],
  );

  return { processed, encashment_total: encashmentTotal };
}

export async function runLeaveYearEndForDueBusinesses(asOf = new Date()): Promise<number> {
  const businesses = await queryRows<{ business_id: string; calendar_year_start_month: number }>(
    `SELECT business_id, calendar_year_start_month FROM leave_plans WHERE is_default = true AND is_active = true`,
  );

  let count = 0;
  for (const b of businesses) {
    const month = asOf.getMonth() + 1;
    if (month !== b.calendar_year_start_month) continue;

    const leaveYear = asOf.getFullYear() - 1;
    try {
      await runLeaveYearEnd(b.business_id, leaveYear);
      count += 1;
    } catch {
      // skip already processed or errors per business
    }
  }
  return count;
}
