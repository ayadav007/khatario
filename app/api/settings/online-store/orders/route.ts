import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { resolveDeliveryProvider } from '@/lib/store/delivery';
import { canBookShipment } from '@/lib/store/fulfillment-rules';
import { createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/online-store/orders?business_id=...&status=...&page=1
 * List store orders for admin.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const status = searchParams.get('status');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  const conditions = ['so.business_id = $1'];
  const params: unknown[] = [businessId];
  let idx = 1;

  if (status) {
    idx++;
    conditions.push(`so.status = $${idx}`);
    params.push(status);
  }

  idx++;
  params.push(limit);
  const limitIdx = idx;
  idx++;
  params.push(offset);
  const offsetIdx = idx;

  const orders = await queryRows<Record<string, unknown>>(
    `SELECT
       so.id, so.order_number, so.customer_name, so.customer_phone,
       so.customer_email, so.customer_address, so.customer_pincode,
       so.delivery_mode, so.status, so.notes, so.payment_status,
       so.subtotal::text, so.tax_total::text, so.delivery_charge::text, so.grand_total::text,
       so.cancelled_reason, so.created_at, so.awb, so.tracking_url, so.shipment_id,
       so.invoice_id,
       br.name AS branch_name
     FROM store_orders so
     LEFT JOIN branches br ON br.id = so.branch_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY so.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM store_orders so WHERE ${conditions.slice(0, status ? 2 : 1).join(' AND ')}`,
    params.slice(0, status ? 2 : 1),
  );

  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      subtotal: parseFloat(o.subtotal as string) || 0,
      tax_total: parseFloat(o.tax_total as string) || 0,
      delivery_charge: parseFloat(o.delivery_charge as string) || 0,
      grand_total: parseFloat(o.grand_total as string) || 0,
    })),
    total: parseInt(countRow?.count ?? '0', 10),
    page,
    limit,
  });
}

/**
 * PATCH /api/settings/online-store/orders
 * Update order status.
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const { order_id, status, cancelled_reason } = body;

  if (!order_id) {
    return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
  }

  const validStatuses = ['pending', 'confirmed', 'ready', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  // If cancelling, restore stock (only when it was actually reserved)
  if (status === 'cancelled') {
    const current = await queryOne<{ payment_status: string; shipment_id: string | null }>(
      `SELECT payment_status, shipment_id FROM store_orders WHERE id = $1 AND business_id = $2`,
      [order_id, businessId],
    );
    if (current?.shipment_id && current.shipment_id !== 'self') {
      try {
        const provider = await resolveDeliveryProvider(businessId);
        await provider.cancelShipment?.(current.shipment_id);
      } catch (err) {
        console.error('[store cancel shipment]', err);
      }
    }
    if (current && current.payment_status !== 'unpaid') {
      const items = await queryRows<{
        item_id: string;
        variant_id: string | null;
        quantity: string;
      }>(
        `SELECT soi.item_id, soi.variant_id, soi.quantity::text
         FROM store_order_items soi
         INNER JOIN store_orders so ON so.id = soi.order_id
         WHERE soi.order_id = $1 AND so.business_id = $2 AND so.status != 'cancelled'`,
        [order_id, businessId],
      );

      for (const item of items) {
        const qty = parseFloat(item.quantity);
        if (item.variant_id) {
          await query(
            `UPDATE item_variants SET current_stock = current_stock + $1 WHERE id = $2`,
            [qty, item.variant_id],
          );
        } else {
          await query(
            `UPDATE items SET current_stock = current_stock + $1 WHERE id = $2 AND business_id = $3`,
            [qty, item.item_id, businessId],
          );
        }
      }
    }
  }

  if (status === 'ready') {
    const payRow = await queryOne<{ payment_status: string }>(
      `SELECT payment_status FROM store_orders WHERE id = $1 AND business_id = $2`,
      [order_id, businessId],
    );
    if (payRow && !canBookShipment(payRow.payment_status)) {
      return NextResponse.json(
        { error: 'Cannot ship until payment is received' },
        { status: 409 },
      );
    }
  }

  const updated = await queryOne(
    `UPDATE store_orders
     SET status = $1, cancelled_reason = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 AND business_id = $4
     RETURNING id, status`,
    [status, cancelled_reason ?? null, order_id, businessId],
  );

  if (!updated) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  if (status === 'confirmed') {
    await createInvoiceForStoreOrder(order_id, businessId).catch((err) => {
      console.error('[store invoice on confirm]', err);
    });
  }

  if (status === 'ready') {
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
    }>(
      `SELECT order_number, grand_total::text, payment_status, customer_name, customer_phone,
              customer_email, customer_address, customer_pincode, delivery_mode, shipment_id
       FROM store_orders WHERE id = $1 AND business_id = $2`,
      [order_id, businessId],
    );
    if (ship && ship.delivery_mode === 'delivery' && !ship.shipment_id) {
      try {
        const provider = await resolveDeliveryProvider(businessId);
        const booked = await provider.createShipment({
          orderId: order_id,
          orderNumber: ship.order_number,
          grandTotal: parseFloat(ship.grand_total) || 0,
          paymentStatus: ship.payment_status as 'unpaid' | 'paid' | 'cod',
          customerName: ship.customer_name,
          customerPhone: ship.customer_phone,
          customerEmail: ship.customer_email,
          customerAddress: ship.customer_address || '',
          customerPincode: ship.customer_pincode || '',
        });
        if (booked.ok) {
          await query(
            `UPDATE store_orders
             SET shipment_id = $1, awb = $2, tracking_url = $3, delivery_provider = $4,
                 billed_delivery_fee = COALESCE($5, billed_delivery_fee),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [
              booked.shipmentId ?? null,
              booked.awb ?? null,
              booked.trackingUrl ?? null,
              provider.id,
              booked.billedFee ?? null,
              order_id,
            ],
          );
          if (booked.trackingUrl) {
            const { notifyStoreCustomerWhatsApp } = await import('@/lib/store/notify-whatsapp');
            void notifyStoreCustomerWhatsApp({
              businessId,
              phone: ship.customer_phone,
              text: `Your order ${ship.order_number} is ready to ship.${booked.awb ? ` AWB ${booked.awb}.` : ''} Track: ${booked.trackingUrl}`,
            });
          }
        }
      } catch (err) {
        console.error('[store shipment]', err);
      }
    }
  }

  return NextResponse.json({ success: true });
}
