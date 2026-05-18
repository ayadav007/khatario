import * as db from '@/lib/db';
import { sendReminderMessage } from './reminder-message-processor';
import { sendEmailReminder } from './email-reminder';
import { checkLimit, hasFeature } from './subscription';
import { FeatureKeys } from '@/lib/featureKeys';

/**
 * Create notification for business owner about invoice status
 */
async function createInvoiceNotification(
  businessId: string,
  type: 'invoice_nearing_due' | 'invoice_overdue',
  invoiceId: string,
  invoiceNumber: string,
  customerName: string,
  dueDate: string,
  amount: number
) {
  try {
    const notificationType = type === 'invoice_nearing_due' ? 'invoice_nearing_due' : 'invoice_overdue';
    const title = type === 'invoice_nearing_due' 
      ? `Invoice ${invoiceNumber} due soon`
      : `Invoice ${invoiceNumber} is overdue`;
    
    const message = type === 'invoice_nearing_due'
      ? `${customerName || 'Customer'}'s invoice for ₹${amount.toFixed(2)} is due on ${new Date(dueDate).toLocaleDateString('en-IN')}`
      : `${customerName || 'Customer'}'s invoice for ₹${amount.toFixed(2)} was due on ${new Date(dueDate).toLocaleDateString('en-IN')}`;

    // Check if notification already exists for this invoice today
    const existing = await db.queryOne(
      `SELECT id FROM notifications 
       WHERE business_id = $1 
         AND type = $2 
         AND reference_id = $3 
         AND DATE(created_at) = CURRENT_DATE`,
      [businessId, notificationType, invoiceId]
    );

    if (!existing) {
      await db.query(
        `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
         VALUES ($1, $2, $3, $4, 'invoice', $5, CURRENT_TIMESTAMP)`,
        [businessId, notificationType, title, message, invoiceId]
      );
    }
  } catch (error: any) {
    console.error(`Error creating invoice notification:`, error);
    // Don't throw - notification failure shouldn't break reminder process
  }
}

/**
 * Check and send payment due reminders for a business
 */
export async function checkAndSendPaymentDueReminders(businessId: string): Promise<{ sent: number; skipped: number; errors: number }> {
  try {
    // Check if feature is enabled
    const hasAccess = await hasFeature(businessId, FeatureKeys.WHATSAPP_AUTO_REMINDERS);
    if (!hasAccess) {
      console.log(`[Reminder Check] Business ${businessId} does not have whatsapp_auto_reminders feature`);
      return { sent: 0, skipped: 0, errors: 0 };
    }

    // Get payment due reminder settings
    const settings = await db.queryOne(
      `SELECT enabled, days_before, message_template, include_pdf
       FROM whatsapp_reminder_settings
       WHERE business_id = $1 AND reminder_type = 'payment_due'`,
      [businessId]
    );

    if (!settings || !settings.enabled) {
      return { sent: 0, skipped: 0, errors: 0 };
    }

    const daysBefore = settings.days_before || 1;
    const messageTemplate = settings.message_template || getDefaultPaymentDueTemplate();
    /** false only when the business explicitly turned off "Include PDF"; default is attach. */
    const includePdf = settings.include_pdf !== false;

    // TEST MODE: set REMINDER_TEST_MINUTES=N in .env.local to treat days_before as minutes
    // e.g. REMINDER_TEST_MINUTES=2 means "due within next 2 minutes" instead of N days.
    // Remove / unset this variable to restore normal day-based behaviour.
    const testMinutes = process.env.REMINDER_TEST_MINUTES ? parseInt(process.env.REMINDER_TEST_MINUTES) : null;
    let targetDateStr: string;
    if (testMinutes !== null && testMinutes > 0) {
      const targetDate = new Date(Date.now() + testMinutes * 60 * 1000);
      targetDateStr = targetDate.toISOString().split('T')[0];
      console.log(`[Reminder Check] 🧪 TEST MODE — matching invoices due on ${targetDateStr} (${testMinutes}min from now instead of ${daysBefore} days)`);
    } else {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysBefore);
      targetDateStr = targetDate.toISOString().split('T')[0];
      console.log(`[Reminder Check] Normal mode — matching invoices due on ${targetDateStr} (days_before=${daysBefore})`);
    }

    // Check WhatsApp limit
    const limitCheck = await checkLimit(businessId, 'whatsapp');
    if (!limitCheck.allowed) {
      console.log(`[Reminder Check] Business ${businessId} has reached WhatsApp limit`);
      return { sent: 0, skipped: 0, errors: 0 };
    }

    // Find invoices that are due on target date
    const invoices = await db.queryRows(
      `SELECT 
        i.id,
        i.invoice_number,
        i.due_date,
        i.payment_status,
        i.grand_total,
        i.balance_amount,
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.business_id = $1
         AND i.status = 'final'
         AND i.payment_status IN ('unpaid', 'partially_paid')
         AND DATE(COALESCE(i.due_date, i.invoice_date)) = $2
         AND (c.phone IS NOT NULL AND c.phone != '')
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_messages wm
           WHERE wm.reference_id = i.id
             AND wm.message_type = 'reminder'
             AND wm.reference_type = 'invoice'
             AND wm.business_id = $1
         )`,
      [businessId, targetDateStr]
    );

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const invoice of invoices) {
      // Check if we've reached the limit
      if (limitCheck.limit !== -1 && (limitCheck.current + sent) >= limitCheck.limit) {
        console.log(`[Reminder Check] Reached WhatsApp limit for business ${businessId}`);
        break;
      }

      try {
        const result = await sendReminderMessage(
          invoice.id,
          businessId,
          messageTemplate,
          includePdf,
          'auto_payment_due'
        );

        if (result.success) {
          sent++;
        } else {
          skipped++;
          console.log(`[Reminder Check] Skipped invoice ${invoice.invoice_number}: ${result.error}`);
        }

        if (result.success) {
          try {
            await sendEmailReminder({
              invoiceId: invoice.id,
              businessId,
              messageTemplate,
              includePdf,
              kind: 'payment_due',
            });
          } catch (e) {
            console.error(`[Reminder Check] Email reminder (payment due) failed for ${invoice.invoice_number}:`, e);
          }
        }

        // Create notification for business owner (regardless of WhatsApp success)
        await createInvoiceNotification(
          businessId,
          'invoice_nearing_due',
          invoice.id,
          invoice.invoice_number,
          invoice.customer_name || 'Customer',
          invoice.due_date,
          parseFloat(invoice.grand_total || 0)
        );
      } catch (error: any) {
        errors++;
        console.error(`[Reminder Check] Error sending reminder for invoice ${invoice.invoice_number}:`, error);
      }
    }

    return { sent, skipped, errors };
  } catch (error: any) {
    console.error(`[Reminder Check] Error checking payment due reminders for business ${businessId}:`, error);
    return { sent: 0, skipped: 0, errors: 1 };
  }
}

/**
 * Check and send overdue reminders for a business
 */
export async function checkAndSendOverdueReminders(businessId: string): Promise<{ sent: number; skipped: number; errors: number }> {
  try {
    // Check if feature is enabled
    const hasAccess = await hasFeature(businessId, FeatureKeys.WHATSAPP_AUTO_REMINDERS);
    if (!hasAccess) {
      console.log(`[Reminder Check] Business ${businessId} does not have whatsapp_auto_reminders feature`);
      return { sent: 0, skipped: 0, errors: 0 };
    }

    // Get overdue reminder settings
    const settings = await db.queryOne(
      `SELECT enabled, interval_days, message_template, include_pdf
       FROM whatsapp_reminder_settings
       WHERE business_id = $1 AND reminder_type = 'overdue'`,
      [businessId]
    );

    if (!settings || !settings.enabled) {
      return { sent: 0, skipped: 0, errors: 0 };
    }

    const intervalDays = settings.interval_days || 7;
    const messageTemplate = settings.message_template || getDefaultOverdueTemplate();
    const includePdf = settings.include_pdf !== false;

    // Check WhatsApp limit
    const limitCheck = await checkLimit(businessId, 'whatsapp');
    if (!limitCheck.allowed) {
      console.log(`[Reminder Check] Business ${businessId} has reached WhatsApp limit`);
      return { sent: 0, skipped: 0, errors: 0 };
    }

    // Find overdue invoices
    const invoices = await db.queryRows(
      `SELECT 
        i.id,
        i.invoice_number,
        i.due_date,
        i.payment_status,
        i.grand_total,
        i.balance_amount,
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        (
          SELECT MAX(sent_at)
          FROM whatsapp_messages wm
          WHERE wm.reference_id = i.id
            AND wm.message_type = 'reminder'
            AND wm.reference_type = 'invoice'
            AND wm.business_id = $1
        ) as last_reminder_sent
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.business_id = $1
         AND i.status = 'final'
         AND i.payment_status IN ('unpaid', 'partially_paid')
         AND DATE(COALESCE(i.due_date, i.invoice_date)) < CURRENT_DATE
         AND (c.phone IS NOT NULL AND c.phone != '')`,
      [businessId]
    );

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    // TEST MODE: same env flag — interval treated as minutes instead of days
    const testMinutesOverdue = process.env.REMINDER_TEST_MINUTES ? parseInt(process.env.REMINDER_TEST_MINUTES) : null;

    for (const invoice of invoices) {
      // Check if we should send reminder based on interval
      if (invoice.last_reminder_sent) {
        const lastSent = new Date(invoice.last_reminder_sent);
        let shouldSkip: boolean;
        if (testMinutesOverdue !== null && testMinutesOverdue > 0) {
          const minutesSinceLast = (Date.now() - lastSent.getTime()) / (1000 * 60);
          shouldSkip = minutesSinceLast < testMinutesOverdue;
          if (shouldSkip) console.log(`[Reminder Check] 🧪 TEST MODE — skipping overdue (last sent ${minutesSinceLast.toFixed(1)}min ago, interval ${testMinutesOverdue}min)`);
        } else {
          const daysSinceLastReminder = Math.floor((Date.now() - lastSent.getTime()) / (1000 * 60 * 60 * 24));
          shouldSkip = daysSinceLastReminder < intervalDays;
        }
        if (shouldSkip) {
          skipped++;
          continue;
        }
      }

      // Check if we've reached the limit
      if (limitCheck.limit !== -1 && (limitCheck.current + sent) >= limitCheck.limit) {
        console.log(`[Reminder Check] Reached WhatsApp limit for business ${businessId}`);
        break;
      }

      try {
        const result = await sendReminderMessage(
          invoice.id,
          businessId,
          messageTemplate,
          includePdf,
          'auto_overdue'
        );

        if (result.success) {
          sent++;
        } else {
          skipped++;
          console.log(`[Reminder Check] Skipped invoice ${invoice.invoice_number}: ${result.error}`);
        }

        if (result.success) {
          try {
            await sendEmailReminder({
              invoiceId: invoice.id,
              businessId,
              messageTemplate,
              includePdf,
              kind: 'overdue',
            });
          } catch (e) {
            console.error(`[Reminder Check] Email reminder (overdue) failed for ${invoice.invoice_number}:`, e);
          }
        }

        // Create notification for business owner (regardless of WhatsApp success)
        await createInvoiceNotification(
          businessId,
          'invoice_overdue',
          invoice.id,
          invoice.invoice_number,
          invoice.customer_name || 'Customer',
          invoice.due_date,
          parseFloat(invoice.balance_amount || invoice.grand_total || 0)
        );
      } catch (error: any) {
        errors++;
        console.error(`[Reminder Check] Error sending reminder for invoice ${invoice.invoice_number}:`, error);
      }
    }

    return { sent, skipped, errors };
  } catch (error: any) {
    console.error(`[Reminder Check] Error checking overdue reminders for business ${businessId}:`, error);
    return { sent: 0, skipped: 0, errors: 1 };
  }
}

/**
 * Default payment due message template
 */
function getDefaultPaymentDueTemplate(): string {
  return `Hi {customer_name},

This is a friendly reminder that invoice {invoice_no} for {amount} is due on {due_date}.

Please arrange payment at your earliest convenience.

Thank you!
{business_name}`;
}

/**
 * Default overdue message template
 */
function getDefaultOverdueTemplate(): string {
  return `Hi {customer_name},

Invoice {invoice_no} for {balance_amount} is now overdue. The due date was {due_date}.

Please arrange payment immediately to avoid any inconvenience.

Thank you!
{business_name}`;
}

