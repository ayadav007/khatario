/**
 * Rule-based GST compliance checks. Pure functions over data the engine loads, so each rule is
 * testable without a database. The law decides the rule; the business's own books decide whether
 * it applies. Nothing here is tax advice: every alert names its provision and suggests a CA.
 */
import { daysBetween, RULE37_DAYS, type Rule37Row } from '@/lib/gst/rule37';
import {
  calculateLateFee,
  gstr3bDueDateIso,
  LATE_FEE_CAP_NORMAL_INR,
  LATE_FEE_PER_DAY_NIL_RETURN_INR,
  LATE_FEE_PER_DAY_NORMAL_INR,
  type Gstr3BDueDateOptions,
} from '@/lib/gst/gst-interest';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type ComplianceCheckId =
  | 'rule37'
  | 'itc_deadline'
  | 'credit_note_deadline'
  | 'gstr3b_due'
  | 'eway_bill'
  | 'einvoice'
  | 'rcm_self_invoice';

export const ALL_CHECKS: ComplianceCheckId[] = [
  'rule37',
  'itc_deadline',
  'credit_note_deadline',
  'gstr3b_due',
  'eway_bill',
  'einvoice',
  'rcm_self_invoice',
];

/** Composition dealers take no ITC and file CMP-08, not GSTR-3B, but e-way bills and RCM still apply. */
export const COMPOSITION_CHECKS: ComplianceCheckId[] = ['eway_bill', 'rcm_self_invoice'];

export interface ComplianceFinding {
  checkId: ComplianceCheckId;
  /** Stable per business: one alert row per key. */
  key: string;
  severity: AlertSeverity;
  /** Milestone within the alert; a new stage re-notifies, the same stage never does. */
  stage: string;
  title: string;
  message: string;
  legalRef: string;
  actionUrl: string | null;
  actionLabel: string | null;
  askQuestion: string;
  dueDate: string | null;
  amount: number | null;
  details: Record<string, unknown>;
  /** Shown on the alerts page but never sent to the bell: for heuristics that may not apply. */
  quiet?: boolean;
}

export const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Bucket "days left" into a few milestones so an alert re-notifies a handful of times, not daily. */
export function daysLeftStage(daysLeft: number, buckets: number[]): string | null {
  const sorted = [...buckets].sort((a, b) => a - b);
  for (const b of sorted) if (daysLeft <= b) return `${b}d`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Rule 37: supplier bills unpaid for 180 days
// ---------------------------------------------------------------------------------------------

export interface Rule37BillInput extends Rule37Row {
  supplier_name?: string | null;
}

const headsTotal = (h: { igst: number; cgst: number; sgst: number; cess: number }) => h.igst + h.cgst + h.sgst + h.cess;

export function rule37Findings(bills: Rule37BillInput[], asOn: string): ComplianceFinding[] {
  const out: ComplianceFinding[] = [];
  const itcShare = (b: Rule37BillInput) => {
    const total = headsTotal(b.itc_claimed);
    return b.grand_total > 0 ? round2((total * Math.min(1, b.unpaid / b.grand_total))) : 0;
  };
  const brief = (b: Rule37BillInput) => ({
    purchase_id: b.purchase_id,
    bill_number: b.bill_number,
    bill_date: b.bill_date,
    supplier_name: b.supplier_name ?? null,
    unpaid: round2(b.unpaid),
    itc_at_stake: itcShare(b),
    days_outstanding: b.days_outstanding,
  });

  const approaching = bills.filter((b) => b.status === 'approaching' && b.unpaid >= 1);
  if (approaching.length) {
    const earliest = approaching.reduce((a, b) => (b.days_outstanding > a.days_outstanding ? b : a));
    const daysLeft = RULE37_DAYS - earliest.days_outstanding;
    const payBy = addDays(earliest.bill_date, RULE37_DAYS);
    const atStake = round2(approaching.reduce((s, b) => s + itcShare(b), 0));
    out.push({
      checkId: 'rule37',
      key: 'rule37:approaching',
      severity: daysLeft <= 7 ? 'critical' : 'warning',
      stage: daysLeftStage(daysLeft, [7, 15, 30]) ?? '30d',
      title: `Pay ${plural(approaching.length, 'supplier bill')} soon to keep ${inr(atStake)} ITC`,
      message:
        `${plural(approaching.length, 'bill')} will cross 180 days unpaid, the first on ${formatDate(payBy)}. ` +
        `If a supplier is not paid within 180 days of the bill date, the input tax credit on the unpaid part must be reversed ` +
        `with interest. It can be claimed again once you pay.`,
      legalRef: 'CGST Act, Section 16(2) second proviso; CGST Rules, Rule 37',
      actionUrl: '/purchases',
      actionLabel: 'Open purchases',
      askQuestion: 'What happens to ITC if I do not pay my supplier within 180 days? (Rule 37)',
      dueDate: payBy,
      amount: atStake,
      details: { bills: approaching.sort((a, b) => b.days_outstanding - a.days_outstanding).slice(0, 20).map(brief) },
    });
  }

  const pending = bills.filter((b) => headsTotal(b.target_reversal) - headsTotal(b.already_reversed) >= 1);
  if (pending.length) {
    const toReverse = round2(pending.reduce((s, b) => s + headsTotal(b.target_reversal) - headsTotal(b.already_reversed), 0));
    out.push({
      checkId: 'rule37',
      key: 'rule37:reversal_pending',
      severity: 'critical',
      stage: 'pending',
      title: `Reverse ${inr(toReverse)} ITC on bills unpaid for over 180 days`,
      message:
        `${plural(pending.length, 'supplier bill')} ${pending.length === 1 ? 'is' : 'are'} unpaid for more than 180 days. ` +
        `The ITC on the unpaid part has to be reversed in your next GSTR-3B, with interest if that credit was already used. ` +
        `Post the reversal here; Khatario re-claims it automatically in the books when you pay the supplier.`,
      legalRef: 'CGST Act, Section 16(2) second proviso and Section 50; CGST Rules, Rule 37',
      actionUrl: null,
      actionLabel: 'Post ITC reversal',
      askQuestion: 'How do I reverse ITC for supplier bills unpaid for 180 days under Rule 37?',
      dueDate: asOn,
      amount: toReverse,
      details: {
        bills: pending.slice(0, 20).map((b) => ({ ...brief(b), to_reverse: round2(headsTotal(b.target_reversal) - headsTotal(b.already_reversed)) })),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 30 November: last date for last year's ITC (s.16(4)) and GST-reducing credit notes (s.34(2))
// ---------------------------------------------------------------------------------------------

export interface FyDeadlineWindow {
  fyLabel: string;
  fyStart: string;
  fyEnd: string;
  deadline: string;
  daysLeft: number;
}

/** The FY whose 30 November deadline is still ahead of `asOn` (April to November only). */
export function currentFyDeadline(asOn: string): FyDeadlineWindow | null {
  const year = Number(asOn.slice(0, 4));
  const month = Number(asOn.slice(5, 7));
  if (month < 4) return null;
  const deadline = `${year}-11-30`;
  const daysLeft = daysBetween(asOn, deadline);
  if (daysLeft < 0) return null;
  return {
    fyLabel: `FY ${year - 1}-${String(year).slice(2)}`,
    fyStart: `${year - 1}-04-01`,
    fyEnd: `${year}-03-31`,
    deadline,
    daysLeft,
  };
}

export interface UnbookedItcDoc {
  supplier_gstin: string;
  supplier_name: string | null;
  invoice_number: string;
  invoice_date: string;
  itc: number;
}

export const ITC_DEADLINE_WINDOW_DAYS = 60;
export const CREDIT_NOTE_WINDOW_DAYS = 30;

export function itcDeadlineFinding(asOn: string, docs: UnbookedItcDoc[]): ComplianceFinding | null {
  const w = currentFyDeadline(asOn);
  if (!w || w.daysLeft > ITC_DEADLINE_WINDOW_DAYS) return null;
  const inFy = docs.filter((d) => d.invoice_date >= w.fyStart && d.invoice_date <= w.fyEnd && d.itc >= 1);
  if (!inFy.length) return null;
  const total = round2(inFy.reduce((s, d) => s + d.itc, 0));
  return {
    checkId: 'itc_deadline',
    key: `itc_deadline:${w.fyLabel}`,
    severity: w.daysLeft <= 15 ? 'critical' : 'warning',
    stage: daysLeftStage(w.daysLeft, [1, 7, 15, 30, 60]) ?? '60d',
    title: `Claim ${inr(total)} ${w.fyLabel} ITC by ${formatDate(w.deadline)}`,
    message:
      `${plural(inFy.length, 'supplier invoice')} from ${w.fyLabel} ${inFy.length === 1 ? 'is' : 'are'} in your GSTR-2B but not in your purchase books. ` +
      `ITC on ${w.fyLabel} invoices cannot be taken after ${formatDate(w.deadline)}. Record these purchases, or mark them as not eligible in GSTR-2B reconciliation.`,
    legalRef: 'CGST Act, Section 16(4)',
    actionUrl: '/reports/gst/gstr2b-reconciliation',
    actionLabel: 'Open GSTR-2B reconciliation',
    askQuestion: `What is the last date to claim input tax credit for ${w.fyLabel} invoices? (Section 16(4))`,
    dueDate: w.deadline,
    amount: total,
    details: {
      fy: w.fyLabel,
      days_left: w.daysLeft,
      invoices: [...inFy].sort((a, b) => b.itc - a.itc).slice(0, 20),
    },
  };
}

export function creditNoteDeadlineFinding(asOn: string, fySalesCount: number): ComplianceFinding | null {
  const w = currentFyDeadline(asOn);
  if (!w || w.daysLeft > CREDIT_NOTE_WINDOW_DAYS || fySalesCount <= 0) return null;
  return {
    checkId: 'credit_note_deadline',
    key: `credit_note_deadline:${w.fyLabel}`,
    severity: w.daysLeft <= 7 ? 'warning' : 'info',
    stage: daysLeftStage(w.daysLeft, [7, 30]) ?? '30d',
    title: `Last date for ${w.fyLabel} credit notes: ${formatDate(w.deadline)}`,
    message:
      `A credit note (for a return, discount or rate correction) reduces GST on a ${w.fyLabel} invoice only if it is issued and reported by ${formatDate(w.deadline)}. ` +
      `After that the credit note can still settle the customer's balance, but the GST already paid does not come down.`,
    legalRef: 'CGST Act, Section 34(2)',
    actionUrl: '/credit-notes/new',
    actionLabel: 'Create a credit note',
    askQuestion: `What is the time limit to issue a credit note for ${w.fyLabel} invoices? (Section 34)`,
    dueDate: w.deadline,
    amount: null,
    details: { fy: w.fyLabel, days_left: w.daysLeft, invoices_in_fy: fySalesCount },
  };
}

// ---------------------------------------------------------------------------------------------
// GSTR-3B due dates and late fee
// ---------------------------------------------------------------------------------------------

export const GSTR3B_REMIND_DAYS = 5;

function shiftMonth(period: string, delta: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + delta;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

export const FILING_TRACKING_MONTHS = 6;

/** Earliest period (YYYY-MM) whose recorded filing shows the business keeps filings up to date in Khatario. */
export function trackingSince(asOn: string): string {
  return shiftMonth(asOn.slice(0, 7), -FILING_TRACKING_MONTHS);
}

export interface ReturnPeriod {
  /** Month the filing row is keyed on (the quarter's last month for QRMP). */
  period: string;
  /** Calendar months the return covers. */
  months: string[];
  label: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (p: string) => `${MONTH_NAMES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

function quarterPeriod(end: string): ReturnPeriod {
  const months = [shiftMonth(end, -2), shiftMonth(end, -1), end];
  return { period: end, months, label: `${monthLabel(months[0])} – ${monthLabel(end)} quarter` };
}

/** The return period a calendar month (YYYY-MM) belongs to: itself, or its quarter for QRMP filers. */
export function returnPeriodForMonth(month: string, opts: Gstr3BDueDateOptions): ReturnPeriod {
  if (opts.filingFrequency === 'qrmp') {
    const m = Number(month.slice(5, 7));
    return quarterPeriod(shiftMonth(month, (3 - (m % 3)) % 3));
  }
  return { period: month, months: [month], label: monthLabel(month) };
}

/** First day after the return period ends: the earliest date it can be filed. */
export function periodFilingOpensOn(period: string): string {
  return `${shiftMonth(period, 1)}-01`;
}

/** The two most recent return periods that have ended by `asOn`. */
export function recentReturnPeriods(asOn: string, opts: Gstr3BDueDateOptions): ReturnPeriod[] {
  const current = asOn.slice(0, 7);
  if (opts.filingFrequency === 'qrmp') {
    const m = Number(current.slice(5, 7));
    const lastEnded = shiftMonth(current, -(((m - 1) % 3) + 1));
    return [lastEnded, shiftMonth(lastEnded, -3)].map(quarterPeriod);
  }
  return [shiftMonth(current, -1), shiftMonth(current, -2)].map((p) => ({ period: p, months: [p], label: monthLabel(p) }));
}

export interface Gstr3bPeriodState {
  period: ReturnPeriod;
  filed: boolean;
  /** Any invoice or purchase in the period. */
  hasActivity: boolean;
}

export function gstr3bFindings(
  asOn: string,
  opts: Gstr3BDueDateOptions,
  periods: Gstr3bPeriodState[],
  /**
   * The business recently recorded a GSTR-3B in Khatario (filing flow or "mark as filed"), so
   * "not filed" is meaningful. Without that, only upcoming reminders are sent: "late" could be false.
   */
  tracksFiling: boolean,
): ComplianceFinding[] {
  const out: ComplianceFinding[] = [];
  for (const { period, filed, hasActivity } of periods) {
    if (filed) continue;
    const due = gstr3bDueDateIso(period.period, opts);
    const daysLeft = daysBetween(asOn, due);
    const base = {
      checkId: 'gstr3b_due' as const,
      key: `gstr3b:${period.period}`,
      legalRef: 'CGST Act, Sections 39, 47 and 50; CGST Rules, Rule 61',
      actionUrl: `/reports/gst/gstr3b?period=${period.period}`,
      actionLabel: 'Open GSTR-3B',
      dueDate: due,
      details: {
        period: period.period,
        label: period.label,
        months: period.months,
        due_date: due,
        days_left: daysLeft,
        can_mark_filed: true,
      },
    };
    const markHint = ' Already filed it? Mark it as filed so Khatario stops reminding you.';

    if (daysLeft >= 0 && daysLeft <= GSTR3B_REMIND_DAYS) {
      if (!hasActivity && !tracksFiling) continue;
      out.push({
        ...base,
        severity: daysLeft <= 1 ? 'warning' : 'info',
        stage: daysLeft <= 1 ? 'due_1d' : 'due_5d',
        title: daysLeft === 0 ? `GSTR-3B for ${period.label} is due today` : `GSTR-3B for ${period.label} is due on ${formatDate(due)}`,
        message:
          `File GSTR-3B and pay the tax by ${formatDate(due)}. A late return attracts a late fee of ${inr(LATE_FEE_PER_DAY_NORMAL_INR)} per day ` +
          `(${inr(LATE_FEE_PER_DAY_NIL_RETURN_INR)} for a nil return), and unpaid tax attracts 18% yearly interest.${markHint}`,
        askQuestion: 'What is the late fee and interest if I file GSTR-3B late?',
        amount: null,
      });
    } else if (daysLeft < 0 && tracksFiling && hasActivity) {
      const daysLate = -daysLeft;
      const fee = calculateLateFee({ dueDate: due, filingDate: asOn, isNilReturn: false });
      out.push({
        ...base,
        severity: 'critical',
        stage: daysLate > 30 ? 'overdue_30d' : 'overdue',
        title: `GSTR-3B for ${period.label} is ${plural(daysLate, 'day')} late`,
        message:
          `It was due on ${formatDate(due)}. The late fee so far is about ${inr(fee)} (${inr(LATE_FEE_PER_DAY_NORMAL_INR)} per day, ` +
          `up to ${inr(LATE_FEE_CAP_NORMAL_INR)}), plus 18% yearly interest on tax paid late. File it as soon as you can.${markHint}`,
        askQuestion: 'What is the late fee and interest if I file GSTR-3B late?',
        amount: fee,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// E-way bill: goods invoices over ₹50,000 with no e-way bill number
// ---------------------------------------------------------------------------------------------

export const EWAY_BILL_THRESHOLD_INR = 50_000;
export const EWAY_LOOKBACK_DAYS = 7;

export interface EwayCandidate {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string | null;
  grand_total: number;
  has_goods: boolean;
  eway_bill_number: string | null;
}

export function ewayBillFinding(asOn: string, invoices: EwayCandidate[]): ComplianceFinding | null {
  const from = addDays(asOn, -EWAY_LOOKBACK_DAYS);
  const missing = invoices.filter(
    (i) =>
      i.has_goods &&
      i.grand_total > EWAY_BILL_THRESHOLD_INR &&
      !(i.eway_bill_number ?? '').trim() &&
      i.invoice_date >= from &&
      i.invoice_date <= asOn,
  );
  if (!missing.length) return null;
  const total = round2(missing.reduce((s, i) => s + i.grand_total, 0));
  return {
    checkId: 'eway_bill',
    key: 'eway_bill:missing',
    severity: 'info',
    stage: 'open',
    quiet: true,
    title: `${plural(missing.length, 'invoice')} over ${inr(EWAY_BILL_THRESHOLD_INR)} without an e-way bill number`,
    message:
      `If goods were moved for ${missing.length === 1 ? 'this invoice' : 'these invoices'}, an e-way bill is needed before the goods leave ` +
      `(some states set a different limit within the state). Goods moved without one can be detained, with a penalty of up to 200% of the tax. ` +
      `If you, the transporter or the buyer generated one, add its number to the invoice so it prints.`,
    legalRef: 'CGST Rules, Rule 138; CGST Act, Section 129',
    actionUrl: null,
    actionLabel: null,
    askQuestion: 'When is an e-way bill required and what is the penalty for moving goods without one? (Rule 138)',
    dueDate: null,
    amount: total,
    details: {
      sales: [...missing]
        .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date))
        .slice(0, 20)
        .map(({ invoice_id, invoice_number, invoice_date, customer_name, grand_total }) => ({
          invoice_id,
          invoice_number,
          invoice_date,
          customer_name,
          grand_total: round2(grand_total),
        })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// E-invoicing (IRN) applies above ₹5 crore aggregate turnover
// ---------------------------------------------------------------------------------------------

export const EINVOICE_THRESHOLD_INR = 5_00_00_000;
export const EINVOICE_30_DAY_THRESHOLD_INR = 10_00_00_000;

function fyOf(asOn: string): { label: string; prevStart: string; prevEnd: string; prevLabel: string } {
  const y = Number(asOn.slice(0, 4));
  const start = Number(asOn.slice(5, 7)) >= 4 ? y : y - 1;
  return {
    label: `FY ${start}-${String(start + 1).slice(2)}`,
    prevStart: `${start - 1}-04-01`,
    prevEnd: `${start}-03-31`,
    prevLabel: `FY ${start - 1}-${String(start).slice(2)}`,
  };
}

export function previousFyRange(asOn: string): { from: string; to: string; label: string } {
  const f = fyOf(asOn);
  return { from: f.prevStart, to: f.prevEnd, label: f.prevLabel };
}

export function einvoiceFinding(
  asOn: string,
  input: { declaredAbove5cr: boolean; previousFyTurnover: number },
): ComplianceFinding | null {
  const f = fyOf(asOn);
  const over = input.previousFyTurnover > EINVOICE_THRESHOLD_INR;
  if (!over && !input.declaredAbove5cr) return null;
  const thirtyDay = input.previousFyTurnover >= EINVOICE_30_DAY_THRESHOLD_INR;
  const basis = over
    ? `Your ${f.prevLabel} sales recorded in Khatario are ${inr(input.previousFyTurnover)}, above ${inr(EINVOICE_THRESHOLD_INR)}.`
    : `Your business profile says aggregate turnover is above ${inr(EINVOICE_THRESHOLD_INR)}.`;
  return {
    checkId: 'einvoice',
    key: 'einvoice:applicable',
    severity: 'warning',
    stage: f.label,
    title: 'E-invoicing (IRN) applies to your B2B invoices',
    message:
      `${basis} Businesses whose aggregate turnover crossed ${inr(EINVOICE_THRESHOLD_INR)} in any year must report B2B invoices, ` +
      `credit notes and debit notes to the Invoice Registration Portal and print the IRN and QR code; an invoice without an IRN is not a valid tax invoice ` +
      `and your customer cannot claim ITC on it. ` +
      (thirtyDay ? `Because turnover is ${inr(EINVOICE_30_DAY_THRESHOLD_INR)} or more, each invoice must be reported within 30 days of its date. ` : '') +
      `Khatario does not generate IRNs yet, so generate them on the e-invoice portal. Aggregate turnover counts every GSTIN on your PAN; if this does not apply to you, dismiss this alert.`,
    legalRef: 'CGST Rules, Rule 48(4); Notification 10/2023-Central Tax',
    actionUrl: null,
    actionLabel: null,
    askQuestion: 'Who has to issue e-invoices with an IRN under GST? (Rule 48(4))',
    dueDate: null,
    amount: over ? round2(input.previousFyTurnover) : null,
    details: { fy: f.prevLabel, turnover: round2(input.previousFyTurnover), declared_above_5cr: input.declaredAbove5cr, thirty_day_rule: thirtyDay },
  };
}

// ---------------------------------------------------------------------------------------------
// RCM: self-invoice for reverse charge purchases from unregistered suppliers
// ---------------------------------------------------------------------------------------------

export const SELF_INVOICE_DAYS = 30;

export interface RcmUnregisteredBill {
  purchase_id: string;
  bill_number: string | null;
  bill_date: string;
  supplier_name: string | null;
  tax: number;
}

export function rcmSelfInvoiceFinding(asOn: string, bills: RcmUnregisteredBill[]): ComplianceFinding | null {
  const open = bills
    .map((b) => ({ ...b, due: addDays(b.bill_date, SELF_INVOICE_DAYS) }))
    .filter((b) => b.bill_date <= asOn && b.due >= asOn);
  if (!open.length) return null;
  open.sort((a, b) => a.due.localeCompare(b.due));
  const firstDue = open[0].due;
  const daysLeft = daysBetween(asOn, firstDue);
  const tax = round2(open.reduce((s, b) => s + b.tax, 0));
  return {
    checkId: 'rcm_self_invoice',
    key: 'rcm_self_invoice:open',
    severity: daysLeft <= 5 ? 'warning' : 'info',
    stage: daysLeftStage(daysLeft, [5, 30]) ?? '30d',
    title: `Issue a self-invoice for ${plural(open.length, 'reverse charge purchase')}`,
    message:
      `${plural(open.length, 'purchase')} under reverse charge ${open.length === 1 ? 'is' : 'are'} from a supplier without a GSTIN. ` +
      `You must issue a self-invoice within 30 days of receiving the goods or services, the first by ${formatDate(firstDue)}, ` +
      `and a payment voucher when you pay the supplier. Pay the reverse charge tax in cash through GSTR-3B; ITC can then be claimed. ` +
      `Khatario does not create self-invoices yet, so keep one in your records.`,
    legalRef: 'CGST Act, Section 31(3)(f) and (g); CGST Rules, Rule 47A',
    actionUrl: null,
    actionLabel: null,
    askQuestion: 'When do I need to issue a self-invoice under reverse charge? (Section 31(3)(f), Rule 47A)',
    dueDate: firstDue,
    amount: tax > 0 ? tax : null,
    details: {
      rcm_bills: open.slice(0, 20).map((b) => ({
        purchase_id: b.purchase_id,
        bill_number: b.bill_number,
        bill_date: b.bill_date,
        supplier_name: b.supplier_name,
        self_invoice_by: b.due,
        tax: round2(b.tax),
      })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Notification policy
// ---------------------------------------------------------------------------------------------

export interface StoredAlertState {
  notified_stage: string | null;
  resolved_at: string | Date | null;
}

/** Notify on a new or reopened alert, or when it reaches a new milestone. Never twice for one stage. */
export function shouldNotify(prev: StoredAlertState | null, finding: ComplianceFinding): boolean {
  if (!prev || prev.resolved_at) return true;
  return prev.notified_stage !== finding.stage;
}
