import { queryOne, queryRows } from '@/lib/db';
import { findCourier } from './couriers';
import { loadOrderLines, type OrderLine } from './hub';
import type { FulfilmentMethod, FulfilmentStatus } from './rules';

export interface PublicTracking {
  shop: { name: string; phone: string | null; city: string | null; logoUrl: string | null };
  buyerFirstName: string | null;
  orderNumber: string;
  amount: number;
  paid: boolean;
  items: OrderLine[];
  status: FulfilmentStatus;
  method: FulfilmentMethod | null;
  partnerName: string | null;
  awb: string | null;
  trackingUrl: string | null;
  /** The courier page opens empty; the buyer has to type the AWB. */
  trackingNeedsAwb: boolean;
  riderName: string | null;
  riderPhone: string | null;
  pickupCode: string | null;
  codDue: number;
  failureReason: string | null;
  events: Array<{ status: string; note: string | null; created_at: string }>;
}

export function isPublicTrackingToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{20,48}$/.test(token);
}

/**
 * Everything the buyer may see for one shipment, looked up by its random token only. No other
 * order, no full name, no address, and no staff notes leave this function.
 */
export async function loadPublicTracking(token: string): Promise<PublicTracking | null> {
  if (!isPublicTrackingToken(token)) return null;
  const f = await queryOne<{
    id: string;
    business_id: string;
    store_order_id: string | null;
    sales_order_id: string | null;
    invoice_id: string | null;
    buyer_name: string | null;
    status: FulfilmentStatus;
    method: FulfilmentMethod | null;
    partner_name: string | null;
    awb: string | null;
    tracking_url: string | null;
    rider_name: string | null;
    rider_phone: string | null;
    pickup_code: string | null;
    cod_amount: string;
    cod_collected_at: string | null;
    failure_reason: string | null;
    shop_name: string;
    shop_phone: string | null;
    shop_city: string | null;
    logo_url: string | null;
    order_number: string | null;
    amount: string | null;
    paid: boolean | null;
  }>(
    `SELECT f.id, f.business_id, f.store_order_id, f.sales_order_id, f.invoice_id, f.buyer_name, f.status, f.method,
            f.partner_name, f.awb, f.tracking_url, f.rider_name, f.rider_phone, f.pickup_code,
            f.cod_amount::text, f.cod_collected_at, f.failure_reason,
            b.name AS shop_name, b.phone AS shop_phone, b.city AS shop_city, b.logo_url,
            COALESCE(so.order_number, s.order_number, i.invoice_number) AS order_number,
            COALESCE(so.grand_total, s.grand_total, i.grand_total)::text AS amount,
            COALESCE(so.payment_status IN ('paid') OR so.cash_collected_at IS NOT NULL,
                     s.payment_status = 'paid' OR si.payment_status = 'paid',
                     i.payment_status = 'paid') AS paid
       FROM order_fulfilments f
       JOIN businesses b ON b.id = f.business_id
       LEFT JOIN store_orders so ON so.id = f.store_order_id AND so.business_id = f.business_id
       LEFT JOIN sales_orders s ON s.id = f.sales_order_id AND s.business_id = f.business_id
       LEFT JOIN invoices si ON si.id = s.converted_invoice_id
       LEFT JOIN invoices i ON i.id = f.invoice_id AND i.business_id = f.business_id
      WHERE f.public_token = $1`,
    [token],
  );
  if (!f) return null;

  const source = f.store_order_id
    ? { type: 'store_order' as const, id: f.store_order_id }
    : f.sales_order_id
      ? { type: 'sales_order' as const, id: f.sales_order_id }
      : { type: 'invoice' as const, id: f.invoice_id! };
  const [items, events] = await Promise.all([
    loadOrderLines(f.business_id, source.type, source.id),
    queryRows<{ status: string; note: string | null; created_at: string }>(
      `SELECT status, CASE WHEN status = 'delivery_failed' THEN note END AS note, created_at
         FROM order_fulfilment_events
        WHERE fulfilment_id = $1 AND business_id = $2
        ORDER BY created_at, id`,
      [f.id, f.business_id],
    ),
  ]);

  const courier = findCourier(f.partner_name);
  const live = f.status === 'shipped' || f.status === 'out_for_delivery' || f.status === 'delivery_failed';
  const cod = Number(f.cod_amount) || 0;
  return {
    shop: { name: f.shop_name, phone: f.shop_phone, city: f.shop_city, logoUrl: f.logo_url },
    buyerFirstName: (f.buyer_name ?? '').trim().split(/\s+/)[0] || null,
    orderNumber: f.order_number ?? '',
    amount: Number(f.amount) || 0,
    paid: Boolean(f.paid),
    items,
    status: f.status,
    method: f.method,
    partnerName: f.partner_name,
    awb: f.awb,
    trackingUrl: f.tracking_url,
    trackingNeedsAwb: Boolean(courier && !courier.deepLink && f.awb),
    riderName: live ? f.rider_name : null,
    riderPhone: live ? f.rider_phone : null,
    pickupCode: f.status === 'ready_for_pickup' || f.status === 'packed' || f.status === 'confirmed' ? f.pickup_code : null,
    codDue: cod > 0 && !f.cod_collected_at ? cod : 0,
    failureReason: f.status === 'delivery_failed' ? f.failure_reason : null,
    events,
  };
}
