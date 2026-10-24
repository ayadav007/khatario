import { randomUUID } from 'crypto';
import { query, queryOne, queryRows } from '@/lib/db';
import { retrieve } from '@/lib/rag/retrieve';
import { bootstrapTenantKnowledge, tenantKnowledgeIndexed } from '@/lib/rag/tenant-reindex';
import { businessTransport } from './business-transport';

export const DEFAULT_CUSTOMER_BOT_DAILY_LIMIT = 500;
const SHOP_CONTEXT_MAX_CHARS = 6000;

/**
 * The shop's own catalog and policies for this question. Strictly this business's chunks
 * (`tenant_customer` + businessId in SQL). Null when nothing is indexed yet; the first call
 * starts indexing in the background.
 */
export async function shopKnowledgeContext(businessId: string, message: string): Promise<string | null> {
  if (!businessId || !message.trim()) return null;
  if (!(await tenantKnowledgeIndexed(businessId))) {
    bootstrapTenantKnowledge(businessId);
    return null;
  }
  const result = await retrieve({
    scope: { audience: 'tenant_customer', businessId },
    searchQuery: message,
    originalQuery: message,
    topK: 6,
  }).catch((err) => {
    console.warn('[customer-bot] retrieval failed:', err instanceof Error ? err.message : err);
    return null;
  });
  if (!result?.chunks.length) return null;
  let out = '';
  for (const c of result.chunks) {
    const block = `### ${c.title}\n${c.content.trim()}\n\n`;
    if (out.length + block.length > SHOP_CONTEXT_MAX_CHARS) break;
    out += block;
  }
  return out.trim() || null;
}

/** One row of `order_hub` (store, WhatsApp, sales-order and billed sales) for the bot. */
export interface BotOrderRow {
  order_number: string;
  invoice_number?: string | null;
  channel?: string | null;
  payment_status: string | null;
  amount: string | number;
  delivery_status: string | null;
  method?: string | null;
  partner_name?: string | null;
  awb?: string | null;
  tracking_url: string | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  pickup_code?: string | null;
  public_token?: string | null;
  cod_amount?: string | number | null;
  cod_collected_at?: string | Date | null;
  created_at: string | Date;
  items: string | null;
}

const ORDER_WORDS = /\b(my order|order status|order no|order number|where is my|track|tracking|parcel|shipment|delivered|kab aayega|kab milega|kahan hai)\b/i;
/** Store (`SO-123`) and sales-order (`SO-INV-0001`) numbers on their own count as an order question. */
const ORDER_NUMBER = /\b(SO-[A-Z0-9-]*\d)\b/i;
/** Any order or bill number the customer typed (`SO-1042`, `INV-0012`, `INV/25-26/0007`). */
const TYPED_NUMBER = /\b((?:SO-)?[A-Z]{2,6}[-/][A-Z0-9/-]*\d)\b/i;

const DELIVERY_TEXT: Record<string, string> = {
  new: 'received, waiting for the shop to confirm',
  confirmed: 'confirmed, being prepared',
  packed: 'packed, leaving soon',
  ready_for_pickup: 'ready for pickup',
  shipped: 'on its way',
  out_for_delivery: 'out for delivery',
  delivered: 'delivered',
  delivery_failed: 'delivery attempt failed, the shop will try again',
  returned: 'returned to the shop',
  cancelled: 'cancelled',
};

export function looksLikeOrderQuestion(message: string): boolean {
  return ORDER_WORDS.test(message) || ORDER_NUMBER.test(message);
}

export function formatOrderStatus(o: BotOrderRow, trackLink?: string | null): string {
  const status = o.delivery_status ? (DELIVERY_TEXT[o.delivery_status] ?? o.delivery_status.replace(/_/g, ' ')) : 'billed';
  const cod = Number(o.cod_amount) || 0;
  const paid =
    o.payment_status === 'paid'
      ? 'paid'
      : o.payment_status === 'cod' || cod > 0
        ? o.cod_collected_at ? 'paid in cash' : 'cash on delivery'
        : o.payment_status === 'partial'
          ? 'part paid'
          : 'payment pending';
  const date = new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const lines = [`Order ${o.order_number} (${date}): ${status}. Total ₹${Number(o.amount).toLocaleString('en-IN')}, ${paid}.`];
  if (o.items) lines.push(`Items: ${o.items}`);
  const via = [o.partner_name, o.awb ? `tracking no. ${o.awb}` : null].filter(Boolean).join(', ');
  if (via && ['shipped', 'out_for_delivery', 'delivery_failed'].includes(o.delivery_status ?? '')) lines.push(`Courier: ${via}`);
  const rider = [o.rider_name, o.rider_phone].filter(Boolean).join(' ');
  if (rider && o.delivery_status === 'out_for_delivery') lines.push(`Delivery partner: ${rider}`);
  if (o.pickup_code && o.delivery_status === 'ready_for_pickup') lines.push(`Pickup code: ${o.pickup_code}`);
  if (trackLink) lines.push(`Order status: ${trackLink}`);
  if (o.tracking_url && o.tracking_url !== trackLink) lines.push(`Courier tracking: ${o.tracking_url}`);
  return lines.join('\n');
}

/**
 * Orders for this customer from every channel (`order_hub`): only orders with the sender's own phone
 * number, or the order/bill number they typed **and** their phone, so one customer can't read
 * another's order. Plain counter bills with no delivery are left out.
 */
export async function orderStatusContext(businessId: string, senderPhone: string, message: string): Promise<string | null> {
  if (!looksLikeOrderQuestion(message)) return null;
  const last10 = senderPhone.replace(/\D/g, '').slice(-10);
  if (last10.length < 10) return null;
  const typed = TYPED_NUMBER.exec(message)?.[1] ?? null;
  const rows = await queryRows<BotOrderRow>(
    `SELECT h.order_number, h.invoice_number, h.channel, h.payment_status, h.amount, h.delivery_status, h.method,
            h.partner_name, h.awb, h.tracking_url, h.rider_name, h.rider_phone, h.pickup_code, h.public_token,
            h.cod_amount, h.cod_collected_at, h.created_at,
            CASE h.source_type
              WHEN 'store_order' THEN (SELECT string_agg(oi.item_name || ' x' || trim(to_char(oi.quantity, 'FM999990.###')), ', ' ORDER BY oi.item_name)
                                         FROM store_order_items oi WHERE oi.order_id = h.source_id)
              WHEN 'sales_order' THEN (SELECT string_agg(si.item_name || ' x' || trim(to_char(si.qty, 'FM999990.###')), ', ' ORDER BY si.item_name)
                                         FROM sales_order_items si WHERE si.sales_order_id = h.source_id)
              ELSE (SELECT string_agg(ii.item_name || ' x' || trim(to_char(ii.quantity, 'FM999990.###')), ', ' ORDER BY ii.item_name)
                      FROM invoice_items ii WHERE ii.invoice_id = h.source_id)
            END AS items
       FROM order_hub h
      WHERE h.business_id = $1
        AND right(regexp_replace(h.customer_phone, '\\D', '', 'g'), 10) = $2
        AND ($3::text IS NULL OR upper(h.order_number) = upper($3) OR upper(h.invoice_number) = upper($3))
        AND NOT (h.source_type = 'invoice' AND h.fulfilment_id IS NULL)
      ORDER BY h.created_at DESC
      LIMIT 3`,
    [businessId, last10, typed],
  ).catch(() => [] as BotOrderRow[]);
  if (!rows.length) {
    return typed
      ? `No order ${typed} was found for this WhatsApp number. Ask the customer to check the number or share the phone number used when ordering.`
      : 'No orders were found for this WhatsApp number.';
  }
  const { orderTrackingUrl } = await import('@/lib/customer-surface/urls');
  return rows.map((o) => formatOrderStatus(o, o.public_token ? orderTrackingUrl(o.public_token) : null)).join('\n\n');
}

export async function dailyLimit(businessId: string): Promise<number> {
  const row = await queryOne<{ settings: { customerBotDailyLimit?: number } }>(
    `SELECT settings FROM assistant_settings WHERE scope = $1`,
    [`business:${businessId}`],
  ).catch(() => null);
  const v = Number(row?.settings?.customerBotDailyLimit);
  if (Number.isFinite(v) && v >= 0) return v;
  const env = Number(process.env.CUSTOMER_BOT_DAILY_LIMIT);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_CUSTOMER_BOT_DAILY_LIMIT;
}

async function repliesSince(businessId: string, unit: 'day' | 'month'): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM whatsapp_inbound_events
      WHERE business_id = $1 AND direction = 'out' AND handled_as = 'customer_bot'
        AND created_at >= date_trunc($2, NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
    [businessId, unit],
  ).catch(() => null);
  return Number(row?.n ?? 0);
}

export function repliesToday(businessId: string): Promise<number> {
  return repliesSince(businessId, 'day');
}

export function repliesThisMonth(businessId: string): Promise<number> {
  return repliesSince(businessId, 'month');
}

/** Per-business daily cap on AI replies (assistant_settings scope `business:<id>`, `customerBotDailyLimit`). */
export async function customerBotAllowed(businessId: string): Promise<boolean> {
  const limit = await dailyLimit(businessId);
  if (limit === 0) return false;
  return (await repliesToday(businessId)) < limit;
}

export async function recordCustomerBotReply(businessId: string, customerPhone: string): Promise<void> {
  const provider = await businessTransport(businessId).catch(() => 'baileys' as const);
  await query(
    `INSERT INTO whatsapp_inbound_events (provider, business_id, message_id, sender_phone, direction, handled_as)
     VALUES ($1, $2, $3, $4, 'out', 'customer_bot')
     ON CONFLICT DO NOTHING`,
    [provider, businessId, `bot:${randomUUID()}`, customerPhone.replace(/\D/g, '')],
  ).catch(() => undefined);
}
