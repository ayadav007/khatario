import { queryOne } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';

export type BillingCycle = 'monthly' | 'yearly';

export function computePlanAmount(
  plan: { price_monthly: number | string; price_yearly: number | string },
  billingCycle: BillingCycle,
): number {
  const raw =
    billingCycle === 'yearly'
      ? Number(plan.price_yearly) || 0
      : Number(plan.price_monthly) || 0;
  return Math.round(raw * 100) / 100;
}

export function computeSubscriptionPeriodEnd(billingCycle: BillingCycle): string {
  const start = new Date();
  if (billingCycle === 'yearly') {
    start.setFullYear(start.getFullYear() + 1);
  } else {
    start.setMonth(start.getMonth() + 1);
  }
  return start.toISOString().split('T')[0];
}

export interface ApplyPlanChangeResult {
  subscription_id: string;
  business_id: string;
  plan_id: string;
  status: string;
  start_date: string;
  end_date: string;
  billing_cycle: BillingCycle;
}

/**
 * Activates a subscription plan after payment (webhook) or for free/zero-amount upgrades.
 */
export async function applySubscriptionPlanChange(params: {
  businessId: string;
  planId: string;
  billingCycle: BillingCycle;
  paymentMethod?: string;
  paymentReference?: string | null;
}): Promise<ApplyPlanChangeResult> {
  const startDate = new Date().toISOString().split('T')[0];
  const endDate = computeSubscriptionPeriodEnd(params.billingCycle);
  const paymentMethod = params.paymentMethod ?? 'manual';
  const paymentReference = params.paymentReference?.trim() || null;

  const existing = await queryOne<{ id: string; plan_id: string }>(
    `SELECT id, plan_id FROM business_subscriptions WHERE business_id = $1`,
    [params.businessId],
  );

  let row: ApplyPlanChangeResult | null = null;

  if (existing) {
    row = await queryOne<ApplyPlanChangeResult>(
      `UPDATE business_subscriptions
       SET plan_id = $1,
           status = 'active',
           start_date = $2,
           end_date = $3,
           billing_cycle = $4,
           payment_method = $5,
           payment_reference = $6,
           trial_end_date = NULL,
           scheduled_plan_id = NULL,
           cancel_at_period_end = false,
           cancelled_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $7
       RETURNING id AS subscription_id, business_id, plan_id, status,
                 start_date::text, end_date::text, billing_cycle`,
      [
        params.planId,
        startDate,
        endDate,
        params.billingCycle,
        paymentMethod,
        paymentReference,
        params.businessId,
      ],
    );
  } else {
    row = await queryOne<ApplyPlanChangeResult>(
      `INSERT INTO business_subscriptions (
         business_id, plan_id, status, start_date, end_date,
         billing_cycle, payment_method, payment_reference
       ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7)
       RETURNING id AS subscription_id, business_id, plan_id, status,
                 start_date::text, end_date::text, billing_cycle`,
      [
        params.businessId,
        params.planId,
        startDate,
        endDate,
        params.billingCycle,
        paymentMethod,
        paymentReference,
      ],
    );
  }

  if (!row) {
    throw new Error('Failed to apply subscription plan change');
  }

  clearSubscriptionCache(params.businessId);

  await logSubscriptionEvent(params.businessId, 'upgraded', {
    to_plan_id: params.planId,
    from_plan_id: existing?.plan_id,
    billing_cycle: params.billingCycle,
    payment_method: paymentMethod,
  });

  return row;
}

/** Extend subscription end_date after a free_months coupon (on top of normal period). */
export async function extendSubscriptionForFreeMonths(
  businessId: string,
  freeMonths: number,
): Promise<void> {
  if (!Number.isFinite(freeMonths) || freeMonths <= 0) return;

  await queryOne(
    `UPDATE business_subscriptions
     SET end_date = (
       COALESCE(end_date::date, CURRENT_DATE) + make_interval(months => $2::int)
     )::date,
     updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1`,
    [businessId, Math.floor(freeMonths)],
  );

  clearSubscriptionCache(businessId);
}
