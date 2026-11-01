/**
 * Khata WhatsApp messages and in-app alerts. Side notifications: failures are logged, never thrown.
 * Each goes through the business's chosen Meta template when one is attached to the event,
 * else plain text over the QR session (lib/whatsapp/tenant-send.ts).
 */
import { query, queryOne } from '@/lib/db';
import { notifyBusinessEvent } from '@/lib/whatsapp/tenant-send';
import { storePublicHostname } from '@/lib/store/subdomain';
import { khataSettlementDayLabel, khataShortDate } from './cycle';
import { khataReasonLabel } from './rules';

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://khatario.com').replace(/\/+$/, '');
}

function inr(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type Biz = { name: string; phone: string | null; storeBase: string | null };

async function loadBusiness(businessId: string): Promise<Biz> {
  const row = await queryOne<{ name: string | null; phone: string | null; store_subdomain: string | null; store_enabled: boolean | null }>(
    `SELECT b.name, b.phone, bs.store_subdomain, bs.store_enabled
       FROM businesses b LEFT JOIN business_settings bs ON bs.business_id = b.id
      WHERE b.id = $1`,
    [businessId],
  );
  let storeBase: string | null = null;
  if (row?.store_enabled && row.store_subdomain) {
    const app = new URL(appBaseUrl());
    storeBase = `${app.protocol}//${storePublicHostname(row.store_subdomain, app.host)}`;
  }
  return { name: row?.name?.trim() || 'the shop', phone: row?.phone ?? null, storeBase };
}

/** "My khata" in the store; with a statement token it opens that statement without signing in. */
export function khataLink(storeBase: string | null, statementToken?: string | null): string {
  if (!storeBase) return '';
  return statementToken ? `${storeBase}/khata?s=${encodeURIComponent(statementToken)}` : `${storeBase}/khata`;
}

async function inApp(businessId: string, title: string, message: string, refType: string, refId: string): Promise<void> {
  await query(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'general', $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [businessId, title, message, refType, refId],
  ).catch((err) => console.error('[khata] notification insert failed', err));
}

export async function notifyMerchantKhataRequest(input: {
  businessId: string;
  customerId: string;
  name: string;
  phone: string;
}): Promise<void> {
  try {
    await inApp(
      input.businessId,
      `Khata request from ${input.name}`,
      `${input.name} (${input.phone}) asked for a khata on your online store. Set the settlement day and limit to open it.`,
      'khata_customer',
      input.customerId,
    );
    const biz = await loadBusiness(input.businessId);
    if (!biz.phone) return;
    await notifyBusinessEvent({
      businessId: input.businessId,
      eventKey: 'merchant_khata_request',
      to: biz.phone,
      values: { customer_name: input.name, contact: input.phone },
      fallbackText: `${input.name} (${input.phone}) asked for a khata on your online store. Open the customer in Khatario to set the settlement day and limit.`,
    });
  } catch (err) {
    console.error('[khata] request alert', err);
  }
}

export async function notifyMerchantKhataApproval(input: {
  businessId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  total: number;
  reason: string | null;
}): Promise<void> {
  try {
    const reason = khataReasonLabel(input.reason).toLowerCase() || 'khata rule';
    await inApp(
      input.businessId,
      `Approve khata order ${input.orderNumber}`,
      `${input.customerName} placed ₹${inr(input.total)} on khata (${reason}). Approve or reject it in Store Orders.`,
      'khata_order',
      input.orderId,
    );
    const biz = await loadBusiness(input.businessId);
    if (!biz.phone) return;
    await notifyBusinessEvent({
      businessId: input.businessId,
      eventKey: 'merchant_khata_approval',
      to: biz.phone,
      values: { order_number: input.orderNumber, customer_name: input.customerName, total: inr(input.total), reason },
      fallbackText: `Khata order ${input.orderNumber} from ${input.customerName} for ₹${inr(input.total)} needs your approval (${reason}). Open Store Orders in Khatario to approve or reject.`,
    });
  } catch (err) {
    console.error('[khata] approval alert', err);
  }
}

/** "Allow and tell me": the order went through over the limit or with overdue bills. */
export async function notifyMerchantKhataWarning(input: {
  businessId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  total: number;
  reason: string | null;
}): Promise<void> {
  const reason = khataReasonLabel(input.reason).toLowerCase();
  await inApp(
    input.businessId,
    `Khata order ${input.orderNumber}: ${reason}`,
    `${input.customerName} placed ₹${inr(input.total)} on khata while ${reason === 'has overdue bills' ? 'having overdue bills' : reason}. The order went through as your rule allows.`,
    'khata_order',
    input.orderId,
  );
}

export async function notifyCustomerKhataOpened(input: {
  businessId: string;
  customerId: string;
  phone: string;
  name: string;
}): Promise<void> {
  try {
    const row = await queryOne<{ khata_settlement_day: number | null }>(
      `SELECT khata_settlement_day FROM customers WHERE id = $1 AND business_id = $2`,
      [input.customerId, input.businessId],
    );
    if (row?.khata_settlement_day == null) return;
    const biz = await loadBusiness(input.businessId);
    const day = khataSettlementDayLabel(row.khata_settlement_day).toLowerCase();
    const link = khataLink(biz.storeBase);
    await notifyBusinessEvent({
      businessId: input.businessId,
      eventKey: 'khata_opened',
      to: input.phone,
      values: { customer_name: input.name, business_name: biz.name, settlement_day: day, khata_link: link || '-' },
      fallbackText: `Hi ${input.name}, ${biz.name} has opened a khata for you. Order from our store and pay on the ${day}.${link ? ` See your khata here: ${link}` : ''}`,
    });
  } catch (err) {
    console.error('[khata] opened message', err);
  }
}

export async function notifyCustomerKhataOrder(input: {
  businessId: string;
  phone: string;
  customerName: string;
  orderNumber: string;
  total: number;
  payBy: string | null;
  kind: 'placed' | 'waiting' | 'rejected';
}): Promise<void> {
  try {
    const biz = await loadBusiness(input.businessId);
    const total = inr(input.total);
    if (input.kind === 'placed') {
      const due = input.payBy ? khataShortDate(input.payBy) : 'your settlement day';
      await notifyBusinessEvent({
        businessId: input.businessId,
        eventKey: 'khata_order_placed',
        to: input.phone,
        values: {
          customer_name: input.customerName,
          order_number: input.orderNumber,
          total,
          business_name: biz.name,
          due_date: due,
          khata_link: khataLink(biz.storeBase) || '-',
        },
        fallbackText: `Hi ${input.customerName}, order ${input.orderNumber} for ₹${total} is added to your khata with ${biz.name}. Pay by ${due}. Nothing to pay at delivery or pickup.`,
      });
      return;
    }
    if (input.kind === 'waiting') {
      await notifyBusinessEvent({
        businessId: input.businessId,
        eventKey: 'khata_order_waiting',
        to: input.phone,
        values: { customer_name: input.customerName, business_name: biz.name, order_number: input.orderNumber },
        fallbackText: `Hi ${input.customerName}, ${biz.name} will confirm your khata order ${input.orderNumber} shortly. We will message you once it is confirmed.`,
      });
      return;
    }
    await notifyBusinessEvent({
      businessId: input.businessId,
      eventKey: 'khata_order_rejected',
      to: input.phone,
      values: { customer_name: input.customerName, business_name: biz.name, order_number: input.orderNumber },
      fallbackText: `Hi ${input.customerName}, ${biz.name} could not add order ${input.orderNumber} to your khata, so it is cancelled. Please order again and choose another way to pay.`,
    });
  } catch (err) {
    console.error('[khata] order message', err);
  }
}

export async function sendKhataStatementMessage(input: {
  businessId: string;
  phone: string;
  customerName: string;
  amountDue: number;
  payBy: string;
  statementToken: string;
  kind: 'statement' | 'overdue';
}): Promise<{ via: 'cloud' | 'qr' | null }> {
  const biz = await loadBusiness(input.businessId);
  const link = khataLink(biz.storeBase, input.statementToken);
  const amount = inr(input.amountDue);
  const date = khataShortDate(input.payBy);
  const values = {
    customer_name: input.customerName,
    business_name: biz.name,
    amount_due: amount,
    due_date: date,
    khata_link: link || '-',
  };
  if (input.kind === 'statement') {
    return notifyBusinessEvent({
      businessId: input.businessId,
      eventKey: 'khata_statement',
      to: input.phone,
      values,
      fallbackText: `Hi ${input.customerName}, your khata statement from ${biz.name}: ₹${amount} due, please pay by ${date}.${link ? ` See the bills and pay here: ${link}` : ''} Thank you.`,
    });
  }
  return notifyBusinessEvent({
    businessId: input.businessId,
    eventKey: 'khata_overdue',
    to: input.phone,
    values,
    fallbackText: `Hi ${input.customerName}, ₹${amount} on your khata with ${biz.name} was due on ${date} and is still unpaid.${link ? ` See the bills and pay here: ${link}` : ''} Please ignore if already paid.`,
  });
}
