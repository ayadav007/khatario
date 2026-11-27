import { queryRows } from '@/lib/db';

export type UnappliedPayment = {
  billing_transaction_id: string;
  business_id: string;
  module_key: string;
  plan_id: string;
  paid_at: string;
};

export type StuckWebhookEvent = {
  id: string;
  provider: string;
  event_type: string;
  status: string;
  created_at: string;
};

/**
 * Completed subscription payments whose plan never reached business_module_subscriptions.
 * Read-only. A payment is unapplied when the latest completed payment for its
 * (business_id, module_key) has no module row, or the module row is on another plan and
 * was last written more than 5 seconds before the payment. The 5 second tolerance covers
 * an applied payment: its transaction timestamp and the module row's timestamp are written
 * in the same database transaction (equal or microseconds apart, either order).
 */
export async function findUnappliedPayments(): Promise<UnappliedPayment[]> {
  return queryRows<UnappliedPayment>(
    `WITH pay AS (
       -- When it was paid: the time stamped at completion. Refund bookkeeping and credit consumption touch updated_at
       -- on old payments later, which must not make an old payment look like the newest one (rows from before the
       -- stamp fall back to updated_at).
       SELECT bt.id, bt.business_id, bt.plan_id,
              COALESCE((bt.metadata->>'paid_at')::timestamptz, bt.updated_at) AS updated_at,
              COALESCE(bt.module_key,
                       CASE sp.product_line WHEN 'hr' THEN 'hr' WHEN 'connect' THEN 'connect' ELSE 'billing' END
              ) AS module_key
       FROM billing_transactions bt
       LEFT JOIN subscription_plans sp ON sp.id = bt.plan_id
       WHERE bt.type = 'payment'
         AND bt.status = 'completed'
         AND bt.total_amount > 0
         AND bt.plan_id IS NOT NULL
         AND COALESCE((bt.metadata->>'paid_at')::timestamptz, bt.updated_at) > CURRENT_TIMESTAMP - INTERVAL '35 days'
         AND bt.gateway_response->>'checkout_type' = 'subscription'
     ),
     latest AS (
       SELECT DISTINCT ON (business_id, module_key) *
       FROM pay
       ORDER BY business_id, module_key, updated_at DESC, id DESC
     )
     SELECT l.id::text AS billing_transaction_id, l.business_id::text AS business_id,
            l.module_key, l.plan_id, l.updated_at::text AS paid_at
     FROM latest l
     LEFT JOIN business_module_subscriptions m
            ON m.business_id = l.business_id AND m.module_key = l.module_key
     WHERE m.business_id IS NULL
        OR (m.plan_id <> l.plan_id AND m.updated_at < l.updated_at - INTERVAL '5 seconds')
     ORDER BY l.updated_at`,
  );
}

export type RejectedUpgradeCredit = {
  billing_transaction_id: string;
  business_id: string;
  module_key: string;
  plan_id: string;
  reason: string;
  shortened_days: number | null;
  paid_at: string;
};

/**
 * Completed upgrade payments whose credit was no longer available at completion (the customer paid
 * the reduced price and got a shortened period). An operator reviews each one. Read-only, last 35 days.
 */
export async function findRejectedUpgradeCredits(): Promise<RejectedUpgradeCredit[]> {
  return queryRows<RejectedUpgradeCredit>(
    `SELECT id::text AS billing_transaction_id, business_id::text AS business_id,
            COALESCE(module_key, '') AS module_key, COALESCE(plan_id, '') AS plan_id,
            metadata->'upgrade_credit'->>'rejected' AS reason,
            (metadata->'upgrade_credit'->>'shortened_days')::int AS shortened_days,
            updated_at::text AS paid_at
     FROM billing_transactions
     WHERE type = 'payment' AND status = 'completed'
       AND metadata->'upgrade_credit'->>'rejected' IS NOT NULL
       AND updated_at > CURRENT_TIMESTAMP - INTERVAL '35 days'
     ORDER BY updated_at`,
  );
}

export type RefundNeedingReview = {
  refund_id: string;
  refund_of: string;
  business_id: string;
  status: string;
  reasons: string[];
  created_at: string;
};

/**
 * Refunds a person has to look at (last 35 days): refunds flagged in their metadata (a coupon redemption that was
 * kept, a refund made in the gateway dashboard, a partner commission that could not be cancelled, a gateway failure
 * after the refund was recorded; not those an admin marked reviewed) and refunds still `pending` after an hour (the gateway has not confirmed them; repeat
 * the refund in the admin to check). Nothing is deleted or changed. Read-only.
 */
export async function findRefundsNeedingReview(): Promise<RefundNeedingReview[]> {
  return queryRows<RefundNeedingReview>(
    `SELECT id::text AS refund_id, metadata->>'refund_of' AS refund_of, business_id::text AS business_id,
            status,
            CASE WHEN status = 'pending' AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
                   THEN ARRAY['refund_pending_over_an_hour']::text[] ELSE ARRAY[]::text[] END
            || CASE WHEN metadata->>'reviewed_at' IS NULL
                    THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(metadata->'review_reasons')), ARRAY[]::text[])
                    ELSE ARRAY[]::text[] END AS reasons,
            created_at::text AS created_at
     FROM billing_transactions
     WHERE type = 'refund'
       AND created_at > CURRENT_TIMESTAMP - INTERVAL '35 days'
       AND (((metadata->>'needs_review') = 'true' AND metadata->>'reviewed_at' IS NULL)
            OR (status = 'pending' AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'))
     ORDER BY created_at`,
  );
}

/** Webhook events left in received/error for over 10 minutes (last 35 days). Read-only. */
export async function findStuckWebhookEvents(): Promise<StuckWebhookEvent[]> {
  return queryRows<StuckWebhookEvent>(
    `SELECT id::text AS id, provider, event_type, status, created_at::text AS created_at
     FROM platform_billing_webhook_events
     WHERE status IN ('received', 'error')
       AND created_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
       AND created_at > CURRENT_TIMESTAMP - INTERVAL '35 days'
     ORDER BY created_at`,
  );
}

export type IgnoredSuccessEvent = {
  id: string;
  provider: string;
  event_type: string;
  billing_transaction_id: string | null;
  processing_notes: string | null;
  created_at: string;
};

/**
 * Success events that were ignored (last 35 days): the customer paid but nothing was applied and
 * no retry will fix it, so a person has to look. Matches `payment.captured`, `payment_link.paid`
 * and Easebuzz events whose notes name an amount mismatch, a checkout type mismatch, a missing
 * checkout reference or a payment-row state error. Read-only.
 */
export async function findIgnoredSuccessEvents(): Promise<IgnoredSuccessEvent[]> {
  return queryRows<IgnoredSuccessEvent>(
    `SELECT id::text AS id, provider, event_type, billing_transaction_id::text AS billing_transaction_id,
            processing_notes, created_at::text AS created_at
     FROM platform_billing_webhook_events
     WHERE status = 'ignored'
       AND created_at > CURRENT_TIMESTAMP - INTERVAL '35 days'
       AND (event_type IN ('payment.captured', 'payment_link.paid') OR event_type LIKE 'easebuzz%')
       AND (
         processing_notes LIKE '%Amount mismatch%'
         OR processing_notes LIKE '%CHECKOUT_TYPE_MISMATCH%'
         OR processing_notes LIKE '%reference required%'
         OR processing_notes LIKE '%Cannot transition%'
         OR processing_notes LIKE '%is already %'
         OR processing_notes LIKE '%changed while moving%'
         OR processing_notes LIKE '%Checkout transaction not found%'
         OR processing_notes LIKE '%has no plan%'
         OR processing_notes LIKE '%PAYMENT_REFERENCE_ALREADY_USED%'
       )
     ORDER BY created_at`,
  );
}

export type OverLimitCouponRedemption = {
  billing_transaction_id: string;
  business_id: string;
  coupon_id: string | null;
  reason: string | null;
  paid_at: string;
};

/**
 * Paid payments whose coupon had run out, expired or been used up between checkout and payment
 * (last 35 days). The customer paid the price shown, so nothing is undone; a person decides
 * whether the coupon limit needs raising. Read-only.
 */
export async function findOverLimitCouponRedemptions(): Promise<OverLimitCouponRedemption[]> {
  return queryRows<OverLimitCouponRedemption>(
    `SELECT id::text AS billing_transaction_id, business_id::text AS business_id,
            metadata->'coupon_over_limit'->>'coupon_id' AS coupon_id,
            metadata->'coupon_over_limit'->>'reason' AS reason,
            updated_at::text AS paid_at
     FROM billing_transactions
     WHERE metadata ? 'coupon_over_limit'
       AND status = 'completed'
       AND updated_at > CURRENT_TIMESTAMP - INTERVAL '35 days'
     ORDER BY updated_at`,
  );
}

/** Alert platform admins about anomalies. Never throws and changes no data. */
export async function reportBillingAnomalies(): Promise<{
  unapplied: number;
  stuckEvents: number;
  ignoredPaid: number;
  rejectedCredits: number;
  refundsNeedingReview: number;
  overLimitCoupons: number;
}> {
  try {
    const [unapplied, stuck, ignored, rejectedCredits, refunds, overLimitCoupons] = await Promise.all([
      findUnappliedPayments(),
      findStuckWebhookEvents(),
      findIgnoredSuccessEvents(),
      findRejectedUpgradeCredits(),
      findRefundsNeedingReview(),
      findOverLimitCouponRedemptions(),
    ]);
    if (
      unapplied.length === 0 && stuck.length === 0 && ignored.length === 0 &&
      rejectedCredits.length === 0 && refunds.length === 0 && overLimitCoupons.length === 0
    ) {
      return { unapplied: 0, stuckEvents: 0, ignoredPaid: 0, rejectedCredits: 0, refundsNeedingReview: 0, overLimitCoupons: 0 };
    }

    for (const r of refunds) {
      console.error(
        `[billing-reconcile] refund needs review: refund=${r.refund_id} payment=${r.refund_of} business=${r.business_id} status=${r.status} reasons=${r.reasons.join(',')} created_at=${r.created_at}`,
      );
    }

    for (const r of overLimitCoupons) {
      console.error(
        `[billing-reconcile] coupon over its limit at payment: tx=${r.billing_transaction_id} business=${r.business_id} coupon=${r.coupon_id ?? 'n/a'} reason=${r.reason ?? 'n/a'} paid_at=${r.paid_at}`,
      );
    }

    for (const r of rejectedCredits) {
      console.error(
        `[billing-reconcile] upgrade credit rejected: tx=${r.billing_transaction_id} business=${r.business_id} module=${r.module_key} plan=${r.plan_id} reason=${r.reason} days=${r.shortened_days ?? 'n/a'} paid_at=${r.paid_at}`,
      );
    }

    for (const p of unapplied) {
      console.error(
        `[billing-reconcile] paid but not applied: tx=${p.billing_transaction_id} business=${p.business_id} module=${p.module_key} plan=${p.plan_id} paid_at=${p.paid_at}`,
      );
    }
    for (const e of stuck) {
      console.error(
        `[billing-reconcile] webhook stuck: id=${e.id} provider=${e.provider} event=${e.event_type} status=${e.status} created_at=${e.created_at}`,
      );
    }

    for (const e of ignored) {
      console.error(
        `[billing-reconcile] paid but ignored: id=${e.id} provider=${e.provider} event=${e.event_type} tx=${e.billing_transaction_id ?? 'none'} notes=${e.processing_notes ?? ''} created_at=${e.created_at}`,
      );
    }

    try {
      const { sendPlatformAdminPush } = await import('@/lib/platform-push');
      await sendPlatformAdminPush({
        event: 'incident',
        title: 'Billing: payments need attention',
        body: `${unapplied.length} paid but not applied, ${stuck.length} webhook events stuck, ${ignored.length} paid events ignored, ${rejectedCredits.length} upgrade credits rejected, ${refunds.length} refunds need review, ${overLimitCoupons.length} coupon redemptions over their limit`,
        url: '/admin/billing',
      });
    } catch (err) {
      console.warn('[billing-reconcile] admin push failed', err instanceof Error ? err.message : err);
    }
    return {
      unapplied: unapplied.length,
      stuckEvents: stuck.length,
      ignoredPaid: ignored.length,
      rejectedCredits: rejectedCredits.length,
      refundsNeedingReview: refunds.length,
      overLimitCoupons: overLimitCoupons.length,
    };
  } catch (err) {
    console.error('[billing-reconcile] check failed', err);
    return { unapplied: 0, stuckEvents: 0, ignoredPaid: 0, rejectedCredits: 0, refundsNeedingReview: 0, overLimitCoupons: 0 };
  }
}
