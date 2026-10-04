import * as db from '@/lib/db';
import { sendReminderMessage } from '@/lib/reminder-message-processor';
import { sendEmailReminder } from '@/lib/email-reminder';
import { checkLimit, hasFeature } from '@/lib/subscription';
import { FeatureKeys } from '@/lib/featureKeys';

export type PaymentReminderKind = 'payment_due' | 'overdue';

export interface PaymentReminderJobData {
  businessId: string;
  invoiceId: string;
  kind: PaymentReminderKind;
  messageTemplate: string;
  includePdf: boolean;
}

export type PaymentReminderOutcome =
  | { outcome: 'sent' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'failed'; reason: string };

const REMINDER_SOURCE: Record<PaymentReminderKind, 'auto_payment_due' | 'auto_overdue'> = {
  payment_due: 'auto_payment_due',
  overdue: 'auto_overdue',
};

/** A queued overdue reminder older than this would duplicate one sent by a later run. */
const OVERDUE_DUPLICATE_WINDOW_HOURS = 12;

async function createInvoiceNotification(
  businessId: string,
  kind: PaymentReminderKind,
  invoice: { id: string; invoice_number: string; customer_name: string | null; due_date: string; grand_total: unknown; balance_amount: unknown },
) {
  try {
    const type = kind === 'payment_due' ? 'invoice_nearing_due' : 'invoice_overdue';
    const amount =
      kind === 'payment_due'
        ? parseFloat(String(invoice.grand_total || 0))
        : parseFloat(String(invoice.balance_amount || invoice.grand_total || 0));
    const customer = invoice.customer_name || 'Customer';
    const due = new Date(invoice.due_date).toLocaleDateString('en-IN');
    const title =
      kind === 'payment_due'
        ? `Invoice ${invoice.invoice_number} due soon`
        : `Invoice ${invoice.invoice_number} is overdue`;
    const message =
      kind === 'payment_due'
        ? `${customer}'s invoice for ₹${amount.toFixed(2)} is due on ${due}`
        : `${customer}'s invoice for ₹${amount.toFixed(2)} was due on ${due}`;

    const existing = await db.queryOne(
      `SELECT id FROM notifications
       WHERE business_id = $1 AND type = $2 AND reference_id = $3 AND DATE(created_at) = CURRENT_DATE`,
      [businessId, type, invoice.id],
    );
    if (!existing) {
      await db.query(
        `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
         VALUES ($1, $2, $3, $4, 'invoice', $5, CURRENT_TIMESTAMP)`,
        [businessId, type, title, message, invoice.id],
      );
    }
  } catch (error) {
    console.error('[Reminder Delivery] Error creating invoice notification:', error);
  }
}

/**
 * Sends one scheduled payment reminder. Everything is re-checked at send time because a queued
 * job can run minutes after it was enqueued: the invoice may be paid, the plan may have lapsed,
 * the monthly limit may be used up, or another run may already have sent it.
 */
export async function deliverPaymentReminder(job: PaymentReminderJobData): Promise<PaymentReminderOutcome> {
  const { businessId, invoiceId, kind, messageTemplate, includePdf } = job;
  const source = REMINDER_SOURCE[kind];

  if (!(await hasFeature(businessId, FeatureKeys.WHATSAPP_AUTO_REMINDERS))) {
    return { outcome: 'skipped', reason: 'feature_not_on_plan' };
  }

  const invoice = await db.queryOne<{
    id: string;
    invoice_number: string;
    due_date: string;
    grand_total: unknown;
    balance_amount: unknown;
    customer_name: string | null;
  }>(
    `SELECT i.id, i.invoice_number, COALESCE(i.due_date, i.invoice_date) AS due_date,
            i.grand_total, i.balance_amount, c.name AS customer_name
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1 AND i.business_id = $2
       AND i.status = 'final'
       AND i.payment_status IN ('unpaid', 'partially_paid')
       AND c.phone IS NOT NULL AND c.phone != ''`,
    [invoiceId, businessId],
  );
  if (!invoice) return { outcome: 'skipped', reason: 'no_longer_due' };

  const alreadySent = await db.queryOne(
    `SELECT 1 FROM whatsapp_messages
     WHERE business_id = $1 AND reference_id = $2 AND reference_type = 'invoice'
       AND message_type = 'reminder' AND status = 'sent' AND reminder_source = $3
       ${kind === 'overdue' ? `AND sent_at > NOW() - INTERVAL '${OVERDUE_DUPLICATE_WINDOW_HOURS} hours'` : ''}
     LIMIT 1`,
    [businessId, invoiceId, source],
  );
  if (alreadySent) return { outcome: 'skipped', reason: 'already_sent' };

  const limit = await checkLimit(businessId, 'whatsapp');
  if (!limit.allowed) return { outcome: 'skipped', reason: 'limit_reached' };

  const result = await sendReminderMessage(invoiceId, businessId, messageTemplate, includePdf, source);

  if (result.success) {
    try {
      await sendEmailReminder({ invoiceId, businessId, messageTemplate, includePdf, kind });
    } catch (e) {
      console.error(`[Reminder Delivery] Email reminder (${kind}) failed for ${invoice.invoice_number}:`, e);
    }
  }

  await createInvoiceNotification(businessId, kind, invoice);

  return result.success
    ? { outcome: 'sent' }
    : { outcome: 'failed', reason: result.error || 'send_failed' };
}
