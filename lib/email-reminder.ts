/**
 * Automated invoice payment reminders via email (cron / reminder checker).
 * Plan-gated with {@link FeatureKeys.EMAIL_REMINDERS}.
 */

import * as db from '@/lib/db';
import { sendBusinessEmail, type BusinessEmailSendOptions } from '@/lib/business-email';
import { generateInvoicePdf } from '@/lib/pdf-generator';
import { FeatureKeys } from '@/lib/featureKeys';
import { hasFeature } from '@/lib/subscription';
import { processTemplate } from '@/lib/reminder-message-processor';

export type EmailReminderKind = 'payment_due' | 'overdue';

/**
 * Email counterpart to WhatsApp reminder: same template placeholders, optional PDF attachment.
 *
 * Call after WhatsApp succeeds so invoice dedupe in `whatsapp_messages`
 * aligns with email frequency for the same cron sweep.
 *
 * @returns whether email was accepted by SMTP (same semantics as {@link sendEmail})
 */
export async function sendEmailReminder(params: {
  invoiceId: string;
  businessId: string;
  messageTemplate: string;
  includePdf: boolean;
  kind: EmailReminderKind;
}): Promise<{ success: boolean; error?: string }> {
  const { invoiceId, businessId, messageTemplate, includePdf, kind } = params;

  try {
    const gated = await hasFeature(businessId, FeatureKeys.EMAIL_REMINDERS);
    if (!gated) {
      return { success: false, error: 'email_reminders_not_enabled' };
    }

    const invoice = await db.queryOne(
      `SELECT 
        i.*,
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        b.name as business_name,
        b.phone as business_phone,
        b.email as business_email
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       JOIN businesses b ON i.business_id = b.id
       WHERE i.id = $1 AND i.business_id = $2`,
      [invoiceId, businessId]
    );

    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    const rawEmail = (invoice.customer_email ?? '').trim();
    if (!rawEmail || !rawEmail.includes('@')) {
      return { success: false, error: 'Customer email not available' };
    }

    const customer = {
      name: invoice.customer_name || 'Cash Sale',
      phone: invoice.customer_phone,
      email: invoice.customer_email,
    };

    const biz = {
      name: invoice.business_name,
      phone: invoice.business_phone,
      email: invoice.business_email,
    };

    const bodyText = processTemplate(messageTemplate, invoice, customer, biz);
    const invoiceNo = invoice.invoice_number || '—';

    let attachments: BusinessEmailSendOptions['attachments'];
    if (includePdf) {
      try {
        const pdfBuffer = await generateInvoicePdf(invoiceId);
        if (!pdfBuffer || pdfBuffer.length === 0) {
          return { success: false, error: 'Invoice PDF is empty' };
        }
        attachments = [
          {
            filename: `invoice-${invoiceNo.replace(/\s+/g, '_')}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ];
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Email Reminder] PDF generation failed:', e);
        return {
          success: false,
          error: msg ? `Could not generate invoice PDF: ${msg}` : 'Could not generate invoice PDF',
        };
      }
    }

    const prefix =
      kind === 'overdue'
        ? 'Payment overdue:'
        : 'Payment reminder:';

    const result = await sendBusinessEmail(businessId, {
      to: rawEmail,
      subject: `${prefix} Invoice ${invoiceNo}`,
      html: `
        <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#222;max-width:560px;">
          ${bodyText.split('\n').map((line: string) => `<p style="margin:6px 0">${escapeHtml(line)}</p>`).join('\n')}
        </div>`,
      text: bodyText,
      attachments,
    });

    if (!result.success) {
      return { success: false, error: result.error || 'send_email_failed' };
    }

    console.log(`[Email Reminder] Sent ${kind} for invoice ${invoiceNo} (${invoiceId})`);
    return { success: true };
  } catch (error: unknown) {
    console.error('[Email Reminder] Unexpected error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
