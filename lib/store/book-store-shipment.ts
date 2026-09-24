import { query, queryOne } from '@/lib/db';
import { resolveDeliveryProvider } from '@/lib/store/delivery';
import { notifyStoreCustomerWhatsApp } from '@/lib/store/notify-whatsapp';

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

export async function bookStoreCourierIfNeeded(orderId: string, businessId: string): Promise<void> {
  const ship = await queryOne<{
    order_number: string;
    grand_total: string;
    payment_status: string;
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    customer_address: string | null;
    customer_pincode: string | null;
    delivery_mode: string;
    shipment_id: string | null;
    dispatch_mode: string | null;
  }>(
    `SELECT order_number, grand_total::text, payment_status, customer_name, customer_phone,
            customer_email, customer_address, customer_pincode, delivery_mode, shipment_id,
            dispatch_mode
     FROM store_orders WHERE id = $1 AND business_id = $2`,
    [orderId, businessId],
  );
  if (!ship) return;
  if (ship.delivery_mode !== 'delivery') return;
  if (ship.dispatch_mode === 'self' || ship.dispatch_mode === 'pickup') return;
  if (ship.shipment_id && ship.shipment_id !== 'self') return;

  const provider = await resolveDeliveryProvider(businessId);
  const wantsCourier = ship.dispatch_mode === 'shiprocket' || (!ship.dispatch_mode && provider.id === 'shiprocket');
  if (!wantsCourier || provider.id !== 'shiprocket') return;

  try {
    const booked = await provider.createShipment({
      orderId,
      orderNumber: ship.order_number,
      grandTotal: parseFloat(ship.grand_total) || 0,
      paymentStatus: ship.payment_status as 'unpaid' | 'paid' | 'cod',
      customerName: ship.customer_name,
      customerPhone: ship.customer_phone,
      customerEmail: ship.customer_email,
      customerAddress: ship.customer_address || '',
      customerPincode: ship.customer_pincode || '',
    });
    if (!booked.ok) return;

    await query(
      `UPDATE store_orders
       SET shipment_id = $1, awb = $2, tracking_url = $3, delivery_provider = $4,
           billed_delivery_fee = COALESCE($5, billed_delivery_fee),
           dispatch_mode = 'shiprocket',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        booked.shipmentId ?? null,
        booked.awb ?? null,
        booked.trackingUrl ?? null,
        provider.id,
        booked.billedFee ?? null,
        orderId,
      ],
    );
    if (booked.trackingUrl) {
      void notifyStoreCustomerWhatsApp({
        businessId,
        phone: ship.customer_phone,
        text: `Your order ${ship.order_number} is ready to ship.${booked.awb ? ` AWB ${booked.awb}.` : ''} Track: ${booked.trackingUrl}`,
      });
    }
  } catch (err) {
    console.error('[store shipment]', err);
  }
}
