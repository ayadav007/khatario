/**
 * What the server says about one checkout payment, for the screen the customer returns to after the
 * payment page. The answer comes from the billing row only (never from the return URL): the plan is
 * active only when the row is `completed`, which is written in the same transaction that activates it.
 */
import * as db from '@/lib/db';
import { PLATFORM_LINK_EXPIRY_MS } from '@/lib/platform-billing';
import { WHATSAPP_ADDON_LABELS, isWhatsAppAddonType } from '@/lib/platform-addon-checkout';

export type CheckoutStatus = 'pending' | 'completed' | 'failed' | 'expired' | 'refunded';

export type CheckoutStatusResult = {
  status: CheckoutStatus;
  kind: 'subscription' | 'addon';
  /** The plan's display name (never its id). */
  plan_name: string | null;
  /** For an add-on checkout: its display name. */
  addon_label: string | null;
  /** Set only when a stale upgrade credit shortened the period: the days this payment bought. */
  shortened_days: number | null;
  /** The last day of the paid period, as the server stored it (YYYY-MM-DD), once completed. */
  period_end: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  status: string;
  expired: boolean;
  plan_name: string | null;
  checkout_type: string | null;
  addon_type: string | null;
  shortened_days: number | null;
  period_end: string | null;
};

/** Pure: the row's stored status, plus "a pending link older than its expiry is expired". */
export function checkoutStatusFromRow(row: Row): CheckoutStatusResult {
  const status: CheckoutStatus =
    row.status === 'completed'
      ? 'completed'
      : row.status === 'refunded'
        ? 'refunded'
        : row.status === 'failed'
          ? 'failed'
          : row.expired
            ? 'expired'
            : 'pending';
  const isAddon = row.checkout_type === 'whatsapp_addon';
  return {
    status,
    kind: isAddon ? 'addon' : 'subscription',
    plan_name: row.plan_name,
    addon_label: isAddon && isWhatsAppAddonType(row.addon_type) ? WHATSAPP_ADDON_LABELS[row.addon_type] : null,
    shortened_days: status === 'completed' && row.shortened_days ? Number(row.shortened_days) : null,
    period_end: status === 'completed' ? row.period_end : null,
  };
}

/**
 * The checkout payment `txId` of this business, or null (not a payment id, another business's, or not a
 * checkout payment: all look the same to the caller, so the route answers 404 for each).
 */
export async function loadCheckoutStatus(txId: string, businessId: string): Promise<CheckoutStatusResult | null> {
  if (!UUID.test(txId)) return null;
  const row = await db.queryOne<Row>(
    `SELECT bt.status,
            (bt.created_at < now() - ($3::bigint * interval '1 millisecond')) AS expired,
            sp.display_name AS plan_name,
            bt.gateway_response->>'checkout_type' AS checkout_type,
            bt.gateway_response->>'addon_type' AS addon_type,
            NULLIF(bt.metadata->'upgrade_credit'->>'shortened_days', '')::int AS shortened_days,
            bt.period_end::text AS period_end
       FROM billing_transactions bt
       LEFT JOIN subscription_plans sp ON sp.id = bt.plan_id
      WHERE bt.id = $1 AND bt.business_id = $2 AND bt.type = 'payment'`,
    [txId, businessId, PLATFORM_LINK_EXPIRY_MS],
  );
  return row ? checkoutStatusFromRow(row) : null;
}
