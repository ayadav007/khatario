import { query, queryOne } from '@/lib/db';
import { storePhoneDigits } from '@/lib/store/store-phone';
import type { TenantWaEventKey } from '@/lib/whatsapp/tenant-events';

/**
 * Customer-facing events that also go to the customer's phone app, with the page of the store
 * account that the tap opens. Merchant-facing keys are deliberately absent: those reach the
 * business audience through the notifications table, never a customer device.
 */
export const CUSTOMER_PUSH_EVENTS: Partial<Record<TenantWaEventKey, { title: string; href: string }>> = {
  store_order_placed: { title: 'Order received', href: '/account' },
  store_order_paid: { title: 'Payment received', href: '/account' },
  store_order_shipped: { title: 'Order shipped', href: '/account' },
  order_confirmed: { title: 'Order confirmed', href: '/account' },
  order_packed: { title: 'Order packed', href: '/account' },
  order_ready_for_pickup: { title: 'Ready for pickup', href: '/account' },
  order_shipped: { title: 'Order shipped', href: '/account' },
  order_out_for_delivery: { title: 'Out for delivery', href: '/account' },
  order_delivered: { title: 'Order delivered', href: '/account' },
  order_delivery_failed: { title: 'Delivery attempt failed', href: '/account' },
  order_delayed: { title: 'Order delayed', href: '/account' },
  order_cancelled: { title: 'Order cancelled', href: '/account' },
  payment_due_reminder: { title: 'Payment reminder', href: '/account' },
  payment_overdue_reminder: { title: 'Payment overdue', href: '/account' },
  khata_opened: { title: 'Khata opened for you', href: '/khata' },
  khata_order_placed: { title: 'Added to your khata', href: '/khata' },
  khata_order_waiting: { title: 'Khata order waiting', href: '/khata' },
  khata_order_rejected: { title: 'Khata order not accepted', href: '/khata' },
  khata_statement: { title: 'Your khata statement', href: '/khata' },
  khata_overdue: { title: 'Khata payment overdue', href: '/khata' },
};

export function isCustomerPushEvent(eventKey: string): eventKey is TenantWaEventKey {
  return Object.prototype.hasOwnProperty.call(CUSTOMER_PUSH_EVENTS, eventKey);
}

/**
 * Queues one push job for the store customer of `businessId` whose phone matches `phone`, if that
 * customer has a device registered for this shop. The lookup is by (shop, phone), so a customer of
 * another shop with the same number is never reached, and a business user with that number is not
 * a store customer at all. Best effort: failures are logged and never thrown.
 */
export async function enqueueCustomerPush(input: {
  businessId: string;
  phone: string;
  eventKey: TenantWaEventKey;
  body: string;
  title?: string;
  href?: string;
}): Promise<{ queued: boolean; reason?: string }> {
  const spec = CUSTOMER_PUSH_EVENTS[input.eventKey];
  if (!spec) return { queued: false, reason: 'not_customer_event' };
  const digits = storePhoneDigits(input.phone);
  if (!digits) return { queued: false, reason: 'no_phone' };
  try {
    const customer = await queryOne<{ id: string }>(
      `SELECT c.id
         FROM store_customers c
        WHERE c.business_id = $1
          AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right($2, 10)
          AND EXISTS (
            SELECT 1 FROM push_devices d
             WHERE d.audience = 'customer' AND d.customer_id = c.id AND d.business_id = c.business_id AND d.revoked_at IS NULL
          )
        ORDER BY c.created_at DESC NULLS LAST
        LIMIT 1`,
      [input.businessId, digits],
    );
    if (!customer) return { queued: false, reason: 'no_device' };
    await query(
      `INSERT INTO push_jobs (kind, audience, business_id, customer_id, title, body, data)
       VALUES ('customer', 'customer', $1, $2, $3, $4, $5::jsonb)`,
      [
        input.businessId,
        customer.id,
        (input.title || spec.title).slice(0, 255),
        input.body,
        JSON.stringify({ event: input.eventKey, href: input.href || spec.href }),
      ],
    );
    await query(`SELECT pg_notify('push_jobs', '')`).catch(() => undefined);
    return { queued: true };
  } catch (err) {
    console.error(`[push] customer job for ${input.eventKey} not queued:`, err instanceof Error ? err.message : err);
    return { queued: false, reason: 'error' };
  }
}
