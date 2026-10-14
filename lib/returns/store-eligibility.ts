import type { PoolClient } from 'pg';

/**
 * Whether a store buyer may ask for a return on their own order: the order is theirs, delivered,
 * billed, and within the shop's return window (business_settings.store_return_window_days, 0 = off).
 */
export type StoreReturnEligibility =
  | { ok: true; invoiceId: string; fulfilmentId: string | null; windowDays: number; deliveredAt: string | null }
  | { ok: false; status: number; error: string };

export async function storeReturnEligibility(
  client: Pick<PoolClient, 'query'>,
  p: { businessId: string; storeCustomerId: string; orderId: string },
): Promise<StoreReturnEligibility> {
  const res = await client.query<{
    status: string;
    invoice_id: string | null;
    invoice_status: string | null;
    fulfilment_id: string | null;
    delivery_status: string | null;
    delivered_at: string | null;
    updated_at: string;
    window_days: number | null;
  }>(
    `SELECT so.status, so.invoice_id, i.status AS invoice_status,
            f.id AS fulfilment_id, f.status AS delivery_status, f.delivered_at, so.updated_at,
            (SELECT bs.store_return_window_days FROM business_settings bs WHERE bs.business_id = so.business_id) AS window_days
       FROM store_orders so
       LEFT JOIN invoices i ON i.id = so.invoice_id AND i.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT x.id, x.status, x.delivered_at FROM order_fulfilments x
          WHERE x.store_order_id = so.id ORDER BY x.seq DESC LIMIT 1
       ) f ON TRUE
      WHERE so.id = $1 AND so.business_id = $2 AND so.store_customer_id = $3`,
    [p.orderId, p.businessId, p.storeCustomerId],
  );
  const o = res.rows[0];
  if (!o) return { ok: false, status: 404, error: 'Order not found' };
  const windowDays = o.window_days ?? 7;
  if (windowDays <= 0) return { ok: false, status: 409, error: 'This shop does not accept returns online. Please contact the shop.' };
  const delivered = o.status === 'delivered' || o.delivery_status === 'delivered';
  if (!delivered) return { ok: false, status: 409, error: 'You can ask for a return once the order is delivered' };
  if (!o.invoice_id || o.invoice_status !== 'final') {
    return { ok: false, status: 409, error: 'This order cannot be returned online. Please contact the shop.' };
  }
  const deliveredAt = o.delivered_at ?? o.updated_at;
  const ageDays = (Date.now() - new Date(deliveredAt).getTime()) / 86_400_000;
  if (ageDays > windowDays) {
    return { ok: false, status: 409, error: `Returns are accepted within ${windowDays} days of delivery` };
  }
  return { ok: true, invoiceId: o.invoice_id, fulfilmentId: o.fulfilment_id, windowDays, deliveredAt };
}
