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
       SELECT bt.id, bt.business_id, bt.plan_id, bt.updated_at,
              COALESCE(bt.module_key,
                       CASE sp.product_line WHEN 'hr' THEN 'hr' WHEN 'connect' THEN 'connect' ELSE 'billing' END
              ) AS module_key
       FROM billing_transactions bt
       LEFT JOIN subscription_plans sp ON sp.id = bt.plan_id
       WHERE bt.type = 'payment'
         AND bt.status = 'completed'
         AND bt.total_amount > 0
         AND bt.plan_id IS NOT NULL
         AND bt.updated_at > CURRENT_TIMESTAMP - INTERVAL '35 days'
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

/** Alert platform admins about anomalies. Never throws and changes no data. */
export async function reportBillingAnomalies(): Promise<{ unapplied: number; stuckEvents: number }> {
  try {
    const [unapplied, stuck] = await Promise.all([findUnappliedPayments(), findStuckWebhookEvents()]);
    if (unapplied.length === 0 && stuck.length === 0) return { unapplied: 0, stuckEvents: 0 };

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

    try {
      const { sendPlatformAdminPush } = await import('@/lib/platform-push');
      await sendPlatformAdminPush({
        event: 'incident',
        title: 'Billing: payments need attention',
        body: `${unapplied.length} paid but not applied, ${stuck.length} webhook events stuck`,
        url: '/admin/billing',
      });
    } catch (err) {
      console.warn('[billing-reconcile] admin push failed', err instanceof Error ? err.message : err);
    }
    return { unapplied: unapplied.length, stuckEvents: stuck.length };
  } catch (err) {
    console.error('[billing-reconcile] check failed', err);
    return { unapplied: 0, stuckEvents: 0 };
  }
}
