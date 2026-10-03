import { query, queryOne, queryRows } from '@/lib/db';
import { generatePaymentLinkForBusiness } from '@/lib/services/payment-service';
import { sendBusinessLink, sendBusinessText } from '@/lib/whatsapp/business-transport';
import { inr, loadShopItems } from './items';
import { getShopSettings } from './settings';

export const SHOP_MAX_LINES = 50;
export const SHOP_MAX_QTY = 999;

export type ShopOrderLine = { itemId: string; quantity: number };

export type PlacedShopOrder = {
  ok: true;
  orderId: string;
  orderNumber: string;
  total: number;
  lines: Array<{ name: string; quantity: number; price: number; lineTotal: number }>;
  /** Cart lines that are no longer sold (removed, out of stock, or now priced differently in scope). */
  unavailable: string[];
  paymentLink: string | null;
  /** UPI page or other link that cannot be confirmed automatically; the customer sends a screenshot. */
  manualPayment: boolean;
};

export type ShopOrderOutcome =
  | PlacedShopOrder
  | { ok: false; reason: 'SHOP_OFF' | 'NO_ITEMS'; unavailable: string[] };

/** Same item twice adds up; quantities are whole numbers between 1 and SHOP_MAX_QTY. */
export function normalizeShopLines(lines: ShopOrderLine[]): ShopOrderLine[] {
  const merged = new Map<string, number>();
  for (const l of lines) {
    const id = String(l.itemId ?? '').trim().toLowerCase();
    const qty = Math.floor(Number(l.quantity) || 0);
    if (!/^[0-9a-f-]{36}$/.test(id) || qty <= 0) continue;
    merged.set(id, Math.min(SHOP_MAX_QTY, (merged.get(id) ?? 0) + qty));
  }
  return Array.from(merged, ([itemId, quantity]) => ({ itemId, quantity })).slice(0, SHOP_MAX_LINES);
}

async function itemNames(businessId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await queryRows<{ name: string }>(
    `SELECT name FROM items WHERE business_id = $1 AND id = ANY($2::uuid[])`,
    [businessId, ids],
  ).catch(() => []);
  return rows.map((r) => r.name);
}

export async function conversationUuidForPhone(businessId: string, phone: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM whatsapp_conversations WHERE business_id = $1 AND conversation_id = $2 LIMIT 1`,
    [businessId, phone.replace(/\D/g, '')],
  ).catch(() => null);
  return row?.id ?? null;
}

/**
 * Turns a WhatsApp cart into a draft sales order priced from the catalogue (never from the cart),
 * puts the chat in `waiting_payment` and creates a payment link on the business's own gateway.
 * A newer cart replaces the chat's unpaid draft. The paid-order webhook then invoices it.
 */
export async function placeShopOrder(input: {
  businessId: string;
  phone: string;
  lines: ShopOrderLine[];
  conversationUuid?: string | null;
  customerName?: string | null;
  address?: string | null;
  note?: string | null;
}): Promise<ShopOrderOutcome> {
  const { businessId } = input;
  const phone = input.phone.replace(/\D/g, '');
  const settings = await getShopSettings(businessId);
  if (!settings.enabled) return { ok: false, reason: 'SHOP_OFF', unavailable: [] };

  const lines = normalizeShopLines(input.lines);
  const items = await loadShopItems(businessId, settings, { ids: lines.map((l) => l.itemId) });
  const byId = new Map(items.map((i) => [i.id.toLowerCase(), i]));
  const orderable = lines.filter((l) => byId.has(l.itemId));
  const unavailable = await itemNames(
    businessId,
    lines.filter((l) => !byId.has(l.itemId)).map((l) => l.itemId),
  );
  if (orderable.length === 0) return { ok: false, reason: 'NO_ITEMS', unavailable };

  const orderItems = orderable.map((l) => {
    const item = byId.get(l.itemId)!;
    return { item_id: item.id, name: item.name, quantity: l.quantity, price: item.price };
  });

  const conversationUuid = input.conversationUuid ?? (await conversationUuidForPhone(businessId, phone));
  if (conversationUuid) {
    await query(
      `UPDATE sales_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE business_id = $1 AND whatsapp_conversation_id = $2 AND status = 'draft'
          AND COALESCE(payment_status, 'unpaid') = 'unpaid' AND converted_invoice_id IS NULL`,
      [businessId, conversationUuid],
    );
  }

  const customer =
    phone.length >= 10
      ? await queryOne<{ id: string }>(
          `SELECT id FROM customers
            WHERE business_id = $1 AND deleted_at IS NULL
              AND RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = RIGHT($2, 10)
            ORDER BY created_at ASC LIMIT 1`,
          [businessId, phone],
        )
      : null;

  const { createSalesOrderFromWhatsApp, updateConversationState } = await import('@/lib/whatsapp-crm');
  const address = input.address?.trim().slice(0, 500) || null;
  const created = await createSalesOrderFromWhatsApp(
    businessId,
    orderItems,
    phone,
    customer?.id,
    conversationUuid ?? undefined,
    address ?? undefined,
  );

  const notes = [
    'WhatsApp shop order',
    input.customerName?.trim() ? `Name: ${input.customerName.trim().slice(0, 100)}` : null,
    input.note?.trim() ? `Customer note: ${input.note.trim().slice(0, 500)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  await query(`UPDATE sales_orders SET notes = $1 WHERE id = $2 AND business_id = $3`, [notes, created.order_id, businessId]);

  await updateConversationState(businessId, phone, 'waiting_payment', {
    order_id: created.order_id,
    order_number: created.order_number,
    total_amount: created.total_amount,
    waiting_payment_since: new Date().toISOString(),
  });

  let payment: Awaited<ReturnType<typeof generatePaymentLinkForBusiness>> = null;
  try {
    payment = await generatePaymentLinkForBusiness(businessId, {
      orderId: created.order_id,
      amount: created.total_amount,
      customerName: input.customerName?.trim() || phone,
    });
  } catch (e) {
    console.error('[whatsapp-shop] payment link failed:', e instanceof Error ? e.message : e);
  }

  return {
    ok: true,
    orderId: created.order_id,
    orderNumber: created.order_number,
    total: created.total_amount,
    lines: orderItems.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, lineTotal: i.price * i.quantity })),
    unavailable,
    paymentLink: payment?.link ?? null,
    manualPayment: !!payment && payment.source !== 'psp',
  };
}

export function shopOrderReplyText(order: PlacedShopOrder): string {
  const lines = order.lines.map((l, i) => `${i + 1}. ${l.name} × ${l.quantity} = ${inr(l.lineTotal)}`).join('\n');
  const missing = order.unavailable.length
    ? `\n\n⚠️ Not available right now, so not included: ${order.unavailable.join(', ')}`
    : '';
  const next = !order.paymentLink
    ? "We'll share the payment details with you here shortly."
    : order.manualPayment
      ? 'Pay using the link below, then send the payment screenshot here so we can confirm your order.'
      : "Pay using the link below. We'll confirm your order here as soon as the payment is received.";
  return `🛒 *Order ${order.orderNumber} received*\n\n${lines}\n\n💰 *Total: ${inr(order.total)}*${missing}\n\n${next}`;
}

export function shopOrderFailureText(outcome: Extract<ShopOrderOutcome, { ok: false }>): string {
  if (outcome.reason === 'SHOP_OFF') return "Sorry, we're not taking orders on WhatsApp right now. Please message us and we'll help you.";
  const which = outcome.unavailable.length ? ` (${outcome.unavailable.join(', ')})` : '';
  return `Sorry, the items in your cart${which} aren't available right now. Please pick something else from our catalog.`;
}

/** Stores a bot message in the CRM inbox so staff see what the customer received. */
export async function storeShopBotMessage(
  businessId: string,
  phone: string,
  text: string,
  messageId: string | null,
): Promise<void> {
  const digits = phone.replace(/\D/g, '');
  const conversationUuid = await conversationUuidForPhone(businessId, digits);
  if (!conversationUuid) return;
  const { storeOutgoingMessage } = await import('@/lib/whatsapp-crm');
  await storeOutgoingMessage(
    businessId,
    conversationUuid,
    `${digits}@s.whatsapp.net`,
    text,
    messageId ?? `shop_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    'text',
    undefined,
    undefined,
    Math.floor(Date.now() / 1000),
    null,
    { sentBy: 'bot' },
  ).catch(() => undefined);
}

/** Sends the order summary (with a Pay button where possible) and records it in the inbox. */
export async function sendShopOrderReply(businessId: string, phone: string, outcome: ShopOrderOutcome): Promise<void> {
  if (!outcome.ok) {
    const text = shopOrderFailureText(outcome);
    const sent = await sendBusinessText(businessId, phone, text);
    await storeShopBotMessage(businessId, phone, text, sent.messageId);
    return;
  }
  const body = shopOrderReplyText(outcome);
  if (outcome.paymentLink) {
    const sent = await sendBusinessLink(businessId, phone, { body, buttonText: 'Pay now', url: outcome.paymentLink });
    await storeShopBotMessage(businessId, phone, sent.text, sent.messageId);
    return;
  }
  const sent = await sendBusinessText(businessId, phone, body);
  await storeShopBotMessage(businessId, phone, body, sent.messageId);
}
