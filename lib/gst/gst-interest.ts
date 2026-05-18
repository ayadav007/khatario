import { round2 } from '@/lib/gst/gstr3b-ledger';

/** Section 50 read with annual simple interest (common working for delayed GST payment). */
export const GSTR3B_ANNUAL_INTEREST_RATE = 0.18;

export const LATE_FEE_PER_DAY_NORMAL_INR = 50;
export const LATE_FEE_PER_DAY_NIL_RETURN_INR = 20;

/** Notified caps (subject to CBIC updates). */
export const LATE_FEE_CAP_NORMAL_INR = 10_000;
export const LATE_FEE_CAP_NIL_RETURN_INR = 500;

export type Gstr3BFilingFrequency = 'monthly' | 'qrmp';

export interface Gstr3BDueDateOptions {
  filingFrequency?: Gstr3BFilingFrequency;
  /** QRMP: commonly 22 or 24 per notified rules; default 22. */
  qrmpDueDay?: 22 | 24;
}

function lastMonthOfIndianQuarter(year: number, month: number): { y: number; m: number } {
  const qEnd = Math.ceil(month / 3) * 3;
  return { y: year, m: qEnd };
}

/**
 * GSTR-3B due date (calendar, YYYY-MM-DD).
 * - **monthly**: 20th of the month following `gst_period`.
 * - **qrmp**: due in the month **after the quarter** containing `gst_period`, on `qrmpDueDay` (default 22).
 *   Example: any month in Jan–Mar 2026 → due **2026-04-22** (not legal advice; verify notifications).
 */
export function gstr3bDueDateIso(gstPeriodYYYYMM: string, options?: Gstr3BDueDateOptions): string {
  const m = /^(\d{4})-(\d{2})$/.exec(gstPeriodYYYYMM.trim());
  if (!m) {
    throw new Error('gst_period must be YYYY-MM');
  }
  const y = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) {
    throw new Error('Invalid gst_period');
  }

  const freq = options?.filingFrequency ?? 'monthly';
  const qrmpDay = options?.qrmpDueDay ?? 22;

  let refY = y;
  let refM = month;
  let dueDay: number;

  if (freq === 'qrmp') {
    const end = lastMonthOfIndianQuarter(y, month);
    refY = end.y;
    refM = end.m;
    dueDay = qrmpDay;
  } else {
    dueDay = 20;
  }

  let dueM = refM + 1;
  let dueY = refY;
  if (dueM > 12) {
    dueM = 1;
    dueY += 1;
  }
  return `${dueY}-${String(dueM).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
}

/**
 * Interest base = **cash liability after ITC set-off** only (not gross output tax).
 * Pass `GSTR3BData.summary.net_tax_payable` (already net of ITC utilization in our ledger 3B).
 * RCM: split heads sit inside `net_payable` util; pooled RCM adds period **net** on ledger 2155 (cash
 * payments in the period reduce this), so paid RCM is not double-counted vs books.
 */
export function gstCashLiabilityAfterItcForInterest(netTaxPayableSummary: number): number {
  return Math.max(0, round2(Number(netTaxPayableSummary) || 0));
}

export function applyLateFeeStatutoryCap(rawFee: number, isNilReturn: boolean): number {
  const cap = isNilReturn ? LATE_FEE_CAP_NIL_RETURN_INR : LATE_FEE_CAP_NORMAL_INR;
  return round2(Math.min(Math.max(0, rawFee), cap));
}

/** UTC calendar date YYYY-MM-DD from ISO string or Date. */
export function toIsoDateOnly(input: string | Date): string {
  if (typeof input === 'string') {
    const s = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return s;
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      throw new Error('Invalid date');
    }
    return d.toISOString().slice(0, 10);
  }
  return input.toISOString().slice(0, 10);
}

/**
 * Whole days from `start` (exclusive of interest clock start) to `end` for liability period.
 * If `end` is on or before `start`, returns 0.
 */
export function wholeDaysLate(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error('Invalid date range');
  }
  const diff = Math.floor((end - start) / 86_400_000);
  return Math.max(0, diff);
}

/** Calendar day after `iso` (YYYY-MM-DD), UTC. */
export function nextCalendarDayIso(iso: string): string {
  const t = Date.parse(`${toIsoDateOnly(iso)}T00:00:00.000Z`);
  if (Number.isNaN(t)) {
    throw new Error('Invalid date');
  }
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

export interface GstInterestPaymentEventInput {
  date: string;
  amount: number;
}

export interface GstInterestSegmentRow {
  from: string;
  to: string;
  base: number;
  days: number;
  interest: number;
}

/** Sum amounts that share the same calendar date (multiple challans same day). */
export function mergeGstPaymentEventsByDate(
  paymentEvents: GstInterestPaymentEventInput[]
): GstInterestPaymentEventInput[] {
  const m = new Map<string, number>();
  for (const e of paymentEvents) {
    if (e.amount < 0.005) {
      continue;
    }
    const d = toIsoDateOnly(e.date);
    m.set(d, round2((m.get(d) ?? 0) + e.amount));
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date, amount }));
}

/**
 * Section 50-style simple interest on **outstanding cash** between due date and payment instalments.
 * - First segment uses the same day basis as {@link calculateInterest} (`wholeDaysLate(due, ·)`).
 * - After each payment, the next segment starts the **calendar day after** that payment.
 * - Same-day instalments are merged before applying segments.
 */
export function computeSegmentedGstInterest(params: {
  dueDate: string;
  initialCashLiability: number;
  /** Sorted or unsorted; must be only cash `gst_payment` rows with date > dueDate. */
  paymentEvents: GstInterestPaymentEventInput[];
  /** Last date to accrue on any remaining balance (e.g. max(filing, payment)). */
  interestEndDate: string;
}): { segments: GstInterestSegmentRow[]; totalInterest: number } {
  const due = toIsoDateOnly(params.dueDate);
  const end = toIsoDateOnly(params.interestEndDate);
  let outstanding = round2(Math.max(0, params.initialCashLiability));
  let cursor = due;
  const segments: GstInterestSegmentRow[] = [];

  const sorted = mergeGstPaymentEventsByDate(params.paymentEvents);

  for (const ev of sorted) {
    const evDate = toIsoDateOnly(ev.date);
    if (evDate <= due || evDate > end) {
      continue;
    }
    if (outstanding <= 0.005) {
      break;
    }
    const days = wholeDaysLate(cursor, evDate);
    if (days > 0) {
      const interest = round2((outstanding * GSTR3B_ANNUAL_INTEREST_RATE * days) / 365);
      segments.push({ from: cursor, to: evDate, base: outstanding, days, interest });
    }
    outstanding = round2(Math.max(0, outstanding - ev.amount));
    cursor = nextCalendarDayIso(evDate);
  }

  if (outstanding > 0.005 && cursor <= end) {
    const days = wholeDaysLate(cursor, end);
    if (days > 0) {
      const interest = round2((outstanding * GSTR3B_ANNUAL_INTEREST_RATE * days) / 365);
      segments.push({ from: cursor, to: end, base: outstanding, days, interest });
    }
  }

  return {
    segments,
    totalInterest: round2(segments.reduce((s, x) => s + x.interest, 0)),
  };
}

/**
 * Interest on **delayed payment of cash liability** (post-ITC): 18% p.a. × days / 365.
 * No interest when `cashLiabilityAfterItc` is zero (e.g. fully discharged via ITC).
 */
export function calculateInterest(params: {
  /** Cash tax due after ITC (not gross tax before utilization). */
  cashLiabilityAfterItc: number;
  dueDate: string | Date;
  /** Date tax was actually paid / debited to cash/bank — not filing date. */
  paymentDate: string | Date;
}): number {
  const due = toIsoDateOnly(params.dueDate);
  const pay = toIsoDateOnly(params.paymentDate);
  const days = wholeDaysLate(due, pay);
  const amount = gstCashLiabilityAfterItcForInterest(params.cashLiabilityAfterItc);
  if (days === 0 || amount < 0.005) {
    return 0;
  }
  return round2((amount * GSTR3B_ANNUAL_INTEREST_RATE * days) / 365);
}

/**
 * Late fee for delayed filing: ₹50/day (₹20/day nil return) from due date to filing date.
 */
export function calculateLateFee(params: {
  dueDate: string | Date;
  filingDate: string | Date;
  isNilReturn: boolean;
}): number {
  const due = toIsoDateOnly(params.dueDate);
  const filed = toIsoDateOnly(params.filingDate);
  const days = wholeDaysLate(due, filed);
  if (days === 0) {
    return 0;
  }
  const perDay = params.isNilReturn ? LATE_FEE_PER_DAY_NIL_RETURN_INR : LATE_FEE_PER_DAY_NORMAL_INR;
  const raw = round2(days * perDay);
  return applyLateFeeStatutoryCap(raw, params.isNilReturn);
}

export function isLikelyNilGstr3BReturn(netTaxPayable: number): boolean {
  return Math.abs(round2(Number(netTaxPayable) || 0)) < 0.005;
}

/**
 * Non-blocking compliance hint (late filing → late fee exposure).
 */
export function lateFilingWarningMessage(
  gstPeriod: string,
  filingDateIso: string,
  dueOpts?: Gstr3BDueDateOptions
): string | null {
  const due = gstr3bDueDateIso(gstPeriod, dueOpts);
  const fd = toIsoDateOnly(filingDateIso);
  if (fd <= due) {
    return null;
  }
  const days = wholeDaysLate(due, fd);
  const fee = calculateLateFee({ dueDate: due, filingDate: fd, isNilReturn: false });
  return (
    `Return is ${days} day(s) after GSTR-3B due date (${due}). Estimated late fee (normal return, capped): ₹${fee.toFixed(2)} ` +
    `(₹${LATE_FEE_PER_DAY_NORMAL_INR}/day, max ₹${LATE_FEE_CAP_NORMAL_INR}; nil return ₹${LATE_FEE_PER_DAY_NIL_RETURN_INR}/day, max ₹${LATE_FEE_CAP_NIL_RETURN_INR}).`
  );
}

export interface GstChargesEstimate {
  interest: number;
  late_fee: number;
  days_delayed: number;
  due_date: string;
  /** Days from due date to payment date (for interest). */
  interest_days: number;
  /** Cash liability after ITC (`summary.net_tax_payable`) — interest base only. */
  cash_liability_after_itc: number;
}

/**
 * Estimate interest + late fee for a period (does not add to liability totals).
 */
export function computeGstChargesEstimate(params: {
  gstPeriod: string;
  /** Must be post-ITC cash liability: `GSTR3BData.summary.net_tax_payable`. */
  netTaxPayable: number;
  filingDate: string | Date;
  /** Date cash/bank payment of tax — drives interest (not filing date). */
  paymentDate: string | Date;
  isNilReturn?: boolean;
  dueDateOptions?: Gstr3BDueDateOptions;
}): GstChargesEstimate {
  const due = gstr3bDueDateIso(params.gstPeriod, params.dueDateOptions);
  const filingIso = toIsoDateOnly(params.filingDate);
  const paymentIso = toIsoDateOnly(params.paymentDate);
  const isNil = params.isNilReturn ?? isLikelyNilGstr3BReturn(params.netTaxPayable);

  const days_delayed = wholeDaysLate(due, filingIso);
  const interest_days = wholeDaysLate(due, paymentIso);
  const late_fee = calculateLateFee({
    dueDate: due,
    filingDate: filingIso,
    isNilReturn: isNil,
  });
  const cashBase = gstCashLiabilityAfterItcForInterest(params.netTaxPayable);
  const interest = calculateInterest({
    cashLiabilityAfterItc: cashBase,
    dueDate: due,
    paymentDate: paymentIso,
  });

  return {
    interest,
    late_fee,
    days_delayed,
    due_date: due,
    interest_days,
    cash_liability_after_itc: cashBase,
  };
}
