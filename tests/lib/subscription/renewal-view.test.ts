import {
  renewalView,
  previewLines,
  needsCreditConfirm,
  creditWarning,
  periodSentence,
  historyView,
  anyTax,
  formatRupees,
  formatSignedRupees,
  formatPlanDate,
  type CheckoutPreview,
} from '@/lib/subscription/renewal-view';

const TODAY = new Date(2026, 10, 27); // 27 Nov 2026, local
const paid = { plan_id: 'billing_starter', status: 'active', is_operational: true, can_renew: true };

describe('renewalView', () => {
  it('active, far from the end: "Ends on", Renew, never the word renews', () => {
    const v = renewalView({ ...paid, end_date: '2027-01-20', ends_on: '2027-01-20' }, TODAY);
    expect(v).toMatchObject({ state: 'active', primaryAction: 'renew', endsOnText: 'Ends on 20 Jan 2027' });
    expect(JSON.stringify(v)).not.toMatch(/renews|auto/i);
  });
  it('ending within 7 days', () => {
    const v = renewalView({ ...paid, end_date: '2026-12-02' }, TODAY);
    expect(v).toMatchObject({ state: 'ending_soon', primaryAction: 'renew', headline: 'Ends on 2 Dec 2026' });
  });
  it('in grace: the banner text and Renew', () => {
    const v = renewalView({ ...paid, end_date: '2026-11-25', in_grace: true, grace_ends_on: '2026-12-02' }, TODAY);
    expect(v.state).toBe('in_grace');
    expect(v.primaryAction).toBe('renew');
    expect(v.graceBanner).toBe('Your plan ended on 25 Nov 2026. You can keep using it until 2 Dec 2026. Renew to continue.');
  });
  it('locked: ended and not operational', () => {
    const v = renewalView({ ...paid, end_date: '2026-10-01', is_operational: false, can_renew: false }, TODAY);
    expect(v).toMatchObject({ state: 'locked', locked: true, primaryAction: 'choose_plan' });
  });
  it('cancelled at period end and still running: Undo cancellation', () => {
    const v = renewalView({ ...paid, end_date: '2026-12-20', cancel_at_period_end: true }, TODAY);
    expect(v).toMatchObject({ state: 'cancelled', primaryAction: 'undo_cancel' });
    expect(v.headline).toContain('20 Dec 2026');
  });
  it('free and trial', () => {
    expect(renewalView({ plan_id: 'free', status: 'active', end_date: null, is_free: true }, TODAY)).toMatchObject({ state: 'free', primaryAction: 'choose_plan', endsOnText: null });
    expect(renewalView({ plan_id: 'trial', status: 'trial', end_date: null, trial_days_remaining: 5 }, TODAY).state).toBe('trial');
  });
  it('no Renew when the server says it cannot be renewed', () => {
    expect(renewalView({ ...paid, can_renew: false, end_date: '2027-03-01' }, TODAY).primaryAction).toBeNull();
  });
});

describe('formatting', () => {
  it('rupees: Indian grouping, paise only when present, real minus sign', () => {
    expect(formatRupees(1)).toBe('₹1');
    expect(formatRupees(199.33)).toBe('₹199.33');
    expect(formatRupees(123456)).toBe('₹1,23,456');
    expect(formatSignedRupees(-199.33)).toBe('−₹199.33');
    expect(formatSignedRupees(0)).toBe('₹0');
  });
  it('dates are not shifted by the time zone', () => {
    expect(formatPlanDate('2026-12-01')).toBe('1 Dec 2026');
    expect(formatPlanDate(null)).toBe('—');
  });
});

const preview = (b: Partial<CheckoutPreview['breakdown']> = {}, p: Partial<CheckoutPreview> = {}): CheckoutPreview => ({
  plan_id: 'billing_growth',
  billing_cycle: 'monthly',
  period_kind: 'change',
  period_start: '2026-11-27',
  period_end: '2026-12-27',
  credit_unused: 0,
  breakdown: { listPrice: 499, couponDiscount: 0, creditApplied: 0, creditUnused: 0, creditAvailable: 0, taxableAmount: 499, taxAmount: 0, amountToPay: 499, ...b },
  ...p,
});

describe('previewLines', () => {
  it('plain price: two lines, no tax, no credit', () => {
    expect(previewLines(preview()).map((l) => l.key)).toEqual(['list', 'pay']);
  });
  it('credit and coupon are shown as deductions with the credit wording', () => {
    const lines = previewLines(preview({ couponDiscount: 100, creditApplied: 199.33, amountToPay: 199.67 }));
    expect(lines.map((l) => [l.key, l.amount])).toEqual([['list', 499], ['coupon', -100], ['credit', -199.33], ['pay', 199.67]]);
    expect(lines[2].label).toBe('Credit for unused days on your current plan');
  });
  it('tax lines only when tax is above zero', () => {
    const lines = previewLines(preview({ taxAmount: 89.82, taxableAmount: 499, amountToPay: 588.82, taxRatePercent: 18 }));
    expect(lines.map((l) => l.key)).toEqual(['list', 'taxable', 'tax', 'pay']);
    expect(lines[2].label).toBe('GST (18%)');
  });
  it('a Rs 1 amount is an ordinary line', () => {
    const lines = previewLines(preview({ listPrice: 1, taxableAmount: 1, amountToPay: 1 }));
    expect(lines[lines.length - 1]).toMatchObject({ key: 'pay', amount: 1, emphasis: true });
    expect(formatRupees(lines[lines.length - 1].amount)).toBe('₹1');
  });
});

describe('credit confirmation and period wording', () => {
  it('needs a confirm only when credit is left over', () => {
    expect(needsCreditConfirm(preview())).toBe(false);
    expect(needsCreditConfirm(null)).toBe(false);
    const p = preview({ creditUnused: 4335.33 }, { credit_unused: 4335.33 });
    expect(needsCreditConfirm(p)).toBe(true);
    expect(creditWarning(p)).toContain('not carried forward and not refunded');
    expect(creditWarning(p)).toContain('₹4,335.33');
  });
  it('renewal adds after the end date; a change starts today', () => {
    expect(periodSentence(preview({}, { period_kind: 'renewal', period_end: '2027-01-20' }))).toContain('added after your current end date');
    expect(periodSentence(preview())).toContain('starts today');
  });
});

describe('history', () => {
  it('a refund row shows a minus and "Refunded"; a payment shows its receipt link and kind', () => {
    const r = historyView({ amount: -299, status: 'refunded', type: 'refund', document_kind: 'refund_receipt', receipt_url: '/api/subscriptions/receipts/x' });
    expect(r).toMatchObject({ isRefund: true, amountText: '−₹299', statusText: 'Refunded', receiptLabel: 'Refund receipt' });
    const p = historyView({ amount: 299, status: 'paid', type: 'payment', document_kind: 'tax_invoice', receipt_url: '/r/1' });
    expect(p).toMatchObject({ isRefund: false, amountText: '₹299', receiptUrl: '/r/1', receiptLabel: 'Tax invoice' });
    expect(historyView({ amount: 299, status: 'pending', receipt_url: null }).receiptUrl).toBeNull();
  });
  it('tax column only when some row has tax', () => {
    expect(anyTax([{ amount: 1, status: 'paid', tax_amount: 0 }])).toBe(false);
    expect(anyTax([{ amount: 1, status: 'paid', tax_amount: 0 }, { amount: -1, status: 'refunded', tax_amount: -15.25 }])).toBe(true);
  });
});

describe('free months', () => {
  it('says how many months the coupon adds', () => {
    const { freeMonthsNote } = require('@/lib/subscription/renewal-view');
    expect(freeMonthsNote(preview({}, { free_months: 2 }))).toBe('Your coupon adds 2 free months to your plan after you pay.');
    expect(freeMonthsNote(preview({}, { free_months: 1 }))).toContain('1 free month ');
    expect(freeMonthsNote(preview())).toBeNull();
  });
});
