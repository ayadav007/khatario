import { query, queryOne } from '@/lib/db';
import { bookFulfilmentWithShiprocket } from '@/lib/fulfilment/shiprocket-booking';
import { getStoreDeliveryProviderId } from '@/lib/store/delivery';
import { notifyStoreEvent } from '@/lib/store/notify-whatsapp';
import { syncStoreFulfilment } from '@/lib/store/order-lifecycle';

export async function markSelfDispatch(orderId: string, businessId: string): Promise<void> {
  await query(
    `UPDATE store_orders
     SET dispatch_mode = 'self',
         shipment_id = COALESCE(NULLIF(shipment_id, ''), 'self'),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2`,
    [orderId, businessId],
  );
}

export type StoreCourierBooking = { attempted: boolean; error: string | null; warning?: string | null };

/**
 * Books Shiprocket for a store order marked ready for delivery, through the order's first parcel
 * so the Orders screen and the store screen share one booking. Returns the reason when it fails;
 * the order stays ready and can be booked again.
 */
export async function bookStoreCourierIfNeeded(
  orderId: string,
  businessId: string,
  actorUserId: string | null = null,
): Promise<StoreCourierBooking> {
  const ship = await queryOne<{
    order_number: string;
    grand_total: string;
    customer_name: string;
    customer_phone: string;
    delivery_mode: string;
    awb: string | null;
    dispatch_mode: string | null;
    store_name: string | null;
  }>(
    `SELECT o.order_number, o.grand_total::text, o.customer_name, o.customer_phone,
            o.delivery_mode, o.awb, o.dispatch_mode, b.name AS store_name
     FROM store_orders o
     JOIN businesses b ON b.id = o.business_id
     WHERE o.id = $1 AND o.business_id = $2`,
    [orderId, businessId],
  );
  const skip: StoreCourierBooking = { attempted: false, error: null };
  if (!ship) return skip;
  if (ship.delivery_mode !== 'delivery') return skip;
  if (ship.dispatch_mode === 'self' || ship.dispatch_mode === 'pickup') return skip;
  if (ship.awb) return skip;

  const providerId = await getStoreDeliveryProviderId(businessId);
  const wantsCourier = ship.dispatch_mode === 'shiprocket' || (!ship.dispatch_mode && providerId === 'shiprocket');
  if (!wantsCourier) return skip;

  try {
    let fulfilmentId = await firstStoreFulfilmentId(businessId, orderId);
    if (!fulfilmentId) {
      await syncStoreFulfilment(businessId, orderId, actorUserId);
      fulfilmentId = await firstStoreFulfilmentId(businessId, orderId);
    }
    if (!fulfilmentId) return { attempted: true, error: 'Delivery record could not be created' };

    const booked = await bookFulfilmentWithShiprocket(businessId, fulfilmentId, { actorUserId });
    if (!booked.ok) return { attempted: true, error: booked.error };

    void notifyStoreEvent({
      businessId,
      eventKey: 'store_order_shipped',
      phone: ship.customer_phone,
      values: {
        customer_name: ship.customer_name,
        order_number: ship.order_number,
        store_name: ship.store_name ?? '',
        total: (parseFloat(ship.grand_total) || 0).toLocaleString('en-IN'),
        awb: booked.awb,
        tracking_url: booked.trackingUrl,
      },
      text: `Your order ${ship.order_number} is ready to ship. AWB ${booked.awb}. Track: ${booked.trackingUrl}`,
    });
    return { attempted: true, error: null, warning: booked.warning ?? null };
  } catch (err) {
    console.error('[store shipment]', err);
    return { attempted: true, error: err instanceof Error ? err.message : 'Courier booking failed' };
  }
}

async function firstStoreFulfilmentId(businessId: string, orderId: string): Promise<string | null> {
  const r = await queryOne<{ id: string }>(
    `SELECT id FROM order_fulfilments WHERE business_id = $1 AND store_order_id = $2 ORDER BY seq LIMIT 1`,
    [businessId, orderId],
  );
  return r?.id ?? null;
}
