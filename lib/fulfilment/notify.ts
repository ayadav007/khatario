import { query, queryOne } from '@/lib/db';
import { orderTrackingUrl, publicInvoiceUrl } from '@/lib/customer-surface/urls';
import type { TenantWaEventKey } from '@/lib/whatsapp/tenant-events';
import { loadOrderUpdateSettings } from './hub';
import type { FulfilmentStatus } from './rules';
import type { NotifyStatus } from './update-settings';

const EVENT_FOR: Partial<Record<FulfilmentStatus, TenantWaEventKey>> = {
  confirmed: 'order_confirmed',
  packed: 'order_packed',
  ready_for_pickup: 'order_ready_for_pickup',
  shipped: 'order_shipped',
  out_for_delivery: 'order_out_for_delivery',
  delivered: 'order_delivered',
  delivery_failed: 'order_delivery_failed',
  cancelled: 'order_cancelled',
};

interface NotifyRow {
  id: string;
  business_id: string;
  channel: string;
  status: FulfilmentStatus;
  method: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  partner_name: string | null;
  awb: string | null;
  tracking_url: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_code: string | null;
  failure_reason: string | null;
  public_token: string;
  invoice_id: string | null;
  notified_statuses: string[];
  business_name: string;
  shop_address: string | null;
  order_number: string | null;
  amount: string | null;
  paid: boolean | null;
}

const money = (n: number) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** The online store already sends "placed/paid" and the Shiprocket "shipped" message itself. */
export function storeAlreadyNotifies(channel: string, status: FulfilmentStatus, method: string | null): boolean {
  if (channel !== 'online_store') return false;
  return status === 'confirmed' || (status === 'shipped' && method === 'shiprocket');
}

export function buildFulfilmentMessage(
  row: Pick<
    NotifyRow,
    | 'status' | 'buyer_name' | 'partner_name' | 'awb' | 'tracking_url' | 'rider_name' | 'rider_phone'
    | 'pickup_code' | 'failure_reason' | 'business_name' | 'shop_address'
  > & { orderNumber: string; orderLink: string; billLink: string | null; refundNote: string },
): string {
  const hi = row.buyer_name ? `Hi ${row.buyer_name.trim().split(/\s+/)[0]}, your` : 'Your';
  const n = row.orderNumber;
  switch (row.status) {
    case 'confirmed':
      return `${hi} order ${n} with ${row.business_name} is confirmed. Follow it here: ${row.orderLink}`;
    case 'packed':
      return `${hi} order ${n} is packed and will leave soon. Follow it here: ${row.orderLink}`;
    case 'ready_for_pickup':
      return `${hi} order ${n} is ready to collect${row.shop_address ? ` from ${row.shop_address}` : ''}.${
        row.pickup_code ? ` Show pickup code ${row.pickup_code} at the counter.` : ''
      }`;
    case 'shipped': {
      const via = [row.partner_name, row.awb ? `tracking no. ${row.awb}` : null].filter(Boolean).join(', ');
      return `${hi} order ${n} is on its way${via ? ` (${via})` : ''}. Track it here: ${row.orderLink}`;
    }
    case 'out_for_delivery': {
      const rider = [row.rider_name, row.rider_phone].filter(Boolean).join(' ');
      return `${hi} order ${n} is out for delivery today.${rider ? ` Delivery partner: ${rider}.` : ''} Track: ${row.orderLink}`;
    }
    case 'delivered':
      return `${hi} order ${n} has been delivered.${row.billLink ? ` Your bill: ${row.billLink}` : ''} Thank you for shopping with ${row.business_name}.`;
    case 'delivery_failed':
      return `${hi} order ${n} could not be delivered${row.failure_reason ? `: ${row.failure_reason}` : ''}. Reply here to reschedule. ${row.orderLink}`;
    case 'cancelled':
      return `${hi} order ${n} with ${row.business_name} has been cancelled. ${row.refundNote}`.trim();
    default:
      return '';
  }
}

/**
 * Sends the buyer one WhatsApp update for the fulfilment's current status, at most once per status
 * (claimed in `notified_statuses` before sending), when the merchant has that update switched on.
 */
export async function notifyFulfilmentStatus(businessId: string, fulfilmentId: string): Promise<'sent' | 'skipped'> {
  const row = await queryOne<NotifyRow>(
    `SELECT f.id, f.business_id, f.channel, f.status, f.method, f.buyer_name, f.buyer_phone, f.partner_name, f.awb,
            f.tracking_url, f.rider_name, f.rider_phone, f.pickup_code, f.failure_reason, f.public_token,
            f.invoice_id, f.notified_statuses,
            b.name AS business_name,
            NULLIF(concat_ws(', ', NULLIF(b.address_line1, ''), NULLIF(b.city, '')), '') AS shop_address,
            COALESCE(so.order_number, s.order_number, i.invoice_number) AS order_number,
            COALESCE(so.grand_total, s.grand_total, i.grand_total)::text AS amount,
            COALESCE(so.payment_status = 'paid', FALSE) OR COALESCE(s.payment_status = 'paid', FALSE)
              OR COALESCE(i.payment_status = 'paid', FALSE) AS paid
       FROM order_fulfilments f
       JOIN businesses b ON b.id = f.business_id
       LEFT JOIN store_orders so ON so.id = f.store_order_id AND so.business_id = f.business_id
       LEFT JOIN sales_orders s ON s.id = f.sales_order_id AND s.business_id = f.business_id
       LEFT JOIN invoices i ON i.id = COALESCE(f.invoice_id, s.converted_invoice_id) AND i.business_id = f.business_id
      WHERE f.id = $1 AND f.business_id = $2`,
    [fulfilmentId, businessId],
  );
  if (!row || !row.buyer_phone) return 'skipped';
  const eventKey = EVENT_FOR[row.status];
  if (!eventKey || row.notified_statuses.includes(row.status)) return 'skipped';

  const settings = await loadOrderUpdateSettings(businessId);
  const enabled = settings.notify[row.status as NotifyStatus] && !storeAlreadyNotifies(row.channel, row.status, row.method);

  const claimed = await query(
    `UPDATE order_fulfilments SET notified_statuses = array_append(notified_statuses, $3::text)
      WHERE id = $1 AND business_id = $2 AND status = $3 AND NOT ($3::text = ANY(notified_statuses))`,
    [row.id, businessId, row.status],
  );
  if (claimed.rowCount !== 1 || !enabled) return 'skipped';

  let billLink: string | null = null;
  if (row.status === 'delivered' && row.invoice_id) {
    const { ensureInvoicePublicToken } = await import('@/lib/customer-surface/public-token');
    billLink = await ensureInvoicePublicToken(row.invoice_id).then(publicInvoiceUrl).catch(() => null);
  }
  const orderLink = orderTrackingUrl(row.public_token);
  const orderNumber = row.order_number ?? '';
  const amount = Number(row.amount) || 0;
  const refundNote =
    row.status === 'cancelled' && row.paid
      ? `Your refund of ₹${money(amount)} will reach you in 5-7 working days.`
      : '';

  const text = buildFulfilmentMessage({ ...row, orderNumber, orderLink, billLink, refundNote });
  const { notifyBusinessEvent } = await import('@/lib/whatsapp/tenant-send');
  const res = await notifyBusinessEvent({
    businessId,
    eventKey,
    to: row.buyer_phone,
    values: {
      customer_name: (row.buyer_name ?? '').trim().split(/\s+/)[0] || 'there',
      order_number: orderNumber,
      business_name: row.business_name,
      total: money(amount),
      order_link: orderLink,
      courier: row.partner_name ?? 'our delivery partner',
      awb: row.awb ?? '-',
      tracking_url: row.tracking_url ?? orderLink,
      rider_name: row.rider_name ?? 'our rider',
      rider_phone: row.rider_phone ?? '',
      pickup_code: row.pickup_code ?? '-',
      shop_address: row.shop_address ?? row.business_name,
      reason: row.failure_reason ?? 'we could not reach you',
      invoice_link: billLink ?? orderLink,
      refund_note: refundNote || 'Reply here if you have any questions.',
    },
    fallbackText: text,
  });
  if (!res.via) {
    await query(
      `UPDATE order_fulfilments SET notified_statuses = array_remove(notified_statuses, $3::text)
        WHERE id = $1 AND business_id = $2`,
      [row.id, businessId, row.status],
    ).catch(() => undefined);
    return 'skipped';
  }
  return 'sent';
}
