import * as db from '@/lib/db';
import { checkLimit, hasFeature } from './subscription';
import { FeatureKeys } from '@/lib/featureKeys';
import { calendarDateInTimeZone, paymentDueWindow } from '@/lib/reminder-schedule';
import {
  deliverPaymentReminder,
  type PaymentReminderJobData,
  type PaymentReminderKind,
} from '@/lib/payment-reminder-delivery';
import { enqueuePaymentReminders } from '@/lib/queue/paymentReminderQueue';
import { businessTransport } from '@/lib/whatsapp/business-transport';
import { BAILEYS_SCHEDULED_GAP_MS, randomGapMs, sleep } from '@/lib/whatsapp/baileys-pacing';

export interface ReminderRunResult {
  /** Delivered during this request (inline fallback when the queue is unavailable). */
  sent: number;
  /** Handed to the payment-reminders queue; the worker sends them paced. */
  queued: number;
  skipped: number;
  errors: number;
}

const EMPTY: ReminderRunResult = { sent: 0, queued: 0, skipped: 0, errors: 0 };

/** Without Redis the cron request itself sends; QR sends are capped so the request stays bounded. */
export const INLINE_BAILEYS_MAX_PER_RUN = 50;

async function dispatchReminders(
  businessId: string,
  kind: PaymentReminderKind,
  invoiceIds: string[],
  messageTemplate: string,
  includePdf: boolean,
  skippedSoFar: number,
): Promise<ReminderRunResult> {
  if (invoiceIds.length === 0) return { ...EMPTY, skipped: skippedSoFar };

  const jobs: PaymentReminderJobData[] = invoiceIds.map((invoiceId) => ({
    businessId,
    invoiceId,
    kind,
    messageTemplate,
    includePdf,
  }));
  const transport = await businessTransport(businessId);

  const queued = await enqueuePaymentReminders(businessId, transport, jobs);
  if (queued !== null) {
    return { sent: 0, queued, skipped: skippedSoFar + (jobs.length - queued), errors: 0 };
  }

  const batch = transport === 'baileys' ? jobs.slice(0, INLINE_BAILEYS_MAX_PER_RUN) : jobs;
  if (batch.length < jobs.length) {
    console.log(
      `[Reminder Check] Queue unavailable; sending ${batch.length} of ${jobs.length} ${kind} reminders inline for QR business ${businessId}`,
    );
  }

  const result: ReminderRunResult = { ...EMPTY, skipped: skippedSoFar + (jobs.length - batch.length) };
  for (const [index, job] of batch.entries()) {
    if (transport === 'baileys' && index > 0) await sleep(randomGapMs(BAILEYS_SCHEDULED_GAP_MS));
    try {
      const outcome = await deliverPaymentReminder(job);
      if (outcome.outcome === 'sent') result.sent++;
      else {
        result.skipped++;
        console.log(`[Reminder Check] Invoice ${job.invoiceId} ${outcome.outcome}: ${outcome.reason}`);
      }
    } catch (error) {
      result.errors++;
      console.error(`[Reminder Check] Error sending reminder for invoice ${job.invoiceId}:`, error);
    }
  }
  return result;
}

/** How many more reminders fit under the monthly WhatsApp limit, or Infinity when unlimited. */
function remainingQuota(limitCheck: { limit: number; current: number }): number {
  return limitCheck.limit === -1 ? Infinity : Math.max(0, limitCheck.limit - limitCheck.current);
}

/**
 * Check and queue payment due reminders for a business
 */
export async function checkAndSendPaymentDueReminders(
  businessId: string,
  timeZone = 'Asia/Kolkata',
): Promise<ReminderRunResult> {
  try {
    const hasAccess = await hasFeature(businessId, FeatureKeys.WHATSAPP_AUTO_REMINDERS);
    if (!hasAccess) {
      console.log(`[Reminder Check] Business ${businessId} does not have whatsapp_auto_reminders feature`);
      return { ...EMPTY };
    }

    const settings = await db.queryOne(
      `SELECT enabled, days_before, message_template, include_pdf
       FROM whatsapp_reminder_settings
       WHERE business_id = $1 AND reminder_type = 'payment_due'`,
      [businessId]
    );

    if (!settings || !settings.enabled) {
      return { ...EMPTY };
    }

    const daysBefore = settings.days_before || 1;
    const messageTemplate = settings.message_template || getDefaultPaymentDueTemplate();
    /** false only when the business explicitly turned off "Include PDF"; default is attach. */
    const includePdf = settings.include_pdf !== false;

    // TEST MODE: set REMINDER_TEST_MINUTES=N in .env.local to treat days_before as minutes
    // e.g. REMINDER_TEST_MINUTES=2 means "due within next 2 minutes" instead of N days.
    // Remove / unset this variable to restore normal day-based behaviour.
    const testMinutes = process.env.REMINDER_TEST_MINUTES ? parseInt(process.env.REMINDER_TEST_MINUTES) : null;
    let dueFrom: string;
    let dueTo: string;
    if (testMinutes !== null && testMinutes > 0) {
      const targetDate = new Date(Date.now() + testMinutes * 60 * 1000);
      dueFrom = targetDate.toISOString().split('T')[0];
      dueTo = dueFrom;
      console.log(`[Reminder Check] 🧪 TEST MODE — matching invoices due on ${dueFrom} (${testMinutes}min from now instead of ${daysBefore} days)`);
    } else {
      const window = paymentDueWindow(timeZone, daysBefore);
      dueFrom = window.from;
      dueTo = window.to;
      console.log(`[Reminder Check] Matching invoices due ${dueFrom} through ${dueTo} (${timeZone}, days_before=${daysBefore})`);
    }

    const limitCheck = await checkLimit(businessId, 'whatsapp');
    if (!limitCheck.allowed) {
      console.log(`[Reminder Check] Business ${businessId} has reached WhatsApp limit`);
      return { ...EMPTY };
    }

    // Due today through today + days before, in the business calendar. A failed earlier attempt is retried.
    const invoices = await db.queryRows<{ id: string }>(
      `SELECT i.id
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.business_id = $1
         AND i.status = 'final'
         AND i.payment_status IN ('unpaid', 'partially_paid')
         AND DATE(COALESCE(i.due_date, i.invoice_date)) BETWEEN $2::date AND $3::date
         AND (c.phone IS NOT NULL AND c.phone != '')
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_messages wm
           WHERE wm.reference_id = i.id
             AND wm.message_type = 'reminder'
             AND wm.reference_type = 'invoice'
             AND wm.business_id = $1
             AND wm.status = 'sent'
             AND wm.reminder_source = 'auto_payment_due'
         )
       ORDER BY COALESCE(i.due_date, i.invoice_date), i.id`,
      [businessId, dueFrom, dueTo]
    );

    const quota = remainingQuota(limitCheck);
    if (invoices.length > quota) {
      console.log(`[Reminder Check] Reached WhatsApp limit for business ${businessId}`);
    }
    const selected = invoices.slice(0, quota === Infinity ? undefined : quota).map((i) => i.id);

    return await dispatchReminders(
      businessId,
      'payment_due',
      selected,
      messageTemplate,
      includePdf,
      invoices.length - selected.length,
    );
  } catch (error: any) {
    console.error(`[Reminder Check] Error checking payment due reminders for business ${businessId}:`, error);
    return { ...EMPTY, errors: 1 };
  }
}

/**
 * Check and queue overdue reminders for a business
 */
export async function checkAndSendOverdueReminders(
  businessId: string,
  timeZone = 'Asia/Kolkata',
): Promise<ReminderRunResult> {
  try {
    const hasAccess = await hasFeature(businessId, FeatureKeys.WHATSAPP_AUTO_REMINDERS);
    if (!hasAccess) {
      console.log(`[Reminder Check] Business ${businessId} does not have whatsapp_auto_reminders feature`);
      return { ...EMPTY };
    }

    const settings = await db.queryOne(
      `SELECT enabled, interval_days, message_template, include_pdf
       FROM whatsapp_reminder_settings
       WHERE business_id = $1 AND reminder_type = 'overdue'`,
      [businessId]
    );

    if (!settings || !settings.enabled) {
      return { ...EMPTY };
    }

    const intervalDays = settings.interval_days || 7;
    const messageTemplate = settings.message_template || getDefaultOverdueTemplate();
    const includePdf = settings.include_pdf !== false;
    const localToday = calendarDateInTimeZone(timeZone);

    const limitCheck = await checkLimit(businessId, 'whatsapp');
    if (!limitCheck.allowed) {
      console.log(`[Reminder Check] Business ${businessId} has reached WhatsApp limit`);
      return { ...EMPTY };
    }

    const invoices = await db.queryRows<{ id: string; last_reminder_sent: string | null }>(
      `SELECT
        i.id,
        (
          SELECT MAX(sent_at)
          FROM whatsapp_messages wm
          WHERE wm.reference_id = i.id
            AND wm.message_type = 'reminder'
            AND wm.reference_type = 'invoice'
            AND wm.business_id = $1
            AND wm.status = 'sent'
        ) as last_reminder_sent
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.business_id = $1
         AND i.status = 'final'
         AND i.payment_status IN ('unpaid', 'partially_paid')
         AND DATE(COALESCE(i.due_date, i.invoice_date)) < $2::date
         AND (c.phone IS NOT NULL AND c.phone != '')
       ORDER BY COALESCE(i.due_date, i.invoice_date), i.id`,
      [businessId, localToday]
    );

    // TEST MODE: same env flag — interval treated as minutes instead of days
    const testMinutesOverdue = process.env.REMINDER_TEST_MINUTES ? parseInt(process.env.REMINDER_TEST_MINUTES) : null;

    let skipped = 0;
    const due: string[] = [];
    for (const invoice of invoices) {
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
      due.push(invoice.id);
    }

    const quota = remainingQuota(limitCheck);
    if (due.length > quota) {
      console.log(`[Reminder Check] Reached WhatsApp limit for business ${businessId}`);
    }
    const selected = due.slice(0, quota === Infinity ? undefined : quota);

    return await dispatchReminders(
      businessId,
      'overdue',
      selected,
      messageTemplate,
      includePdf,
      skipped + (due.length - selected.length),
    );
  } catch (error: any) {
    console.error(`[Reminder Check] Error checking overdue reminders for business ${businessId}:`, error);
    return { ...EMPTY, errors: 1 };
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
