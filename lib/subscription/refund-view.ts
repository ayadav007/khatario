/**
 * Wording and checks for the admin refund screen and the GST settings screen. Pure functions; the
 * amounts and dates are the server's (admin billing list, refund route), never worked out here.
 */
import { formatPlanDate, formatRupees } from '@/lib/subscription/renewal-view';

export type EndPlanChoice = 'now' | 'period_end';

/**
 * `effects` is what the server says each choice would do to this payment's plan (admin billing list, same rule as the
 * refund itself); without it the wording is general.
 */
export function endPlanChoices(
  planEndDate: string | null,
  effects?: { now: string; period_end: string } | null,
): { value: EndPlanChoice; label: string; explain: string }[] {
  return [
    {
      value: 'period_end',
      label: 'Let it run to the end of the period',
      explain:
        effects?.period_end ??
        (planEndDate
          ? `The customer keeps their plan until ${formatPlanDate(planEndDate)}. It is not renewed after that.`
          : 'The customer keeps their plan until the end of the period they paid for. It is not renewed after that.'),
    },
    {
      value: 'now',
      label: 'End the plan now',
      explain:
        effects?.now ??
        'The customer moves to the free plan today and loses paid features straight away. If a later renewal payment is not refunded, the days of this payment are taken off the end date instead, and the result message says so.',
    },
  ];
}

export type RefundForm = { amountText: string; reason: string; max: number };

/** Returns the amount in rupees, or the first thing wrong in plain words. */
export function validateRefundForm(f: RefundForm): { ok: true; amount: number } | { ok: false; error: string } {
  const text = f.amountText.trim();
  const amount = Number(text);
  if (!text || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter the amount to refund, in rupees.' };
  if (Math.round(amount * 100) !== amount * 100 && Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
    return { ok: false, error: 'An amount can have at most two decimal places.' };
  }
  if (amount > f.max) return { ok: false, error: `You can refund at most ${formatRupees(f.max)} on this payment.` };
  if (f.reason.trim().length < 3) return { ok: false, error: 'Write the reason for the refund. It is kept with the refund.' };
  return { ok: true, amount };
}

export const PARTIAL_REFUND_NOTE = "Partial refund. The customer's plan is not changed.";

/** True when the entered amount is everything that can still be refunded, the only refund that can change the plan. */
export function isFullRefund(amount: number, refundable: number): boolean {
  return amount > 0 && Math.round(amount * 100) >= Math.round(refundable * 100);
}

export function refundConfirmText(p: {
  amount: number;
  viaGateway: boolean;
  endPlan: EndPlanChoice;
  planEndDate: string | null;
  /** True when the amount is less than everything that can still be refunded: the plan is not changed. */
  partial?: boolean;
  effects?: { now: string; period_end: string } | null;
}): string[] {
  const lines = [
    p.viaGateway
      ? `You are about to refund ${formatRupees(p.amount)}. The money will be sent back to the customer through the payment gateway they paid with.`
      : `You are about to record a refund of ${formatRupees(p.amount)}. This payment was recorded by hand, so no money moves automatically: return it to the customer yourself.`,
    p.partial ? PARTIAL_REFUND_NOTE : endPlanChoices(p.planEndDate, p.effects).find((c) => c.value === p.endPlan)!.explain,
    'A refund cannot be undone.',
  ];
  return lines;
}

// ---------------------------------------------------------------------------------------------
// GST settings
// ---------------------------------------------------------------------------------------------

export type GstMode = 'none' | 'inclusive' | 'exclusive';

export const GST_MODE_OPTIONS: { value: GstMode; label: string; explain: string }[] = [
  { value: 'none', label: 'No GST', explain: 'Customers pay the listed price. No tax line and no tax invoice numbers. Receipts are plain receipts.' },
  { value: 'inclusive', label: 'Price includes GST', explain: 'Customers pay the listed price. The GST part of it is shown on the receipt, which becomes a tax invoice.' },
  { value: 'exclusive', label: 'GST added on top', explain: 'GST is added to the price after any coupon and upgrade credit, so customers pay more than the listed price.' },
];

export const GST_CONFIRM_PHRASE = 'CHANGE GST';

/** Typing the phrase is needed when the new mode charges or shows tax, or the rate changes while tax is charged or shown: it changes what customers are charged or shown. */
export function needsTypedConfirm(saved: GstMode, next: GstMode, rateChanged = false): boolean {
  if (next === 'none') return false;
  return next !== saved || rateChanged;
}

export type GstField = 'mode' | 'rate_percent' | 'seller_gstin' | 'seller_legal_name' | 'seller_address' | 'seller_state_code' | 'sac_code' | 'invoice_prefix';

/** The field a server validation message is about (so it can be shown next to it); null when it is about the form as a whole. */
export function gstErrorField(message: string): GstField | null {
  const m = message.toLowerCase();
  if (m.includes('gstin')) return 'seller_gstin';
  if (m.includes('legal name')) return 'seller_legal_name';
  if (m.includes('state')) return 'seller_state_code';
  if (m.includes('rate')) return 'rate_percent';
  if (m.includes('sac')) return 'sac_code';
  if (m.includes('prefix')) return 'invoice_prefix';
  if (m.includes('address')) return 'seller_address';
  if (m.startsWith('mode')) return 'mode';
  return null;
}
