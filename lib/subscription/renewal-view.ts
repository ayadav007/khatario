/**
 * What the plan screens say about renewal, grace, credit, tax and receipts. Pure functions: every
 * rupee amount and every date comes from the server (current routes, checkout preview, billing
 * history) and is only turned into words here. Nothing is calculated.
 */
import { parseLocalDateOnly } from '@/lib/subscription/date-only';

/** Same look as the other billing screens: 12 Dec 2026. */
export function formatPlanDate(value: string | null | undefined): string {
  const d = parseLocalDateOnly(value ?? null);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Indian digit grouping, paise only when there are some: 299 -> ₹299, 199.33 -> ₹199.33, 1 -> ₹1. */
export function formatRupees(amount: number): string {
  const n = Math.abs(Number(amount) || 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** A money amount with its sign shown as a real minus: "−₹199.33". Zero has no sign. */
export function formatSignedRupees(amount: number): string {
  const n = Number(amount) || 0;
  return `${n < 0 ? '−' : ''}${formatRupees(n)}`;
}

// ---------------------------------------------------------------------------------------------
// Plan card
// ---------------------------------------------------------------------------------------------

export type RenewalSubscription = {
  plan_id: string;
  status: string;
  end_date: string | null;
  cancel_at_period_end?: boolean;
  is_operational?: boolean;
  trial_days_remaining?: number | null;
  ends_on?: string | null;
  grace_ends_on?: string | null;
  in_grace?: boolean;
  can_renew?: boolean;
  /** True for plans with no price (Free, included plans). The card works this out from the plan. */
  is_free?: boolean;
};

export type RenewalState = 'active' | 'ending_soon' | 'in_grace' | 'locked' | 'cancelled' | 'free' | 'trial';
export type RenewalAction = 'renew' | 'undo_cancel' | 'choose_plan' | null;

export type RenewalView = {
  state: RenewalState;
  headline: string;
  detail: string | null;
  primaryAction: RenewalAction;
  /** "Ends on 12 Dec 2026", or null when there is no end date to show. Never "Renews". */
  endsOnText: string | null;
  /** The banner that shows only inside the grace days. */
  graceBanner: string | null;
  /** The plan is locked: ended and the grace days are over. */
  locked: boolean;
};

export const ENDING_SOON_DAYS = 7;

/**
 * `today` is only used to say "ending soon"; it is the browser's calendar day and drives wording
 * (a hint), never a price or a date the customer is charged for.
 */
export function renewalView(sub: RenewalSubscription, today: Date = new Date()): RenewalView {
  const ends = sub.ends_on ?? sub.end_date;
  const endsOnText = ends ? `Ends on ${formatPlanDate(ends)}` : null;
  const base = { endsOnText, graceBanner: null as string | null, locked: false };

  if (sub.status === 'trial' || (sub.trial_days_remaining ?? 0) > 0) {
    return { ...base, state: 'trial', headline: 'Free trial', detail: null, primaryAction: 'choose_plan' };
  }
  if (sub.is_free) {
    return { ...base, endsOnText: null, state: 'free', headline: 'Free plan', detail: null, primaryAction: 'choose_plan' };
  }

  if (sub.is_operational === false) {
    return {
      ...base,
      locked: true,
      state: 'locked',
      headline: ends ? `Your plan ended on ${formatPlanDate(ends)}` : 'Your plan has ended',
      detail: 'Paid features are locked. Pay for a plan to start a new period from today.',
      primaryAction: 'choose_plan',
    };
  }

  if (sub.in_grace) {
    const graceText = sub.grace_ends_on ? formatPlanDate(sub.grace_ends_on) : null;
    return {
      ...base,
      state: 'in_grace',
      headline: ends ? `Your plan ended on ${formatPlanDate(ends)}` : 'Your plan has ended',
      detail: graceText ? `You can keep using it until ${graceText}. Renew to continue.` : 'Renew to continue.',
      graceBanner: ends
        ? `Your plan ended on ${formatPlanDate(ends)}.${graceText ? ` You can keep using it until ${graceText}.` : ''} Renew to continue.`
        : null,
      primaryAction: sub.can_renew || sub.can_renew === undefined ? 'renew' : 'choose_plan',
    };
  }

  if (sub.cancel_at_period_end) {
    return {
      ...base,
      state: 'cancelled',
      headline: ends ? `Cancelled. Access continues until ${formatPlanDate(ends)}` : 'Cancelled',
      detail: 'After that you move to the free plan. You can undo the cancellation until then.',
      primaryAction: 'undo_cancel',
    };
  }

  const soon = ends ? daysBetween(today, ends) : null;
  if (soon !== null && soon <= ENDING_SOON_DAYS && soon >= 0) {
    return {
      ...base,
      state: 'ending_soon',
      headline: endsOnText ?? 'Ends soon',
      detail: 'Renew to add another period after this end date. The days you have left are kept.',
      primaryAction: sub.can_renew ? 'renew' : null,
    };
  }

  return {
    ...base,
    state: 'active',
    headline: endsOnText ?? 'No end date',
    detail: null,
    primaryAction: sub.can_renew ? 'renew' : null,
  };
}

function daysBetween(today: Date, endText: string): number | null {
  const end = parseLocalDateOnly(endText);
  if (!end) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - t.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------------------------
// Checkout preview
// ---------------------------------------------------------------------------------------------

export type CheckoutPreview = {
  plan_id: string;
  billing_cycle: string;
  period_kind: 'renewal' | 'change';
  period_start: string;
  period_end: string;
  credit_unused: number;
  free_months?: number;
  breakdown: {
    listPrice: number;
    couponDiscount: number;
    creditApplied: number;
    creditUnused: number;
    creditAvailable: number;
    taxMode?: string;
    taxRatePercent?: number;
    taxableAmount: number;
    taxAmount: number;
    amountToPay: number;
  };
};

export type PreviewLine = {
  key: 'list' | 'coupon' | 'credit' | 'taxable' | 'tax' | 'pay';
  label: string;
  /** Signed as shown: deductions are negative. Taken from the server's figures, never worked out here. */
  amount: number;
  emphasis?: boolean;
};

/** The lines of the "what you pay" box, in order. Credit and coupon lines only when there is something; tax only when tax > 0. */
export function previewLines(p: CheckoutPreview): PreviewLine[] {
  const b = p.breakdown;
  const lines: PreviewLine[] = [{ key: 'list', label: 'Plan price', amount: b.listPrice }];
  if (b.couponDiscount > 0) lines.push({ key: 'coupon', label: 'Coupon discount', amount: -b.couponDiscount });
  if (b.creditApplied > 0) {
    lines.push({ key: 'credit', label: 'Credit for unused days on your current plan', amount: -b.creditApplied });
  }
  if (b.taxAmount > 0) {
    lines.push({ key: 'taxable', label: 'Amount before GST', amount: b.taxableAmount });
    const rate = b.taxRatePercent ? ` (${b.taxRatePercent}%)` : '';
    lines.push({ key: 'tax', label: `GST${rate}`, amount: b.taxAmount });
  }
  lines.push({ key: 'pay', label: 'You pay', amount: b.amountToPay, emphasis: true });
  return lines;
}

/** True when unused credit is lost by this purchase, so the customer must tick a box first. */
export function needsCreditConfirm(p: CheckoutPreview | null): boolean {
  return !!p && p.credit_unused > 0;
}

export function creditWarning(p: CheckoutPreview): string | null {
  if (!needsCreditConfirm(p)) return null;
  return `${formatRupees(p.credit_unused)} of the credit for your unused days is more than this purchase can use. The rest is not carried forward and not refunded.`;
}

/** The coupon's free months, added to the plan after payment (the server says how many). */
export function freeMonthsNote(p: CheckoutPreview): string | null {
  const n = Number(p.free_months ?? 0);
  if (n <= 0) return null;
  return `Your coupon adds ${n} free month${n === 1 ? '' : 's'} to your plan after you pay.`;
}

/** Where the new period sits, in plain words. Wording follows the server's period kind. */
export function periodSentence(p: CheckoutPreview): string {
  return p.period_kind === 'renewal'
    ? `The new period is added after your current end date. Your plan will then end on ${formatPlanDate(p.period_end)}.`
    : `Your new period starts today (${formatPlanDate(p.period_start)}) and ends on ${formatPlanDate(p.period_end)}.`;
}

// ---------------------------------------------------------------------------------------------
// Billing history
// ---------------------------------------------------------------------------------------------

export type HistoryRow = {
  amount: number;
  status: string;
  type?: string;
  document_kind?: string | null;
  invoice_number?: string | null;
  receipt_url?: string | null;
  tax_amount?: number | null;
};

const KIND_LABELS: Record<string, string> = {
  receipt: 'Receipt',
  tax_invoice: 'Tax invoice',
  refund_receipt: 'Refund receipt',
  credit_note: 'Credit note',
};

export function historyView(row: HistoryRow) {
  const isRefund = row.type === 'refund' || row.amount < 0;
  return {
    isRefund,
    amountText: formatSignedRupees(isRefund && row.amount > 0 ? -row.amount : row.amount),
    statusText: isRefund ? 'Refunded' : row.status.charAt(0).toUpperCase() + row.status.slice(1),
    receiptUrl: row.receipt_url || null,
    receiptLabel: KIND_LABELS[row.document_kind ?? 'receipt'] ?? 'Receipt',
  };
}

export function anyTax(rows: HistoryRow[]): boolean {
  return rows.some((r) => Math.abs(Number(r.tax_amount ?? 0)) > 0);
}
