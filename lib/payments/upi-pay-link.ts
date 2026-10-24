import crypto from 'crypto';
import { queryOne } from '@/lib/db';
import {
  getSuccessfulPaymentsSumForOrder,
  remainingOrderAmountAfterSuccessSum,
} from '@/lib/services/payment-transactions';

export interface UpiUriParams {
  /** Payee UPI ID (VPA), e.g. shop@okicici */
  vpa: string;
  /** Shown to the payer as who they are paying: the shop, never the customer. */
  payeeName: string;
  amount: number;
  note?: string;
  /** Order number; goes into the note so the shop can match the credit. */
  reference?: string;
}

/**
 * Standard UPI intent query (`pa`, `pn`, `am`, `cu`, `tn`), every value encoded. No `tr`: an unsigned
 * link carrying a merchant transaction reference is declined by many business UPI IDs (BharatPe, Paytm
 * for Business) as a security risk.
 */
export function upiQuery(p: UpiUriParams): string {
  const qs = new URLSearchParams();
  qs.set('pa', p.vpa.trim());
  qs.set('pn', p.payeeName.trim().slice(0, 50) || 'Merchant');
  qs.set('am', p.amount.toFixed(2));
  qs.set('cu', 'INR');
  const ref = p.reference?.trim();
  const note = p.note?.trim() || (ref ? `Order ${ref}` : '');
  const withRef = ref && note && !note.includes(ref) ? `${note} ${ref}` : note;
  if (withRef) qs.set('tn', withRef.slice(0, 80));
  return qs.toString().replace(/\+/g, '%20');
}

export function buildUpiUri(p: UpiUriParams): string {
  return `upi://pay?${upiQuery(p)}`;
}

/** App-specific links: Android intents target one app; iOS has no generic `upi://` handler. */
export function upiAppLinks(p: UpiUriParams) {
  const q = upiQuery(p);
  const intent = (pkg: string) => `intent://pay?${q}#Intent;scheme=upi;package=${pkg};end`;
  return {
    any: `upi://pay?${q}`,
    android: {
      gpay: intent('com.google.android.apps.nbu.paisa.user'),
      phonepe: intent('com.phonepe.app'),
      paytm: intent('net.one97.paytm'),
    },
    ios: {
      gpay: `gpay://upi/pay?${q}`,
      phonepe: `phonepe://pay?${q}`,
      paytm: `paytmmp://pay?${q}`,
    },
  };
}

function signingSecret(): string | null {
  const s = (process.env.UPI_PAY_LINK_SECRET || process.env.JWT_SECRET || '').trim();
  return s.length >= 16 ? s : null;
}

function sign(orderId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`upi-pay:${orderId}`).digest('base64url').slice(0, 22);
}

/** Unguessable token for one sales order's pay page. Null when the server has no signing secret. */
export function createUpiPayToken(orderId: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return `${Buffer.from(orderId, 'utf8').toString('base64url')}.${sign(orderId, secret)}`;
}

export function verifyUpiPayToken(token: string): string | null {
  const secret = signingSecret();
  if (!secret || typeof token !== 'string') return null;
  const [idPart, sig] = token.split('.');
  if (!idPart || !sig) return null;
  let orderId: string;
  try {
    orderId = Buffer.from(idPart, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const expected = sign(orderId, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? orderId : null;
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://khatario.com').replace(/\/+$/, '');
}

/**
 * `https://…/pay/upi/<token>`: WhatsApp only makes http(s) links tappable, so the customer gets this
 * page, which opens their UPI app. Null when no signing secret is configured.
 */
export function upiPayPageUrl(orderId: string): string | null {
  const token = createUpiPayToken(orderId);
  return token ? `${appBaseUrl()}/pay/upi/${token}` : null;
}

/** The business's active UPI ID (Settings > Business Profile > payment methods), default first. */
export async function getBusinessUpiVpa(businessId: string): Promise<string | null> {
  const method = await queryOne<{ upi_id: string | null }>(
    `SELECT upi_id FROM payment_methods
      WHERE business_id = $1 AND is_active = true AND method_type = 'upi' AND upi_id IS NOT NULL
      ORDER BY is_default DESC, priority ASC, created_at ASC LIMIT 1`,
    [businessId],
  );
  return method?.upi_id?.trim() || null;
}

export interface UpiPayment {
  shopName: string;
  orderNumber: string;
  amount: number;
  paid: boolean;
  vpa: string | null;
  upi: UpiUriParams | null;
}

/** Everything the public pay page shows, always read fresh (remaining balance, current UPI ID). */
export async function loadUpiPayment(token: string): Promise<UpiPayment | null> {
  const orderId = verifyUpiPayToken(token);
  if (!orderId) return null;
  const order = await queryOne<{ business_id: string; order_number: string; grand_total: string; status: string; shop: string | null }>(
    `SELECT o.business_id, o.order_number, o.grand_total::text AS grand_total, o.status, b.name AS shop
       FROM sales_orders o JOIN businesses b ON b.id = o.business_id
      WHERE o.id = $1`,
    [orderId],
  );
  if (!order || order.status === 'cancelled') return null;
  const vpa = await getBusinessUpiVpa(order.business_id);
  const paidSum = await getSuccessfulPaymentsSumForOrder(order.business_id, orderId);
  const amount = remainingOrderAmountAfterSuccessSum(parseFloat(order.grand_total) || 0, paidSum);
  const shopName = order.shop?.trim() || 'Shop';
  const paid = amount <= 0.009;
  return {
    shopName,
    orderNumber: order.order_number,
    amount,
    paid,
    vpa,
    upi: vpa && !paid
      ? { vpa, payeeName: shopName, amount, note: `Order ${order.order_number}`, reference: order.order_number }
      : null,
  };
}
