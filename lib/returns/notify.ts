import { query, queryOne } from '@/lib/db';
import { notifyBusinessEvent } from '@/lib/whatsapp/tenant-send';
import type { ReturnMethod, ReturnRefundMethod } from './labels';

/**
 * Messages about a return: the customer's WhatsApp notices (spec section 7) and the shop's in-app
 * notifications. Side notices of a return action that already succeeded, so neither ever throws.
 */

export type ReturnNoticeKind = 'approved' | 'pickup_booked' | 'rejected' | 'received' | 'refunded';

export type ReturnMessageValues = {
  returnNumber: string;
  orderNumber: string;
  method: ReturnMethod | null;
  courier?: string | null;
  awb?: string | null;
  trackingUrl?: string | null;
  instructions?: string | null;
  reason?: string | null;
  creditNoteNumber?: string | null;
  amount?: number | null;
  refundMethod?: ReturnRefundMethod | null;
};

const clean = (v: string | null | undefined) => (v ?? '').trim();

/** Rupees the way the shop's customers read them: Indian digit grouping, paise only when there are some. */
function formatRupees(amount: number | null | undefined): string {
  return Number(amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** "<lead> with Delhivery, AWB R123. Track: https://..." with whatever parts exist. */
function pickupText(v: Pick<ReturnMessageValues, 'courier' | 'awb' | 'trackingUrl'>, lead: string): string {
  const courier = clean(v.courier);
  const awb = clean(v.awb);
  const link = clean(v.trackingUrl);
  return `${lead}${courier ? ` with ${courier}` : ''}${awb ? `, AWB ${awb}` : ''}.${link ? ` Track: ${link}` : ''}`;
}

/** What the customer does next once a return is approved. Also fills the template's `instructions` field. */
export function returnNextStep(v: ReturnMessageValues): string {
  if (v.method === 'courier_pickup') return pickupText(v, 'Pickup booked');
  if (v.method === 'customer_sends') {
    const where = clean(v.instructions);
    return where ? `Please send it to: ${where}` : '';
  }
  if (v.method === 'no_return') return 'No need to send it back.';
  return '';
}

/** Where a refund went, for the "refunded" notice. */
export function refundNote(amount: number | null | undefined, method: ReturnRefundMethod | null | undefined): string {
  const money = `₹${formatRupees(amount)}`;
  switch (method) {
    case 'original_payment':
      return `${money} refunded to your original payment; it reaches you in 5–7 working days.`;
    case 'store_credit':
      return `${money} kept as store credit for your next order.`;
    case 'cash':
      return `${money} paid back by Cash.`;
    case 'upi':
      return `${money} paid back by UPI.`;
    case 'bank':
      return `${money} paid back by bank transfer.`;
    default:
      return `${money} refunded.`;
  }
}

/** The customer-facing text for a return notice (spec section 7), used as plain text over the QR session. */
export function buildReturnMessage(kind: ReturnNoticeKind, v: ReturnMessageValues): string {
  switch (kind) {
    case 'approved': {
      const next = returnNextStep(v);
      return `Your return ${v.returnNumber} for order ${v.orderNumber} is approved.${next ? ` ${next}` : ''}`;
    }
    case 'pickup_booked':
      return pickupText(v, `Pickup for return ${v.returnNumber} is booked`);
    case 'rejected': {
      const reason = clean(v.reason);
      return `Sorry, your return ${v.returnNumber} was not accepted${reason ? `: ${reason}` : '.'}`;
    }
    case 'received': {
      const note = clean(v.creditNoteNumber);
      return `We received your return ${v.returnNumber}.${note ? ` Credit note ${note} for ₹${formatRupees(v.amount)}.` : ''}`;
    }
    case 'refunded':
      return refundNote(v.amount, v.refundMethod);
  }
}

type ReturnNoticeRow = {
  return_number: string;
  order_number: string | null;
  return_method: ReturnMethod | null;
  return_instructions: string | null;
  courier_name: string | null;
  awb: string | null;
  tracking_url: string | null;
  rejected_reason: string | null;
  refund_method: ReturnRefundMethod | null;
  credit_amount: string;
  refunded_amount: string;
  credit_note_number: string | null;
  customer_name: string | null;
  phone: string | null;
  business_name: string | null;
};

async function loadReturnNotice(businessId: string, returnId: string): Promise<ReturnNoticeRow | null> {
  const row = await queryOne<ReturnNoticeRow>(
    `SELECT r.return_number,
            COALESCE(so.order_number, sl.order_number, i.invoice_number) AS order_number,
            r.return_method, r.return_instructions, r.courier_name, r.awb, r.tracking_url,
            r.rejected_reason, r.refund_method, r.credit_amount::text, r.refunded_amount::text,
            cn.credit_note_number,
            COALESCE(NULLIF(c.name, ''), so.customer_name) AS customer_name,
            COALESCE(NULLIF(c.phone, ''), NULLIF(so.customer_phone, '')) AS phone,
            b.name AS business_name
       FROM order_returns r
       JOIN businesses b ON b.id = r.business_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
       LEFT JOIN store_orders so ON so.id = r.store_order_id
       LEFT JOIN sales_orders sl ON sl.id = r.sales_order_id
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN credit_notes cn ON cn.id = r.credit_note_id
      WHERE r.id = $1 AND r.business_id = $2`,
    [returnId, businessId],
  );
  return row ?? null;
}

/**
 * Tells the customer about their return by WhatsApp (their chosen template, else plain text) and, if
 * they use the shop's phone app, a push. A customer with no phone on the bill is not messaged.
 */
export async function notifyReturnCustomer(businessId: string, returnId: string, kind: ReturnNoticeKind): Promise<void> {
  try {
    const row = await loadReturnNotice(businessId, returnId);
    const phone = row?.phone?.trim();
    if (!row || !phone) return;

    const orderNumber = row.order_number ?? '';
    // A store-credit refund has no money paid out, so its amount is what the credit note was for.
    const refunded = Number(row.refunded_amount);
    const amount =
      kind === 'refunded' && row.refund_method !== 'store_credit' && refunded > 0 ? refunded : Number(row.credit_amount);
    const v: ReturnMessageValues = {
      returnNumber: row.return_number,
      orderNumber,
      method: row.return_method,
      courier: row.courier_name,
      awb: row.awb,
      trackingUrl: row.tracking_url,
      instructions: row.return_instructions,
      reason: row.rejected_reason,
      creditNoteNumber: row.credit_note_number,
      amount,
      refundMethod: row.refund_method,
    };
    await notifyBusinessEvent({
      businessId,
      eventKey: `return_${kind}`,
      to: phone,
      values: {
        customer_name: row.customer_name ?? 'there',
        business_name: row.business_name,
        return_number: row.return_number,
        order_number: orderNumber,
        courier: row.courier_name,
        awb: row.awb,
        tracking_url: row.tracking_url,
        // The whole next step, so one template covers pickup, "send it to us" and "no need to send it back".
        instructions: returnNextStep(v),
        reason: row.rejected_reason,
        credit_note_number: row.credit_note_number,
        amount: formatRupees(amount),
        refund_note: kind === 'refunded' ? refundNote(amount, row.refund_method) : undefined,
      },
      fallbackText: buildReturnMessage(kind, v),
    });
  } catch (err) {
    console.error(`[returns] ${kind} notice for return ${returnId} not sent:`, err instanceof Error ? err.message : err);
  }
}

/** Puts a new customer request, or a returned parcel reaching the shop, on the shop's notification list. */
export async function notifyMerchantReturn(
  businessId: string,
  returnId: string,
  kind: 'requested' | 'arrived',
): Promise<void> {
  try {
    const row = await loadReturnNotice(businessId, returnId);
    if (!row) return;
    // Type 'general' because the notifications type check has no return value; the reference says what it is.
    await query(
      `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
       VALUES ($1, 'general', $2, $3, 'order_return', $4, CURRENT_TIMESTAMP)`,
      [
        businessId,
        kind === 'requested' ? 'New return request' : 'Return arrived at shop',
        `${row.return_number} for order ${row.order_number ?? ''}`.trim(),
        returnId,
      ],
    );
  } catch (err) {
    console.error(`[returns] ${kind} notification for return ${returnId} not saved:`, err instanceof Error ? err.message : err);
  }
}
