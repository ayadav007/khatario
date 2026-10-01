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
export type ComplianceCheckId = 'rule37' | 'itc_deadline' | 'credit_note_deadline' | 'gstr3b_due';

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

export interface ReturnPeriod {
  /** Month the filing row is keyed on (the quarter's last month for QRMP). */
  period: string;
  /** Calendar months the return covers. */
  months: string[];
  label: string;
}

/** The two most recent return periods that have ended by `asOn`. */
export function recentReturnPeriods(asOn: string, opts: Gstr3BDueDateOptions): ReturnPeriod[] {
  const current = asOn.slice(0, 7);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (p: string) => `${names[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
  if (opts.filingFrequency === 'qrmp') {
    const m = Number(current.slice(5, 7));
    const lastEnded = shiftMonth(current, -(((m - 1) % 3) + 1));
    return [lastEnded, shiftMonth(lastEnded, -3)].map((end) => {
      const months = [shiftMonth(end, -2), shiftMonth(end, -1), end];
      return { period: end, months, label: `${monthLabel(months[0])} – ${monthLabel(end)} quarter` };
    });
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
   * The business records GSTR-3B filings in Khatario (gst_filings), so "not filed" is meaningful.
   * Without that, only upcoming reminders are sent: an "overdue" claim could be false.
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
      details: { period: period.period, months: period.months, due_date: due, days_left: daysLeft },
    };
    const markHint = tracksFiling ? '' : ' If you have already filed it, dismiss this alert.';

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
          `up to ${inr(LATE_FEE_CAP_NORMAL_INR)}), plus 18% yearly interest on tax paid late. File it as soon as you can.`,
        askQuestion: 'What is the late fee and interest if I file GSTR-3B late?',
        amount: fee,
      });
    }
  }
  return out;
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
