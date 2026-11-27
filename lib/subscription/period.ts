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
  /** Set only when `shorten` was given: the days this payment bought (replaces the cycle's months). */
  shortenedDays?: number;
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
    /**
     * A payment whose upgrade credit was no longer available: it paid `paidPaise` for a period that
     * was priced with `creditPaise` of credit, so it buys floor(full days x paid / (paid + credit))
     * days, at least 1, in place of the whole cycle. Days are counted in SQL from where the paid time begins.
     */
    shorten?: { paidPaise: number; creditPaise: number };
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
             $10::boolean AS cur_is_trial,
             $11::bigint AS paid_paise,
             $12::bigint AS credit_paise
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
    ), f AS (
      SELECT d.*,
             (CASE WHEN kind = 'renewal' THEN cur_end ELSE CURRENT_DATE END) AS paid_from,
             (CASE WHEN kind = 'renewal' THEN cur_end ELSE CURRENT_DATE END
                + make_interval(months => months))::date
               - (CASE WHEN kind = 'renewal' THEN cur_end ELSE CURRENT_DATE END) AS full_days
      FROM d
    ), g AS (
      SELECT f.*,
             CASE WHEN paid_paise IS NULL THEN NULL
                  ELSE GREATEST(1, floor(full_days::numeric * paid_paise / NULLIF(paid_paise + credit_paise, 0)))::int
             END AS short_days
      FROM f
    )
    SELECT kind,
           (CASE WHEN kind = 'renewal' THEN COALESCE(cur_start, CURRENT_DATE) ELSE CURRENT_DATE END)::text AS start_date,
           (CASE WHEN short_days IS NOT NULL
                 THEN paid_from + short_days + (CASE WHEN kind = 'renewal' THEN 0 ELSE trial_days END)
                 WHEN kind = 'renewal'
                 THEN (cur_end + make_interval(months => months))::date
                 ELSE (CURRENT_DATE + make_interval(months => months))::date + trial_days
            END)::text AS end_date,
           trial_days::int AS trial_days,
           short_days
    FROM g`;
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
    input.shorten ? input.shorten.paidPaise : null,
    input.shorten ? input.shorten.creditPaise : null,
  ];
  const res = client ? await client.query(sql, values) : await query(sql, values);
  const row = res.rows[0] as {
    kind: PeriodKind;
    start_date: string;
    end_date: string;
    trial_days: number;
    short_days: number | null;
  };
  return {
    kind: row.kind,
    startDate: row.start_date,
    endDate: row.end_date,
    trialDaysCarried: row.trial_days,
    ...(row.short_days !== null && row.short_days !== undefined ? { shortenedDays: row.short_days } : {}),
  };
}
