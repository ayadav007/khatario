import type { PoolClient } from 'pg';
import { query } from '@/lib/db';
import type { PlatformModule } from '@/lib/platform-modules';
import { comparePlanTier } from '@/lib/subscription/plan-tier';

/**
 * The amount a payment actually paid for the subscription itself, excluding any tax, minus what has
 * been refunded or is being refunded (`metadata.refunded_paise`, kept by lib/platform-refunds.ts), so a
 * partly refunded payment gives credit only on what remains. The base is the stored taxable amount
 * (migration 480) when one is recorded, else `total_amount`: rows from before GST was recorded have no
 * breakdown and are tax-free. A refund is money including tax, so its pre-tax share is taken off in
 * proportion (taxable / total); for a tax-free payment that is the whole refund, exactly as before.
 * This is the single swap point: nothing else reads these columns for credit.
 */
export const PAID_SUBSCRIPTION_AMOUNT_SQL =
  `(COALESCE(bt.taxable_amount, bt.total_amount)
    - COALESCE((bt.metadata->>'refunded_paise')::numeric, 0) * COALESCE(bt.taxable_amount, bt.total_amount) / (100 * NULLIF(bt.total_amount, 0)))`;

export type CreditSource = {
  id: string;
  /** Credit this payment gives now, in paise (rounded down). */
  creditPaise: number;
  unusedDays: number;
  periodDays: number;
  /** Paise already refunded (or being refunded) on this payment when the credit was computed. */
  refundedPaise: number;
};

export type UpgradeCredit = {
  /** Rupees available, rounded down to paise per payment. */
  amount: number;
  /** The payment that gives the most credit (null when there is none). */
  fromTransactionId: string | null;
  /** Every payment the credit comes from, oldest period first. */
  fromTransactionIds: string[];
  /** Unused days summed over the source payments. */
  unusedDays: number;
  /** Period days summed over the source payments. */
  periodDays: number;
  /** The plan the module row is on (the plan the source payments bought). */
  fromPlanId: string | null;
  sources: CreditSource[];
};

export const NO_UPGRADE_CREDIT: UpgradeCredit = {
  amount: 0,
  fromTransactionId: null,
  fromTransactionIds: [],
  unusedDays: 0,
  periodDays: 0,
  fromPlanId: null,
  sources: [],
};

/** `refundedPaise` is stored only when above 0: what the source had already refunded when the credit was granted. */
export type CreditAllocation = { id: string; paise: number; refundedPaise?: number };

/** Takes `appliedPaise` of credit from the sources oldest first; sources that are not needed get nothing. */
export function allocateCredit(sources: CreditSource[], appliedPaise: number): CreditAllocation[] {
  let left = Math.max(0, Math.floor(appliedPaise));
  const out: CreditAllocation[] = [];
  for (const s of sources) {
    if (left <= 0) break;
    const take = Math.min(left, s.creditPaise);
    if (take > 0) {
      out.push(s.refundedPaise > 0 ? { id: s.id, paise: take, refundedPaise: s.refundedPaise } : { id: s.id, paise: take });
      left -= take;
    }
  }
  return out;
}

/**
 * What a payment can still be refunded in cash, in paise: the amount paid minus the credit that was
 * taken from it for an upgrade (`metadata.credit_used_paise`), never below 0. The refund code calls this.
 */
export function refundableAmountPaise(row: {
  total_amount: string | number | null;
  metadata?: { credit_used_paise?: number | string | null } | null;
}): number {
  const paid = Math.round(Number(row.total_amount ?? 0) * 100);
  const used = Math.round(Number(row.metadata?.credit_used_paise ?? 0));
  if (!Number.isFinite(paid)) return 0;
  return Math.max(0, paid - (Number.isFinite(used) ? used : 0));
}

type Runner = (sql: string, values: unknown[]) => Promise<{ rows: any[] }>;

function runner(client?: PoolClient): Runner {
  return client
    ? (sql, values) => client.query(sql, values as unknown[])
    : (sql, values) => query(sql, values as unknown[]);
}

/**
 * Credit for the paid time a customer has not used yet when they move to a higher plan.
 *
 * Each completed subscription payment (never an add-on) for this business and product, bought for the
 * plan the customer is on now, whose recorded period is still running or lies ahead, gives its paid
 * amount x unused days / its own period days (rounded down to paise). A renewal bought early has a
 * period that starts at the old end, so it is counted whole. All date maths is the database's.
 *
 * Zero when the target is the same plan, not a higher tier (`plan-tier.ts`, never price), the
 * subscription is not an active one, or a payment has no recorded period, is refunded, or was
 * already used as credit (`metadata.credit_consumed_by`). Only payments for the plan the module row
 * is on now count, so after an upgrade the old plan's payments are out of reach.
 * The module key must come from the target plan's product line, never from the client.
 */
export async function computeUpgradeCredit(
  businessId: string,
  moduleKey: PlatformModule,
  targetPlanId: string,
  client?: PoolClient,
): Promise<UpgradeCredit> {
  const run = runner(client);

  const cur = (
    await run(
      `SELECT bms.plan_id, p.sort_order
       FROM business_module_subscriptions bms
       JOIN subscription_plans p ON p.id = bms.plan_id
       WHERE bms.business_id = $1 AND bms.module_key = $2 AND bms.status = 'active'`,
      [businessId, moduleKey],
    )
  ).rows[0] as { plan_id: string; sort_order: number } | undefined;
  if (!cur || cur.plan_id === targetPlanId) return NO_UPGRADE_CREDIT;

  const target = (
    await run(`SELECT id, sort_order, product_line FROM subscription_plans WHERE id = $1`, [targetPlanId])
  ).rows[0] as { id: string; sort_order: number } | undefined;
  if (!target) return NO_UPGRADE_CREDIT;
  if (comparePlanTier({ id: target.id, sort_order: target.sort_order }, { id: cur.plan_id, sort_order: cur.sort_order }) <= 0) {
    return NO_UPGRADE_CREDIT;
  }

  const rows = (
    await run(
      `SELECT bt.id::text AS id,
              (bt.period_end - GREATEST(bt.period_start, CURRENT_DATE))::int AS unused_days,
              (bt.period_end - bt.period_start)::int AS period_days,
              floor(${PAID_SUBSCRIPTION_AMOUNT_SQL} * (bt.period_end - GREATEST(bt.period_start, CURRENT_DATE))
                    / (bt.period_end - bt.period_start) * 100)::bigint AS credit_paise,
              COALESCE((bt.metadata->>'refunded_paise')::numeric, 0)::bigint AS refunded_paise
       FROM billing_transactions bt
       WHERE bt.business_id = $1 AND bt.module_key = $2 AND bt.plan_id = $3
         AND bt.type = 'payment' AND bt.status = 'completed'
         AND COALESCE(bt.gateway_response->>'checkout_type', 'subscription') = 'subscription'
         AND ${PAID_SUBSCRIPTION_AMOUNT_SQL} > 0
         AND bt.period_start IS NOT NULL AND bt.period_end IS NOT NULL
         AND bt.period_end > bt.period_start AND bt.period_end > CURRENT_DATE
         AND (bt.metadata->>'credit_consumed_by') IS NULL
       ORDER BY bt.period_start, bt.created_at, bt.id`,
      [businessId, moduleKey, cur.plan_id],
    )
  ).rows as { id: string; unused_days: number; period_days: number; credit_paise: string | number; refunded_paise: string | number }[];

  const sources: CreditSource[] = rows
    .map((r) => ({
      id: r.id,
      creditPaise: Number(r.credit_paise),
      unusedDays: r.unused_days,
      periodDays: r.period_days,
      refundedPaise: Number(r.refunded_paise),
    }))
    .filter((r) => r.creditPaise > 0);
  if (!sources.length) return NO_UPGRADE_CREDIT;

  const paise = sources.reduce((sum, r) => sum + r.creditPaise, 0);
  const biggest = sources.reduce((a, b) => (b.creditPaise > a.creditPaise ? b : a));
  return {
    amount: paise / 100,
    fromTransactionId: biggest.id,
    fromTransactionIds: sources.map((r) => r.id),
    unusedDays: sources.reduce((s, r) => s + r.unusedDays, 0),
    periodDays: sources.reduce((s, r) => s + r.periodDays, 0),
    fromPlanId: cur.plan_id,
    sources,
  };
}

export type StoredUpgradeCredit = {
  amount: number;
  from_plan_id?: string | null;
  from_transaction_ids?: string[];
  allocation?: CreditAllocation[];
};

/**
 * Completion-time check of a credit that was granted at checkout creation. Call it inside the
 * completion transaction, after the checkout row and the per-(business, module) advisory lock are
 * held; it locks the source rows FOR UPDATE (ordered by id). Returns null when the credit still
 * stands, otherwise the reason it does not:
 *  - plan_changed: the module row is no longer on the plan the credit was computed from
 *  - not_higher_tier: the target is no longer a higher tier than the current plan
 *  - source_unavailable: a source is missing, no longer completed, or refunded
 *  - source_refunded: a source was refunded further after the credit was granted (a refund that was
 *    already there at grant time is recorded in the allocation and is fine: the credit was computed on what remained)
 *  - source_consumed: a source was already used as credit by another checkout
 */
export async function recheckUpgradeCredit(
  client: PoolClient,
  params: {
    businessId: string;
    moduleKey: PlatformModule;
    targetPlanId: string;
    checkoutId: string;
    stored: StoredUpgradeCredit;
  },
): Promise<string | null> {
  const ids = params.stored.allocation?.map((a) => a.id) ?? params.stored.from_transaction_ids ?? [];
  if (!ids.length || !params.stored.from_plan_id) return 'source_unavailable';

  const cur = (
    await client.query(
      `SELECT bms.plan_id, p.sort_order
       FROM business_module_subscriptions bms
       JOIN subscription_plans p ON p.id = bms.plan_id
       WHERE bms.business_id = $1 AND bms.module_key = $2`,
      [params.businessId, params.moduleKey],
    )
  ).rows[0] as { plan_id: string; sort_order: number } | undefined;
  if (!cur || cur.plan_id !== params.stored.from_plan_id) return 'plan_changed';

  const target = (
    await client.query(`SELECT id, sort_order FROM subscription_plans WHERE id = $1`, [params.targetPlanId])
  ).rows[0] as { id: string; sort_order: number } | undefined;
  if (!target || comparePlanTier(target, { id: cur.plan_id, sort_order: cur.sort_order }) <= 0) {
    return 'not_higher_tier';
  }

  const src = (
    await client.query(
      `SELECT id::text AS id, status, metadata->>'credit_consumed_by' AS consumed_by,
              COALESCE((metadata->>'refunded_paise')::numeric, 0) AS refunded_paise
       FROM billing_transactions
       WHERE id = ANY($1::uuid[]) AND business_id = $2 AND module_key = $3
       ORDER BY id
       FOR UPDATE`,
      [ids, params.businessId, params.moduleKey],
    )
  ).rows as { id: string; status: string; consumed_by: string | null; refunded_paise: string | number }[];
  if (src.length !== new Set(ids).size || src.some((r) => r.status !== 'completed')) return 'source_unavailable';
  const grantedAt = new Map((params.stored.allocation ?? []).map((a) => [a.id, Number(a.refundedPaise ?? 0)]));
  if (src.some((r) => Number(r.refunded_paise) > (grantedAt.get(r.id) ?? 0))) return 'source_refunded';
  if (src.some((r) => r.consumed_by && r.consumed_by !== params.checkoutId)) return 'source_consumed';
  return null;
}

/** Marks each source as used, recording how many paise were taken from it. Inside the completion transaction. */
export async function consumeCreditSources(
  client: PoolClient,
  businessId: string,
  checkoutId: string,
  allocation: CreditAllocation[],
): Promise<void> {
  for (const a of allocation) {
    const r = await client.query(
      `UPDATE billing_transactions
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('credit_consumed_by', $3::text, 'credit_used_paise', $4::bigint),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2 AND (metadata->>'credit_consumed_by') IS NULL`,
      [a.id, businessId, checkoutId, a.paise],
    );
    if (r.rowCount !== 1) throw new Error('CREDIT_SOURCE_UPDATE_FAILED');
  }
}
