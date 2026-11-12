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

/** Bills picked for one reminder type in this run. */
interface ReminderSelection {
  kind: PaymentReminderKind;
  invoiceIds: string[];
  messageTemplate: string;
  includePdf: boolean;
  /** Not picked (interval not reached). */
  skipped: number;
}

type KindCounts = Record<PaymentReminderKind, ReminderRunResult>;

/**
 * Turns the picked bills into jobs: a customer with two or more unpaid bills gets ONE combined
 * reminder (statement PDF and pay-all link, lib/payment-reminders/statement.ts) covering every bill
 * picked for them by either reminder type; a customer with one bill gets the single-invoice
 * reminder. Then queues the jobs, or sends inline when the queue is unavailable.
 */
async function dispatchSelections(
  businessId: string,
  selections: ReminderSelection[],
  quota: number,
): Promise<KindCounts> {
  const counts: KindCounts = {
    payment_due: { ...EMPTY },
    overdue: { ...EMPTY },
  };
  for (const sel of selections) counts[sel.kind].skipped += sel.skipped;

  const allIds = selections.flatMap((s) => s.invoiceIds);
  if (allIds.length === 0) return counts;

  const owners = await db.queryRows<{ id: string; customer_id: string | null; open_count: number | null }>(
    `SELECT i.id, i.customer_id,
            (SELECT COUNT(*)::int FROM invoices o
              WHERE o.business_id = i.business_id AND o.customer_id = i.customer_id
                AND o.status = 'final' AND o.deleted_at IS NULL
                AND o.payment_status IN ('unpaid', 'partially_paid')
                AND COALESCE(o.balance_amount, 0) > 0.005
                AND COALESCE(o.document_type, 'tax_invoice') NOT IN ('proforma_invoice', 'quotation', 'delivery_challan')
            ) AS open_count
       FROM invoices i
      WHERE i.business_id = $1 AND i.id = ANY($2::uuid[])`,
    [businessId, allIds],
  );
  const ownerOf = new Map(
    (owners ?? [])
      .filter((o) => o && o.id && o.customer_id && Number(o.open_count) >= 2)
      .map((o) => [o.id, o.customer_id as string]),
  );

  const jobs: PaymentReminderJobData[] = [];
  const byCustomer = new Map<string, { invoiceId: string; kind: PaymentReminderKind }[]>();
  for (const sel of selections) {
    for (const invoiceId of sel.invoiceIds) {
      const customerId = ownerOf.get(invoiceId);
      if (customerId) {
        const list = byCustomer.get(customerId) ?? [];
        if (!list.some((c) => c.invoiceId === invoiceId)) list.push({ invoiceId, kind: sel.kind });
        byCustomer.set(customerId, list);
      } else {
        jobs.push({ businessId, invoiceId, kind: sel.kind, messageTemplate: sel.messageTemplate, includePdf: sel.includePdf });
      }
    }
  }
  for (const [customerId, chased] of byCustomer) {
    const kind: PaymentReminderKind = chased.some((c) => c.kind === 'overdue') ? 'overdue' : 'payment_due';
    jobs.push({
      businessId,
      invoiceId: chased[0].invoiceId,
      kind,
      messageTemplate: '',
      includePdf: true,
      statement: { customerId, chased },
    });
  }
  // Overdue first so the monthly limit goes to the oldest money.
  jobs.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'overdue' ? -1 : 1));
  const allowed = quota === Infinity ? jobs : jobs.slice(0, quota);
  for (const job of jobs.slice(allowed.length)) counts[job.kind].skipped++;
  if (allowed.length === 0) return counts;

  const transport = await businessTransport(businessId);
  const queued = await enqueuePaymentReminders(businessId, transport, allowed);
  if (queued !== null) {
    // Jobs already waiting in the queue are not queued twice; count them as skipped.
    let left = queued;
    for (const job of allowed) {
      if (left > 0) {
        counts[job.kind].queued++;
        left--;
      } else counts[job.kind].skipped++;
    }
    return counts;
  }

  const batch = transport === 'baileys' ? allowed.slice(0, INLINE_BAILEYS_MAX_PER_RUN) : allowed;
  for (const job of allowed.slice(batch.length)) counts[job.kind].skipped++;
  for (const [index, job] of batch.entries()) {
    if (transport === 'baileys' && index > 0) await sleep(randomGapMs(BAILEYS_SCHEDULED_GAP_MS));
    try {
      const outcome = await deliverPaymentReminder(job);
      if (outcome.outcome === 'sent') counts[job.kind].sent++;
      else counts[job.kind].skipped++;
    } catch (error) {
      counts[job.kind].errors++;
      console.error(`[Reminder Check] Error sending reminder for invoice ${job.invoiceId}:`, error);
    }
  }
  return counts;
}

/** How many more reminders fit under the monthly WhatsApp limit, or Infinity when unlimited. */
function remainingQuota(limitCheck: { limit: number; current: number }): number {
  return limitCheck.limit === -1 ? Infinity : Math.max(0, limitCheck.limit - limitCheck.current);
}

/** Bills due today through today + days before that have no "before due date" reminder yet. */
async function selectPaymentDue(businessId: string, timeZone: string): Promise<ReminderSelection | null> {
  {
    const settings = await db.queryOne(
      `SELECT enabled, days_before, message_template, include_pdf
       FROM whatsapp_reminder_settings
       WHERE business_id = $1 AND reminder_type = 'payment_due'`,
      [businessId]
    );

    if (!settings || !settings.enabled) return null;

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
    } else {
      const window = paymentDueWindow(timeZone, daysBefore);
      dueFrom = window.from;
      dueTo = window.to;
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
         -- Khata customers get one statement per settlement day instead (lib/khata/statements.ts).
         AND COALESCE(c.khata_enabled, false) = false
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

    return { kind: 'payment_due', invoiceIds: invoices.map((i) => i.id), messageTemplate, includePdf, skipped: 0 };
  }
}

/** Overdue bills whose last reminder is older than the repeat interval. */
async function selectOverdue(businessId: string, timeZone: string): Promise<ReminderSelection | null> {
  {
    const settings = await db.queryOne(
      `SELECT enabled, interval_days, message_template, include_pdf
       FROM whatsapp_reminder_settings
       WHERE business_id = $1 AND reminder_type = 'overdue'`,
      [businessId]
    );

    if (!settings || !settings.enabled) return null;

    const intervalDays = settings.interval_days || 7;
    const messageTemplate = settings.message_template || getDefaultOverdueTemplate();
    const includePdf = settings.include_pdf !== false;
    const localToday = calendarDateInTimeZone(timeZone);

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
         -- Khata customers get one statement per settlement day instead (lib/khata/statements.ts).
         AND COALESCE(c.khata_enabled, false) = false
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

    return { kind: 'overdue', invoiceIds: due, messageTemplate, includePdf, skipped };
  }
}

async function runSelections(
  businessId: string,
  pick: Array<() => Promise<ReminderSelection | null>>,
): Promise<KindCounts> {
  const empty: KindCounts = { payment_due: { ...EMPTY }, overdue: { ...EMPTY } };
  if (!(await hasFeature(businessId, FeatureKeys.WHATSAPP_AUTO_REMINDERS))) return empty;
  const limitCheck = await checkLimit(businessId, 'whatsapp');
  if (!limitCheck.allowed) return empty;
  const selections: ReminderSelection[] = [];
  for (const p of pick) {
    const sel = await p();
    if (sel) selections.push(sel);
  }
  return dispatchSelections(businessId, selections, remainingQuota(limitCheck));
}

/**
 * The daily run for one business: both reminder types are picked first, then grouped by customer,
 * so a customer with several bills due a reminder gets one combined message, not one per bill.
 */
export async function checkAndSendReminders(businessId: string, timeZone = 'Asia/Kolkata'): Promise<KindCounts> {
  try {
    return await runSelections(businessId, [
      () => selectPaymentDue(businessId, timeZone),
      () => selectOverdue(businessId, timeZone),
    ]);
  } catch (error) {
    console.error(`[Reminder Check] Error checking reminders for business ${businessId}:`, error);
    return { payment_due: { ...EMPTY, errors: 1 }, overdue: { ...EMPTY } };
  }
}

/** Payment due reminders only (kept for callers and tests that run one type). */
export async function checkAndSendPaymentDueReminders(
  businessId: string,
  timeZone = 'Asia/Kolkata',
): Promise<ReminderRunResult> {
  try {
    return (await runSelections(businessId, [() => selectPaymentDue(businessId, timeZone)])).payment_due;
  } catch (error) {
    console.error(`[Reminder Check] Error checking payment due reminders for business ${businessId}:`, error);
    return { ...EMPTY, errors: 1 };
  }
}

/** Overdue reminders only. */
export async function checkAndSendOverdueReminders(
  businessId: string,
  timeZone = 'Asia/Kolkata',
): Promise<ReminderRunResult> {
  try {
    return (await runSelections(businessId, [() => selectOverdue(businessId, timeZone)])).overdue;
  } catch (error) {
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
