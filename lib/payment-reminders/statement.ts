/**
 * One combined payment reminder per customer: a WhatsApp listing every unpaid bill with what to
 * pay now, the customer's ledger statement as a PDF (unpaid bills on top, ledger below), and one
 * link to the customer's public bills page (/b/<token>) where they pay all or some bills.
 *
 * Used when a customer with two or more unpaid bills is due a reminder; a customer with one bill
 * keeps the single-invoice reminder and that invoice's PDF.
 *
 * "To pay" is bills due less the customer's unadjusted advance. The advance is not set against the
 * bills automatically (that posts a GST reversal and stays a staff action in Advances); when it
 * covers everything, no reminder goes out.
 */
import { randomBytes, randomUUID } from 'crypto';
import puppeteer from 'puppeteer';
import { query, queryOne, queryRows } from '@/lib/db';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { getAppPublicOrigin } from '@/lib/customer-surface/urls';
import { buildCustomerStatementHtml, type StatementDueBill, type StatementDues } from '@/lib/party-statement-print';
import { computePartyStatement } from '@/lib/reports/party-statement';
import { checkLimit, hasFeature } from '@/lib/subscription';
import { FeatureKeys } from '@/lib/featureKeys';
import { toE164Digits } from '@/lib/platform-whatsapp-send';
import { businessTransport } from '@/lib/whatsapp/business-transport';
import { whatsAppOutboundReady } from '@/lib/whatsapp/outbound-ready';
import { resolveEventTemplate } from '@/lib/whatsapp/tenant-templates';
import { eventTemplateFailureMessage, sendEventTemplate } from '@/lib/whatsapp/tenant-send';
import type { ReminderSource } from '@/lib/reminder-message-processor';

/** Unpaid bills a reminder may chase. Same rule as single-invoice reminders. */
export const OPEN_BILL_SQL = `
  i.business_id = $1 AND i.customer_id = $2
  AND i.status = 'final' AND i.deleted_at IS NULL
  AND i.payment_status IN ('unpaid', 'partially_paid')
  AND COALESCE(i.balance_amount, 0) > 0.005
  AND COALESCE(i.document_type, 'tax_invoice') NOT IN ('proforma_invoice', 'quotation', 'delivery_challan')`;

/** At most this many bills are listed in the WhatsApp text; the PDF lists them all. */
const MAX_LISTED = 10;
/** A combined reminder of the same kind within this window is not sent twice. */
const DUPLICATE_WINDOW_HOURS = 12;

export type OpenBill = StatementDueBill & { id: string };

export type CustomerDues = Omit<StatementDues, 'bills'> & {
  bills: OpenBill[];
  overdue: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function customerBillsUrl(token: string): string {
  return `${getAppPublicOrigin()}/b/${encodeURIComponent(token)}`;
}

/** The customer's public bills token, made on first use. */
export async function ensureCustomerBillsToken(businessId: string, customerId: string): Promise<string> {
  const row = await queryOne<{ bills_public_token: string | null }>(
    `SELECT bills_public_token FROM customers WHERE id = $1 AND business_id = $2`,
    [customerId, businessId],
  );
  if (row?.bills_public_token) return row.bills_public_token;
  const token = randomBytes(18).toString('base64url');
  const set = await queryOne<{ bills_public_token: string }>(
    `UPDATE customers SET bills_public_token = COALESCE(bills_public_token, $3)
      WHERE id = $1 AND business_id = $2 RETURNING bills_public_token`,
    [customerId, businessId, token],
  );
  if (!set) throw new Error('Customer not found');
  return set.bills_public_token;
}

export async function loadOpenBills(businessId: string, customerId: string): Promise<OpenBill[]> {
  const rows = await queryRows<{
    id: string;
    invoice_number: string;
    invoice_date: string;
    due_date: string | null;
    grand_total: string;
    balance: string;
    days_overdue: number;
  }>(
    `SELECT i.id, i.invoice_number, i.invoice_date::text AS invoice_date, i.due_date::text AS due_date,
            i.grand_total::text, i.balance_amount::text AS balance,
            GREATEST(CURRENT_DATE - COALESCE(i.due_date, i.invoice_date)::date, 0)::int AS days_overdue
       FROM invoices i
      WHERE ${OPEN_BILL_SQL}
      ORDER BY COALESCE(i.due_date, i.invoice_date) ASC, i.invoice_date ASC, i.created_at ASC`,
    [businessId, customerId],
  );
  return rows.map((r) => ({
    id: r.id,
    invoice_number: r.invoice_number,
    invoice_date: String(r.invoice_date).slice(0, 10),
    due_date: r.due_date ? String(r.due_date).slice(0, 10) : null,
    grand_total: r2(Number(r.grand_total)),
    balance: r2(Number(r.balance)),
    days_overdue: Number(r.days_overdue) || 0,
  }));
}

/** Advance received from the customer and not yet set against a bill or refunded. */
export async function customerUnadjustedAdvance(businessId: string, customerId: string): Promise<number> {
  const row = await queryOne<{ amt: string }>(
    `SELECT COALESCE(SUM(GREATEST(amount - COALESCE(adjusted_amount, 0) - COALESCE(refunded_amount, 0), 0)), 0)::text AS amt
       FROM advance_payments
      WHERE business_id = $1 AND customer_id = $2 AND type = 'received'
        AND COALESCE(status, 'open') NOT IN ('cancelled', 'adjusted', 'refunded')`,
    [businessId, customerId],
  ).catch(() => null);
  return r2(Number(row?.amt ?? 0));
}

export async function customerDues(businessId: string, customerId: string): Promise<CustomerDues> {
  const bills = await loadOpenBills(businessId, customerId);
  const billsDue = r2(bills.reduce((s, b) => s + b.balance, 0));
  const advance = Math.min(await customerUnadjustedAdvance(businessId, customerId), billsDue);
  const overdue = r2(bills.filter((b) => b.days_overdue > 0).reduce((s, b) => s + b.balance, 0));
  return { bills, billsDue, advance: r2(advance), toPay: r2(Math.max(0, billsDue - advance)), overdue };
}

function money(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(ymd: string | null): string {
  if (!ymd) return '';
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Plain-text combined reminder (QR session, and the Cloud fallback text). */
export function statementReminderText(p: {
  customerName: string;
  businessName: string;
  dues: CustomerDues;
  link: string;
}): string {
  const { dues } = p;
  const lines = dues.bills.slice(0, MAX_LISTED).map((b) => {
    const when = b.days_overdue > 0 ? `overdue ${b.days_overdue} days` : `due ${shortDate(b.due_date || b.invoice_date)}`;
    return `• ${b.invoice_number}: ₹${money(b.balance)} (${when})`;
  });
  if (dues.bills.length > MAX_LISTED) lines.push(`• and ${dues.bills.length - MAX_LISTED} more`);
  const totals = [`Bills due: ₹${money(dues.billsDue)}`];
  if (dues.advance > 0.005) totals.push(`Less advance with us: ₹${money(dues.advance)}`);
  totals.push(`*To pay: ₹${money(dues.toPay)}*`);
  const link = p.link ? `\n\nView your statement and pay: ${p.link}` : '';
  return `Hi ${p.customerName},\n\nYou have ${dues.bills.length} unpaid bills with ${p.businessName}:\n${lines.join('\n')}\n\n${totals.join('\n')}${link}\n\nYour statement is attached. Please ignore if already paid.\n\nThank you!\n${p.businessName}`;
}

/** Ledger statement PDF from the oldest unpaid bill's date to today, unpaid bills on top. */
export async function generateCustomerStatementPdf(input: {
  businessId: string;
  customerId: string;
  dues: CustomerDues;
  link: string;
}): Promise<Buffer> {
  const party = await queryOne<{ name: string; phone: string | null; business_name: string; business_phone: string | null }>(
    `SELECT c.name, c.phone, b.name AS business_name, b.phone AS business_phone
       FROM customers c JOIN businesses b ON b.id = c.business_id
      WHERE c.id = $1 AND c.business_id = $2`,
    [input.customerId, input.businessId],
  );
  if (!party) throw new Error('Customer not found');
  const toDate = todayIst();
  const fromDate = input.dues.bills.reduce((min, b) => (b.invoice_date < min ? b.invoice_date : min), toDate);
  const statement = await computePartyStatement({
    businessId: input.businessId,
    partyType: 'customer',
    partyId: input.customerId,
    fromDate,
    toDate,
    branchFilter: null,
  });
  const html = buildCustomerStatementHtml({
    businessName: party.business_name,
    businessPhone: party.business_phone,
    partyName: party.name,
    partyPhone: party.phone,
    fromDate,
    toDate,
    openingBalance: statement.opening_balance,
    closingBalance: statement.closing_balance,
    transactions: statement.transactions,
    dues: { ...input.dues, payLink: input.link || null },
  });
  const browser = await puppeteer.launch(
    getPuppeteerLaunchOptions({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }),
  );
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    const buffer = Buffer.from(pdf);
    if (buffer.length === 0) throw new Error('Statement PDF is empty');
    return buffer;
  } finally {
    await browser.close();
  }
}

export type StatementReminderOutcome =
  | { outcome: 'sent'; invoices: number }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'failed'; reason: string };

/**
 * Sends one combined reminder to a customer. `chased` are the bills whose reminder is
 * due now; every unpaid bill is listed. The send is logged as one whatsapp_messages row per
 * chased bill plus every overdue bill in the message (so their overdue intervals line up), all
 * sharing one batch_id.
 */
export async function sendStatementReminder(input: {
  businessId: string;
  customerId: string;
  /** Bills whose reminder is due now, each with how it was triggered. */
  chased: { invoiceId: string; source: ReminderSource }[];
  /** Scheduled sends re-check plan, duplicates and limits; manual sends from the app already did. */
  scheduled: boolean;
}): Promise<StatementReminderOutcome> {
  const { businessId, customerId } = input;
  const manual = input.chased.some((c) => c.source === 'manual');
  if (input.scheduled && !(await hasFeature(businessId, FeatureKeys.WHATSAPP_AUTO_REMINDERS))) {
    return { outcome: 'skipped', reason: 'feature_not_on_plan' };
  }
  const customer = await queryOne<{ name: string; phone: string | null; business_name: string }>(
    `SELECT c.name, c.phone, b.name AS business_name FROM customers c JOIN businesses b ON b.id = c.business_id
      WHERE c.id = $1 AND c.business_id = $2 AND c.deleted_at IS NULL`,
    [customerId, businessId],
  );
  const to = customer?.phone ? toE164Digits(customer.phone) : null;
  if (!customer || !to) return { outcome: 'skipped', reason: 'no_phone' };

  const dues = await customerDues(businessId, customerId);
  const openIds = new Set(dues.bills.map((b) => b.id));
  const sourceOf = new Map(input.chased.filter((c) => openIds.has(c.invoiceId)).map((c) => [c.invoiceId, c.source]));
  const chased = [...sourceOf.keys()];
  if (chased.length === 0) return { outcome: 'skipped', reason: 'no_longer_due' };
  if (dues.toPay <= 0.005) return { outcome: 'skipped', reason: 'covered_by_advance' };

  if (input.scheduled) {
    const dup = await queryOne(
      `SELECT 1 FROM whatsapp_messages
        WHERE business_id = $1 AND reference_type = 'invoice' AND message_type = 'reminder' AND status = 'sent'
          AND batch_id IS NOT NULL AND reference_id = ANY($2::uuid[])
          AND sent_at > NOW() - ($3 || ' hours')::interval
        LIMIT 1`,
      [businessId, chased, String(DUPLICATE_WINDOW_HOURS)],
    );
    if (dup) return { outcome: 'skipped', reason: 'already_sent' };
    if (!(await checkLimit(businessId, 'whatsapp')).allowed) return { outcome: 'skipped', reason: 'limit_reached' };
  }

  const outbound = await whatsAppOutboundReady(businessId);
  if (!outbound.ready) {
    return { outcome: 'failed', reason: 'WhatsApp is not connected. Scan a QR code or connect the WhatsApp Business API.' };
  }

  const token = await ensureCustomerBillsToken(businessId, customerId);
  const link = customerBillsUrl(token);
  const text = statementReminderText({ customerName: customer.name || 'Customer', businessName: customer.business_name, dues, link });
  const filename = `Statement-${(customer.name || 'customer').replace(/[^\w.-]+/g, '_').slice(0, 40)}.pdf`;
  const batchId = randomUUID();
  const logIds = [...new Set([...chased, ...dues.bills.filter((b) => b.days_overdue > 0).map((b) => b.id)])];

  let providerMessageId: string | null = null;
  let loggedText = text;
  let error: string | null = null;
  let pdf: Buffer | undefined;
  try {
    const transport = await businessTransport(businessId);
    if (transport === 'cloud') {
      const resolved = await resolveEventTemplate(businessId, 'payment_statement_reminder');
      if (!resolved) {
        throw new Error(eventTemplateFailureMessage({ sent: false, reason: 'no_template' }, 'the combined payment reminder'));
      }
      if (resolved.template.header_format === 'document') {
        pdf = await generateCustomerStatementPdf({ businessId, customerId, dues, link });
      }
      const res = await sendEventTemplate({
        businessId,
        eventKey: 'payment_statement_reminder',
        to,
        values: {
          customer_name: customer.name || 'Customer',
          business_name: customer.business_name,
          bills_count: String(dues.bills.length),
          amount_due: money(dues.toPay),
          overdue_amount: money(dues.overdue),
          bills_link: link,
        },
        document: pdf ? { buffer: pdf, filename } : undefined,
      });
      if (!res.sent) throw new Error(eventTemplateFailureMessage(res, 'the combined payment reminder'));
      providerMessageId = res.messageId;
      loggedText = `[Meta template ${res.template}] ${text}`;
    } else {
      pdf = await generateCustomerStatementPdf({ businessId, customerId, dues, link });
      const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
      const sent = await sendWhatsAppMessage(businessId, to, text, pdf, 'text', undefined, undefined, {
        mimeType: 'application/pdf',
        fileName: filename,
      });
      providerMessageId = typeof sent === 'string' ? sent : null;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error('[statement reminder] send failed:', error);
  }

  const amountById = new Map(dues.bills.map((b) => [b.id, b.balance]));
  for (const invoiceId of error ? chased : logIds) {
    await query(
      `INSERT INTO whatsapp_messages (business_id, to_number, message_type, reference_type, reference_id, message_text,
          media_url, status, error_message, baileys_message_id, reminder_source, amount_due, batch_id)
       VALUES ($1, $2, 'reminder', 'invoice', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        businessId,
        customer.phone,
        invoiceId,
        loggedText,
        pdf ? 'blob:pdf' : null,
        error ? 'failed' : 'sent',
        error,
        providerMessageId,
        // Overdue bills riding along on an automatic message count as overdue reminders.
        sourceOf.get(invoiceId) ?? (manual ? 'manual' : 'auto_overdue'),
        amountById.get(invoiceId) ?? null,
        batchId,
      ],
    );
  }
  return error ? { outcome: 'failed', reason: error } : { outcome: 'sent', invoices: dues.bills.length };
}
