import type { PoolClient } from 'pg';
import { query } from '@/lib/db';
import { isProductLineTrialPlanId } from '@/lib/product-lines';
import {
  billingCycleMonths,
  computePlanAmount,
  BILLING_CYCLES,
  type BillingCycle,
} from '@/lib/subscription/apply-plan-change';

export type PeriodKind = 'renewal' | 'change' | 'fresh';

export type NewPeriod = {
  kind: PeriodKind;
  startDate: string;
  endDate: string;
  /** Unused trial days added to a `change` period (0 otherwise). */
  trialDaysCarried: number;
};

export type CurrentPeriodRow = {
  plan_id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  trial_end_date: string | null;
};

/**
 * True when the plan has a price above zero for any billing cycle (never decided by plan id or
 * sort order, so a plan priced at ₹1 counts as paid).
 */
export async function planHasPaidPrice(planId: string, client?: PoolClient): Promise<boolean> {
  const sql = `SELECT price_monthly, price_yearly, price_3year FROM subscription_plans WHERE id = $1`;
  const res = client ? await client.query(sql, [planId]) : await query(sql, [planId]);
  const plan = res.rows[0];
  if (!plan) return false;
  return BILLING_CYCLES.some((cycle) => computePlanAmount(plan, cycle) > 0);
}

/**
 * Decides the period a payment buys, in one SQL statement. Every calendar date is the database's
 * (`CURRENT_DATE`) and month arithmetic is PostgreSQL's, so 31 January + 1 month is the end of
 * February and nothing depends on the server's clock or time zone.
 *
 * - renewal: same paid plan, still active, end date today or later. The new end is the old end plus
 *   one cycle; the start is unchanged, so the days already paid for are kept.
 * - change: a different plan, or a paid plan whose end date has passed. Starts today. Unused trial
 *   days are added after the cycle when the current plan is a trial.
 * - fresh: no row yet. Starts today.
 */
export async function resolveNewPeriod(
  input: {
    current: CurrentPeriodRow | null;
    targetPlanId: string;
    billingCycle: BillingCycle;
    currentPlanIsPaid: boolean;
  },
  client?: PoolClient,
): Promise<NewPeriod> {
  const cur = input.current;
  const sql = `
    WITH i AS (
      SELECT $1::boolean AS has_row,
             $2::text AS cur_plan,
             $3::text AS target_plan,
             $4::text AS cur_status,
             $5::date AS cur_start,
             $6::date AS cur_end,
             $7::date AS trial_end,
             $8::int AS months,
             $9::boolean AS cur_paid,
             $10::boolean AS cur_is_trial
    ), k AS (
      SELECT i.*,
             CASE
               WHEN NOT has_row THEN 'fresh'
               WHEN cur_plan = target_plan AND cur_paid AND cur_status = 'active'
                    AND cur_end IS NOT NULL AND cur_end >= CURRENT_DATE THEN 'renewal'
               ELSE 'change'
             END AS kind
      FROM i
    ), d AS (
      SELECT k.*,
             CASE WHEN kind = 'change' AND cur_is_trial AND trial_end IS NOT NULL AND trial_end > CURRENT_DATE
                  THEN (trial_end - CURRENT_DATE) ELSE 0 END AS trial_days
      FROM k
    )
    SELECT kind,
           (CASE WHEN kind = 'renewal' THEN COALESCE(cur_start, CURRENT_DATE) ELSE CURRENT_DATE END)::text AS start_date,
           (CASE WHEN kind = 'renewal'
                 THEN (cur_end + make_interval(months => months))::date
                 ELSE (CURRENT_DATE + make_interval(months => months))::date + trial_days
            END)::text AS end_date,
           trial_days::int AS trial_days
    FROM d`;
  const values = [
    cur !== null,
    cur?.plan_id ?? null,
    input.targetPlanId,
    cur?.status ?? null,
    cur?.start_date ?? null,
    cur?.end_date ?? null,
    cur?.trial_end_date ?? null,
    billingCycleMonths(input.billingCycle),
    input.currentPlanIsPaid,
    cur ? isProductLineTrialPlanId(cur.plan_id) : false,
  ];
  const res = client ? await client.query(sql, values) : await query(sql, values);
  const row = res.rows[0] as { kind: PeriodKind; start_date: string; end_date: string; trial_days: number };
  return {
    kind: row.kind,
    startDate: row.start_date,
    endDate: row.end_date,
    trialDaysCarried: row.trial_days,
  };
}
