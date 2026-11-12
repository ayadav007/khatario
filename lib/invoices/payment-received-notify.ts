/**
 * "Payment received" WhatsApp to the customer after a receipt is posted against an invoice:
 * online payments from the bill link, and payments staff record in Payments In.
 * The business turns it off under Settings → WhatsApp → Notifications (reminder_type
 * 'payment_received' in whatsapp_reminder_settings; on when no row exists).
 * Never throws: the payment already succeeded.
 */
import { queryOne, query, queryRows } from '@/lib/db';
import { checkLimit } from '@/lib/subscription';
import { toE164Digits } from '@/lib/platform-whatsapp-send';
import { whatsAppOutboundReady } from '@/lib/whatsapp/outbound-ready';
import { invoiceEventValues } from '@/lib/whatsapp/invoice-event-values';
import { notifyBusinessEvent } from '@/lib/whatsapp/tenant-send';

/** Back-dated entries (old receipts typed in later) do not message the customer. */
export const PAYMENT_RECEIVED_MAX_AGE_DAYS = 3;

export type PaymentReceivedSource = 'online' | 'manual';

export async function paymentReceivedMessageEnabled(businessId: string): Promise<boolean> {
  const row = await queryOne<{ enabled: boolean | null }>(
    `SELECT enabled FROM whatsapp_reminder_settings WHERE business_id = $1 AND reminder_type = 'payment_received'`,
    [businessId],
  );
  return row ? row.enabled !== false : true;
}

function money(v: unknown): string {
  return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function paymentReceivedText(p: {
  customerName: string;
  businessName: string;
  invoiceNumber: string;
  amountPaid: string;
  amountDue: number;
  link: string;
}): string {
  const balance =
    p.amountDue > 0.005 ? `Balance still due: ₹${money(p.amountDue)}.` : 'This invoice is now fully paid.';
  const link = p.link ? `\nView your bill: ${p.link}` : '';
  return `Hi ${p.customerName}, we have received ₹${p.amountPaid} for invoice ${p.invoiceNumber}. ${balance}${link}\n\nThank you!\n${p.businessName}`;
}

export async function notifyInvoicePaymentReceived(input: {
  businessId: string;
  paymentId: string;
  source: PaymentReceivedSource;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const row = await queryOne<{
      amount: string;
      payment_date: string | null;
      age_days: number | null;
      invoice_id: string;
      invoice_number: string;
      grand_total: string;
      balance_amount: string;
      due_date: string | null;
      customer_name: string | null;
      customer_phone: string | null;
      business_name: string;
    }>(
      `SELECT p.amount::text, p.payment_date,
              (CURRENT_DATE - p.payment_date::date) AS age_days,
              i.id AS invoice_id, i.invoice_number, i.grand_total::text,
              COALESCE(i.balance_amount, 0)::text AS balance_amount, i.due_date,
              c.name AS customer_name, c.phone AS customer_phone, b.name AS business_name
         FROM payments p
         JOIN invoices i ON i.id = p.reference_id AND i.business_id = p.business_id
         LEFT JOIN customers c ON c.id = i.customer_id
         JOIN businesses b ON b.id = p.business_id
        WHERE p.id = $1 AND p.business_id = $2
          AND p.type = 'receivable' AND p.reference_type = 'invoice'
          AND COALESCE(p.status, 'active') = 'active'`,
      [input.paymentId, input.businessId],
    );
    if (!row) return { sent: false, reason: 'not_an_invoice_receipt' };
    if (input.source === 'manual' && row.age_days != null && row.age_days > PAYMENT_RECEIVED_MAX_AGE_DAYS) {
      return { sent: false, reason: 'back_dated' };
    }
    const phone = row.customer_phone ? toE164Digits(row.customer_phone) : null;
    if (!phone) return { sent: false, reason: 'no_phone' };
    if (!(await paymentReceivedMessageEnabled(input.businessId))) return { sent: false, reason: 'disabled' };
    if (!(await whatsAppOutboundReady(input.businessId)).ready) return { sent: false, reason: 'whatsapp_not_connected' };
    if (!(await checkLimit(input.businessId, 'whatsapp')).allowed) return { sent: false, reason: 'limit_reached' };

    const values = await invoiceEventValues({
      id: row.invoice_id,
      invoice_number: row.invoice_number,
      grand_total: row.grand_total,
      balance_amount: row.balance_amount,
      due_date: row.due_date,
      customer_name: row.customer_name,
      business_name: row.business_name,
    });
    const amountPaid = money(row.amount);
    const amountDue = Number(row.balance_amount) || 0;
    const text = paymentReceivedText({
      customerName: row.customer_name || 'Customer',
      businessName: row.business_name,
      invoiceNumber: row.invoice_number,
      amountPaid,
      amountDue,
      link: values.invoice_link && values.invoice_link !== '-' ? String(values.invoice_link) : '',
    });
    const res = await notifyBusinessEvent({
      businessId: input.businessId,
      eventKey: 'invoice_payment_received',
      to: row.customer_phone!,
      values: { ...values, amount_paid: amountPaid, amount_due: money(amountDue) },
      fallbackText: text,
    });
    await query(
      `INSERT INTO whatsapp_messages (business_id, to_number, message_type, reference_type, reference_id, message_text, status, error_message)
       VALUES ($1, $2, 'payment', 'invoice', $3, $4, $5, $6)`,
      [
        input.businessId,
        row.customer_phone,
        row.invoice_id,
        text,
        res.via ? 'sent' : 'failed',
        res.via ? null : 'Payment received message was not delivered',
      ],
    );
    return res.via ? { sent: true } : { sent: false, reason: 'not_delivered' };
  } catch (err) {
    console.error('[payment received] message failed:', err);
    return { sent: false, reason: 'error' };
  }
}

/** Fire-and-forget after a staff-recorded receipt; the API response does not wait for WhatsApp. */
export function queuePaymentReceivedMessage(businessId: string, paymentId: string | null | undefined): void {
  if (!paymentId) return;
  void notifyInvoicePaymentReceived({ businessId, paymentId, source: 'manual' });
}

/** "Payment received" text for one online payment that cleared several bills. */
export function billsPaymentReceivedText(p: {
  customerName: string;
  businessName: string;
  amountPaid: number;
  cleared: { invoiceNumber: string; amount: number; fullyPaid: boolean }[];
  stillDue: number;
  openBills: number;
  link: string;
}): string {
  const lines = p.cleared
    .map((c) => `• ${c.invoiceNumber}: ₹${money(c.amount)}${c.fullyPaid ? ' (paid)' : ' (part paid)'}`)
    .join('\n');
  const after =
    p.stillDue > 0.005
      ? `Still due: ₹${money(p.stillDue)} on ${p.openBills} bill${p.openBills === 1 ? '' : 's'}.`
      : 'All your bills are now paid.';
  const link = p.link ? `\nView your bills: ${p.link}` : '';
  return `Hi ${p.customerName}, we have received ₹${money(p.amountPaid)}. Thank you!\n\n${lines}\n\n${after}${link}\n\n${p.businessName}`;
}

/** One message for a bills payment from the customer's bills page, listing what it cleared. */
export async function notifyBillsPaymentReceived(input: {
  businessId: string;
  onlinePaymentId: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const head = await queryOne<{
      customer_id: string;
      customer_name: string | null;
      customer_phone: string | null;
      business_name: string;
      settled: string;
    }>(
      `SELECT p.customer_id, c.name AS customer_name, c.phone AS customer_phone, b.name AS business_name,
              COALESCE(p.settled_amount, 0)::text AS settled
         FROM invoice_online_payments p
         JOIN customers c ON c.id = p.customer_id
         JOIN businesses b ON b.id = p.business_id
        WHERE p.id = $1 AND p.business_id = $2 AND p.status = 'paid'`,
      [input.onlinePaymentId, input.businessId],
    );
    if (!head) return { sent: false, reason: 'not_found' };
    const phone = head.customer_phone ? toE164Digits(head.customer_phone) : null;
    if (!phone) return { sent: false, reason: 'no_phone' };
    if (!(await paymentReceivedMessageEnabled(input.businessId))) return { sent: false, reason: 'disabled' };
    if (!(await whatsAppOutboundReady(input.businessId)).ready) return { sent: false, reason: 'whatsapp_not_connected' };
    if (!(await checkLimit(input.businessId, 'whatsapp')).allowed) return { sent: false, reason: 'limit_reached' };

    const cleared = await queryRows<{ invoice_id: string; invoice_number: string; amount: string; balance: string }>(
      `SELECT a.invoice_id, i.invoice_number, a.amount::text, COALESCE(i.balance_amount, 0)::text AS balance
         FROM invoice_online_payment_allocations a JOIN invoices i ON i.id = a.invoice_id
        WHERE a.online_payment_id = $1 AND a.business_id = $2
        ORDER BY COALESCE(i.due_date, i.invoice_date), i.invoice_date`,
      [input.onlinePaymentId, input.businessId],
    );
    const { customerDues, ensureCustomerBillsToken, customerBillsUrl } = await import('@/lib/payment-reminders/statement');
    const dues = await customerDues(input.businessId, head.customer_id);
    const link = customerBillsUrl(await ensureCustomerBillsToken(input.businessId, head.customer_id));
    const amountPaid = Number(head.settled) || 0;
    const text = billsPaymentReceivedText({
      customerName: head.customer_name || 'Customer',
      businessName: head.business_name,
      amountPaid,
      cleared: cleared.map((c) => ({
        invoiceNumber: c.invoice_number,
        amount: Number(c.amount) || 0,
        fullyPaid: (Number(c.balance) || 0) <= 0.005,
      })),
      stillDue: dues.billsDue,
      openBills: dues.bills.length,
      link,
    });
    const res = await notifyBusinessEvent({
      businessId: input.businessId,
      eventKey: 'invoice_payment_received',
      to: head.customer_phone!,
      values: {
        customer_name: head.customer_name || 'Customer',
        business_name: head.business_name,
        invoice_number: cleared.map((c) => c.invoice_number).join(', ').slice(0, 120),
        amount_paid: money(amountPaid),
        amount_due: money(dues.billsDue),
        invoice_link: link,
      },
      fallbackText: text,
    });
    for (const c of cleared) {
      await query(
        `INSERT INTO whatsapp_messages (business_id, to_number, message_type, reference_type, reference_id, message_text, status, error_message)
         VALUES ($1, $2, 'payment', 'invoice', $3, $4, $5, $6)`,
        [
          input.businessId,
          head.customer_phone,
          c.invoice_id,
          text,
          res.via ? 'sent' : 'failed',
          res.via ? null : 'Payment received message was not delivered',
        ],
      );
    }
    return res.via ? { sent: true } : { sent: false, reason: 'not_delivered' };
  } catch (err) {
    console.error('[payment received] bills message failed:', err);
    return { sent: false, reason: 'error' };
  }
}
