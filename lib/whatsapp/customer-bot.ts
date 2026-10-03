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

export interface StoreOrderRow {
  order_number: string;
  status: string;
  payment_status: string | null;
  payment_provider?: string | null;
  cash_collected_at?: string | Date | null;
  grand_total: string | number;
  delivery_mode: string;
  tracking_url: string | null;
  created_at: string | Date;
  items: string | null;
}

const ORDER_WORDS = /\b(my order|order status|order no|order number|where is my|track|tracking|parcel|shipment|delivered|kab aayega|kab milega|kahan hai)\b/i;
/** Online-store order numbers (`SO-123`). */
const ORDER_NUMBER = /\b(SO-\d+)\b/i;

const STATUS_TEXT: Record<string, string> = {
  pending: 'received, waiting for the shop to confirm',
  confirmed: 'confirmed, being prepared',
  ready: 'ready',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

export function looksLikeOrderQuestion(message: string): boolean {
  return ORDER_WORDS.test(message) || ORDER_NUMBER.test(message);
}

export function formatOrderStatus(o: StoreOrderRow): string {
  const status = STATUS_TEXT[o.status] ?? o.status;
  const ready = o.status === 'ready' ? (o.delivery_mode === 'pickup' ? ' for pickup' : ' for delivery') : '';
  const paid =
    o.payment_status === 'paid'
      ? 'paid'
      : o.payment_provider === 'upi'
        ? o.cash_collected_at
          ? 'paid by UPI'
          : 'UPI payment awaiting confirmation'
        : o.payment_status === 'cod'
          ? 'cash on delivery'
          : 'payment pending';
  const date = new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const lines = [`Order ${o.order_number} (${date}): ${status}${ready}. Total ₹${Number(o.grand_total).toLocaleString('en-IN')}, ${paid}.`];
  if (o.items) lines.push(`Items: ${o.items}`);
  if (o.tracking_url) lines.push(`Tracking: ${o.tracking_url}`);
  return lines.join('\n');
}

/**
 * Online-store orders for this customer: only orders placed with the sender's own phone number, or
 * the order number they typed **and** their phone, so one customer can't read another's order.
 */
export async function orderStatusContext(businessId: string, senderPhone: string, message: string): Promise<string | null> {
  if (!looksLikeOrderQuestion(message)) return null;
  const last10 = senderPhone.replace(/\D/g, '').slice(-10);
  if (last10.length < 10) return null;
  const typed = ORDER_NUMBER.exec(message)?.[1] ?? null;
  const rows = await queryRows<StoreOrderRow>(
    `SELECT o.order_number, o.status, o.payment_status, o.payment_provider, o.cash_collected_at, o.grand_total, o.delivery_mode, o.tracking_url, o.created_at,
            (SELECT string_agg(oi.item_name || ' x' || trim(to_char(oi.quantity, 'FM999990.###')), ', ' ORDER BY oi.item_name)
               FROM store_order_items oi WHERE oi.order_id = o.id) AS items
       FROM store_orders o
      WHERE o.business_id = $1
        AND right(regexp_replace(o.customer_phone, '\\D', '', 'g'), 10) = $2
        AND ($3::text IS NULL OR upper(o.order_number) = upper($3))
      ORDER BY o.created_at DESC
      LIMIT 3`,
    [businessId, last10, typed],
  ).catch(() => [] as StoreOrderRow[]);
  if (!rows.length) {
    return typed
      ? `No online-store order ${typed} was found for this WhatsApp number. Ask the customer to check the number or share the phone number used at checkout.`
      : 'No online-store orders were found for this WhatsApp number.';
  }
  return rows.map(formatOrderStatus).join('\n\n');
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
