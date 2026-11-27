import { getPool, queryOne, queryRows } from '@/lib/db';
import type { PoolClient, QueryResultRow } from 'pg';
import { computePlanAmount, type BillingCycle } from '@/lib/subscription/apply-plan-change';
import { planTierRank } from '@/lib/subscription/plan-tier';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';

// ── Types ──────────────────────────────────────────────────────────────

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: 'percentage' | 'flat' | 'free_months';
  value: number;
  currency: string;
  max_redemptions: number | null;
  current_redemptions: number;
  max_per_business: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  applicable_plans: string[] | null;
}

export interface CouponValidationResult {
  valid: boolean;
  coupon?: Coupon;
  error?: string;
  message?: string;
  discount?: { amount: number; type: string; freeMonths?: number; capped?: boolean };
}

interface DiscountResult {
  amount: number;
  type: string;
  freeMonths?: number;
  discountPerMonth?: number;
}

interface CouponRedemption {
  id: string;
  coupon_id: string;
  business_id: string;
  billing_transaction_id: string | null;
  plan_id: string;
  discount_amount: number;
  redeemed_at: string;
}

interface ListCouponsFilters {
  is_active?: boolean;
  type?: Coupon['type'];
  limit?: number;
  offset?: number;
}

interface CreateCouponData {
  code: string;
  description?: string;
  type: 'percentage' | 'flat' | 'free_months';
  value: number;
  currency?: string;
  min_plan_id?: string;
  applicable_plans?: string[];
  max_redemptions?: number;
  max_per_business?: number;
  valid_from?: string;
  valid_until?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

// ── Public Functions ───────────────────────────────────────────────────

type Runner = <T extends QueryResultRow>(sql: string, values: unknown[]) => Promise<T | null>;

function runnerFor(client?: PoolClient): Runner {
  return client
    ? async (sql, values) => ((await client.query(sql, values)).rows[0] ?? null)
    : (sql, values) => queryOne(sql, values);
}

const COUPON_COLUMNS = `id, code, description, type, value, currency,
            max_redemptions, current_redemptions, max_per_business,
            valid_from, valid_until, is_active, applicable_plans, min_plan_id,
            (valid_from > CURRENT_DATE) AS not_yet_valid,
            (valid_until IS NOT NULL AND valid_until < CURRENT_DATE) AS is_expired`;

type CouponRow = Coupon & { min_plan_id: string | null; not_yet_valid: boolean; is_expired: boolean };

/**
 * Why this coupon cannot be used by this business on this plan right now, or null when it can.
 * One rule set for checkout creation (advisory) and for redemption (where it decides the
 * over-limit flag). Dates are compared in SQL (calendar days: a coupon valid until the 30th still
 * works on the 30th). `min_plan_id` is compared by tier (plan-tier.ts), never by price, and only
 * within the same product line.
 */
async function couponProblem(
  run: Runner,
  coupon: CouponRow,
  businessId: string,
  planId: string,
  excludeTransactionId?: string,
): Promise<string | null> {
  if (!coupon.is_active) return 'Coupon is no longer active';
  if (coupon.not_yet_valid) return 'Coupon is not yet valid';
  if (coupon.is_expired) return 'Coupon has expired';

  if (coupon.max_redemptions !== null && coupon.current_redemptions >= coupon.max_redemptions) {
    return 'Coupon has reached its maximum redemptions';
  }

  const used = await run<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM coupon_redemptions
     WHERE coupon_id = $1 AND business_id = $2
       AND ($3::uuid IS NULL OR billing_transaction_id IS DISTINCT FROM $3::uuid)`,
    [coupon.id, businessId, excludeTransactionId ?? null],
  );
  if (used && parseInt(used.count, 10) >= coupon.max_per_business) {
    return 'You have already used this coupon the maximum number of times';
  }

  if (coupon.applicable_plans && coupon.applicable_plans.length > 0) {
    if (!coupon.applicable_plans.includes(planId)) {
      return 'Coupon is not applicable to the selected plan';
    }
  }

  if (coupon.min_plan_id) {
    const tiers = await run<{
      min_id: string | null; min_sort: number | null; min_line: string | null;
      id: string | null; sort: number | null; line: string | null;
    }>(
      `SELECT m.id AS min_id, m.sort_order AS min_sort, COALESCE(m.product_line, 'billing') AS min_line,
              p.id AS id, p.sort_order AS sort, COALESCE(p.product_line, 'billing') AS line
       FROM (SELECT 1) one
       LEFT JOIN subscription_plans m ON m.id = $1
       LEFT JOIN subscription_plans p ON p.id = $2`,
      [coupon.min_plan_id, planId],
    );
    const ok =
      tiers && tiers.min_id && tiers.id && tiers.min_line === tiers.line &&
      planTierRank({ id: tiers.id, sort_order: Number(tiers.sort) }) >=
        planTierRank({ id: tiers.min_id, sort_order: Number(tiers.min_sort) });
    if (!ok) return 'Coupon is not applicable to the selected plan';
  }
  return null;
}

type PlanPriceRow = { price_monthly: string; price_yearly: string; price_3year: string | null };

/**
 * The discount a coupon gives on one billing cycle. Percentage and flat coupons apply to the cycle
 * price. Cap: a coupon that would make the amount zero on a cycle longer than monthly takes off at
 * most that plan's monthly price, so a 100% coupon is one month free, not a year or three.
 */
export function calculateCycleDiscount(
  coupon: Pick<Coupon, 'type' | 'value'>,
  plan: PlanPriceRow | null,
  billingCycle: BillingCycle,
): DiscountResult & { capped?: boolean } {
  const cyclePrice = plan ? computePlanAmount(plan, billingCycle) : 0;
  const discount = calculateDiscount(coupon, cyclePrice);
  if (billingCycle !== 'monthly' && plan && discount.amount > 0 && Math.round(discount.amount * 100) >= Math.round(cyclePrice * 100)) {
    const monthly = computePlanAmount(plan, 'monthly');
    if (monthly < cyclePrice) {
      return { ...discount, amount: monthly, capped: true };
    }
  }
  return discount;
}

export async function validateCoupon(
  code: string,
  businessId: string,
  planId: string,
  billingCycle: 'monthly' | 'yearly' | 'three_year' = 'monthly',
): Promise<CouponValidationResult> {
  const coupon = await queryOne<CouponRow>(
    `SELECT ${COUPON_COLUMNS} FROM coupons WHERE UPPER(code) = UPPER($1)`,
    [code],
  );

  if (!coupon) {
    return { valid: false, error: 'Coupon code not found' };
  }

  const problem = await couponProblem(runnerFor(), coupon, businessId, planId);
  if (problem) return { valid: false, error: problem };

  const plan = await queryOne<PlanPriceRow>(
    `SELECT price_monthly, price_yearly, price_3year FROM subscription_plans WHERE id = $1`,
    [planId],
  );

  const discount = calculateCycleDiscount(coupon, plan, billingCycle);

  return {
    valid: true,
    coupon,
    discount,
    message:
      coupon.type === 'free_months'
        ? `${coupon.value} month(s) free on this plan`
        : discount.amount > 0
          ? discount.capped
            ? `Save ₹${Math.round(discount.amount).toLocaleString('en-IN')} on checkout (a coupon takes off at most one month on a longer plan, so you pay the rest)`
            : `Save ₹${Math.round(discount.amount).toLocaleString('en-IN')} on checkout`
          : 'Coupon is valid for this plan',
  };
}

export class CouponUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'CouponUnavailableError';
  }
}

/**
 * Record a coupon redemption for one billing transaction. Idempotent per
 * (coupon, business, billing transaction): the counter moves only when a row is inserted.
 *
 * The transaction id is required (a null id would defeat the unique key), so a path with no
 * payment row must record one first. Runs in a transaction: the caller's when `client` is given
 * (payment completion), otherwise its own. Lock order: [checkout row] → module advisory lock
 * `module_plan_change:<business>:<module>` → coupon row → anything else. Both locks are taken here
 * if the caller has not already (the advisory lock is re-entrant inside one transaction).
 *
 * The coupon row is locked and the limits are re-checked under that lock. If the coupon has run
 * out since checkout: `strict` (nothing was paid, e.g. the ₹0 path) throws CouponUnavailableError
 * and writes nothing; otherwise the payment stands, the redemption is recorded and the payment row
 * is flagged `metadata.coupon_over_limit` for the nightly report.
 */
export async function redeemCoupon(
  couponId: string,
  businessId: string,
  planId: string,
  billingTransactionId: string,
  billingCycle: BillingCycle,
  client?: PoolClient,
  options: { strict?: boolean } = {},
): Promise<{ type: Coupon['type']; value: number; discount_amount: number; over_limit?: string }> {
  if (!billingTransactionId) {
    throw new Error('A coupon redemption needs the billing transaction it belongs to');
  }
  if (!client) {
    const own = await getPool().connect();
    try {
      await own.query('BEGIN');
      const r = await redeemCoupon(couponId, businessId, planId, billingTransactionId, billingCycle, own, options);
      await own.query('COMMIT');
      return r;
    } catch (err) {
      await own.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      own.release();
    }
  }

  const run = runnerFor(client);
  const moduleKey = await resolveModuleKeyForPlan(planId, client);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `module_plan_change:${businessId}:${moduleKey}`,
  ]);

  // NO KEY UPDATE serialises redeemers like FOR UPDATE but does not block the foreign-key check of
  // a payment row being created for this coupon at the same moment.
  const coupon = await run<CouponRow>(
    `SELECT ${COUPON_COLUMNS} FROM coupons WHERE id = $1 FOR NO KEY UPDATE`,
    [couponId],
  );
  if (!coupon) {
    throw new Error(`Coupon ${couponId} not found`);
  }
  const value = Number(coupon.value);

  const existing = await run<{ id: string; discount_amount: string }>(
    `SELECT id, discount_amount::text AS discount_amount FROM coupon_redemptions
     WHERE coupon_id = $1 AND business_id = $2 AND billing_transaction_id = $3`,
    [couponId, businessId, billingTransactionId],
  );
  if (existing) {
    return { type: coupon.type, value, discount_amount: Number(existing.discount_amount) };
  }

  const problem = await couponProblem(run, coupon, businessId, planId, billingTransactionId);
  if (problem && options.strict) throw new CouponUnavailableError(problem);

  // The real discount is the one the customer was given on this payment (stored at checkout);
  // with no such row it is worked out on the chosen cycle.
  const tx = await run<{ discount_amount: string }>(
    `SELECT discount_amount::text AS discount_amount FROM billing_transactions
     WHERE id = $1 AND business_id = $2 AND coupon_id = $3`,
    [billingTransactionId, businessId, couponId],
  );
  let discountAmount: number;
  if (tx) {
    discountAmount = Number(tx.discount_amount) || 0;
  } else {
    const plan = await run<PlanPriceRow>(
      `SELECT price_monthly, price_yearly, price_3year FROM subscription_plans WHERE id = $1`,
      [planId],
    );
    discountAmount = calculateCycleDiscount({ type: coupon.type, value }, plan, billingCycle).amount;
  }

  const inserted = await run<{ id: string }>(
    `INSERT INTO coupon_redemptions
       (coupon_id, business_id, plan_id, discount_amount, billing_transaction_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (coupon_id, business_id, billing_transaction_id) DO NOTHING
     RETURNING id`,
    [couponId, businessId, planId, discountAmount, billingTransactionId],
  );

  if (inserted) {
    await run(
      `UPDATE coupons
       SET current_redemptions = current_redemptions + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [couponId],
    );
    if (problem) {
      await run(
        `UPDATE billing_transactions
         SET metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('coupon_over_limit', jsonb_build_object('reason', $3::text, 'coupon_id', $2::text)),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [billingTransactionId, couponId, problem],
      );
    }
  }

  return {
    type: coupon.type,
    value,
    discount_amount: discountAmount,
    ...(problem ? { over_limit: problem } : {}),
  };
}

/**
 * Undo a redemption claimed by a ₹0 activation that then failed to switch the plan, so the
 * customer can try again. Only the bookkeeping row written for that attempt is removed; the coupon
 * row is locked first, as in redeemCoupon.
 */
export async function releaseCouponClaim(
  couponId: string,
  businessId: string,
  billingTransactionId: string,
): Promise<void> {
  const own = await getPool().connect();
  try {
    await own.query('BEGIN');
    await own.query(`SELECT id FROM coupons WHERE id = $1 FOR NO KEY UPDATE`, [couponId]);
    const gone = await own.query(
      `DELETE FROM coupon_redemptions
       WHERE coupon_id = $1 AND business_id = $2 AND billing_transaction_id = $3
       RETURNING id`,
      [couponId, businessId, billingTransactionId],
    );
    if (gone.rows.length > 0) {
      await own.query(
        `UPDATE coupons SET current_redemptions = GREATEST(current_redemptions - 1, 0),
                updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [couponId],
      );
    }
    await own.query('COMMIT');
  } catch (err) {
    await own.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    own.release();
  }
}

export function calculateDiscount(
  coupon: Pick<Coupon, 'type' | 'value'>,
  planPrice: number
): DiscountResult {
  switch (coupon.type) {
    case 'percentage': {
      const raw = planPrice * (coupon.value / 100);
      return {
        amount: Math.min(raw, planPrice),
        type: 'percentage',
      };
    }
    case 'flat': {
      return {
        amount: Math.min(coupon.value, planPrice),
        type: 'flat',
      };
    }
    case 'free_months': {
      return {
        amount: 0,
        type: 'free_months',
        freeMonths: coupon.value,
        discountPerMonth: planPrice,
      };
    }
    default:
      return { amount: 0, type: coupon.type };
  }
}

export async function listCoupons(
  filters?: ListCouponsFilters
): Promise<{ coupons: Coupon[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters?.is_active !== undefined) {
    conditions.push(`is_active = $${idx++}`);
    params.push(filters.is_active);
  }

  if (filters?.type) {
    conditions.push(`type = $${idx++}`);
    params.push(filters.type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM coupons ${where}`,
    params
  );

  const coupons = await queryRows<Coupon>(
    `SELECT id, code, description, type, value, currency,
            max_redemptions, current_redemptions, max_per_business,
            valid_from, valid_until, is_active, applicable_plans
     FROM coupons
     ${where}
     ORDER BY created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return {
    coupons,
    total: parseInt(countResult?.count ?? '0', 10),
  };
}

export async function createCoupon(data: CreateCouponData): Promise<Coupon> {
  const coupon = await queryOne<Coupon>(
    `INSERT INTO coupons
       (code, description, type, value, currency, min_plan_id,
        applicable_plans, max_redemptions, max_per_business,
        valid_from, valid_until, created_by, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, code, description, type, value, currency,
               max_redemptions, current_redemptions, max_per_business,
               valid_from, valid_until, is_active, applicable_plans`,
    [
      data.code.toUpperCase(),
      data.description ?? null,
      data.type,
      data.value,
      data.currency ?? 'INR',
      data.min_plan_id ?? null,
      data.applicable_plans ?? null,
      data.max_redemptions ?? null,
      data.max_per_business ?? 1,
      data.valid_from ?? new Date().toISOString().split('T')[0],
      data.valid_until ?? null,
      data.created_by ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]
  );

  if (!coupon) {
    throw new Error('Failed to create coupon');
  }

  return coupon;
}

export async function deactivateCoupon(couponId: string): Promise<Coupon | null> {
  return queryOne<Coupon>(
    `UPDATE coupons
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, code, description, type, value, currency,
               max_redemptions, current_redemptions, max_per_business,
               valid_from, valid_until, is_active, applicable_plans`,
    [couponId]
  );
}
