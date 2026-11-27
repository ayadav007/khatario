import {
  endPlanChoices,
  validateRefundForm,
  refundConfirmText,
  needsTypedConfirm,
  isFullRefund,
  PARTIAL_REFUND_NOTE,
  gstErrorField,
  GST_MODE_OPTIONS,
} from '@/lib/subscription/refund-view';

describe('end-plan choices', () => {
  it('names the date the server gave, and says what "now" does', () => {
    const [keep, now] = endPlanChoices('2026-12-20');
    expect(keep.value).toBe('period_end');
    expect(keep.explain).toContain('20 Dec 2026');
    expect(now.explain).toMatch(/free plan today/);
  });
  it('uses what the server says each choice does, word for word', () => {
    const [keep, now] = endPlanChoices('2026-12-20', { now: 'NOW TEXT', period_end: 'KEEP TEXT' });
    expect(keep.explain).toBe('KEEP TEXT');
    expect(now.explain).toBe('NOW TEXT');
  });
  it('without a date it still explains', () => {
    expect(endPlanChoices(null)[0].explain).toMatch(/end of the period they paid for/);
  });
});

describe('validateRefundForm', () => {
  const ok = { amountText: '100', reason: 'Customer asked', max: 249 };
  it('accepts a valid form', () => expect(validateRefundForm(ok)).toEqual({ ok: true, amount: 100 }));
  it('accepts the maximum and paise', () => {
    expect(validateRefundForm({ ...ok, amountText: '249' })).toMatchObject({ ok: true });
    expect(validateRefundForm({ ...ok, amountText: '199.33' })).toEqual({ ok: true, amount: 199.33 });
  });
  it('refuses zero, text, too much, three decimals and a missing reason', () => {
    expect(validateRefundForm({ ...ok, amountText: '0' })).toMatchObject({ ok: false });
    expect(validateRefundForm({ ...ok, amountText: 'abc' })).toMatchObject({ ok: false });
    expect(validateRefundForm({ ...ok, amountText: '250' })).toEqual({ ok: false, error: 'You can refund at most ₹249 on this payment.' });
    expect(validateRefundForm({ ...ok, amountText: '1.234' })).toMatchObject({ ok: false });
    expect(validateRefundForm({ ...ok, reason: '  ' })).toMatchObject({ ok: false });
  });
});

describe('refundConfirmText', () => {
  it('states the amount and the gateway', () => {
    const t = refundConfirmText({ amount: 199.33, viaGateway: true, endPlan: 'now', planEndDate: null });
    expect(t[0]).toContain('₹199.33');
    expect(t[0]).toContain('through the payment gateway');
  });
  it('does not promise money for a manual payment', () => {
    expect(refundConfirmText({ amount: 50, viaGateway: false, endPlan: 'period_end', planEndDate: '2026-12-20' })[0]).toContain('no money moves automatically');
  });
});

describe('a partial refund never changes the plan', () => {
  it('only the amount that equals everything refundable is a full refund', () => {
    expect(isFullRefund(249, 249)).toBe(true);
    expect(isFullRefund(249.0, 249.001)).toBe(true); // paise comparison
    expect(isFullRefund(50, 299)).toBe(false);
    expect(isFullRefund(0, 299)).toBe(false);
  });
  it('the confirm text for a partial refund says the plan is not changed and shows no end-plan wording', () => {
    const t = refundConfirmText({ amount: 50, viaGateway: true, endPlan: 'now', planEndDate: null, partial: true });
    expect(t).toContain(PARTIAL_REFUND_NOTE);
    expect(PARTIAL_REFUND_NOTE).toBe("Partial refund. The customer's plan is not changed.");
    expect(t.join(' ')).not.toMatch(/free plan|normally left/);
  });
  it('the confirm text for a full refund explains the chosen end-plan option', () => {
    const t = refundConfirmText({ amount: 299, viaGateway: true, endPlan: 'now', planEndDate: null, effects: { now: 'NOW TEXT', period_end: 'KEEP' } });
    expect(t).toContain('NOW TEXT');
  });
});

describe('GST settings helpers', () => {
  it('typed confirmation when moving to a taxed mode, not when staying or going back to none', () => {
    expect(needsTypedConfirm('none', 'exclusive')).toBe(true);
    expect(needsTypedConfirm('none', 'inclusive')).toBe(true);
    expect(needsTypedConfirm('inclusive', 'exclusive')).toBe(true);
    expect(needsTypedConfirm('exclusive', 'exclusive')).toBe(false);
    expect(needsTypedConfirm('exclusive', 'none')).toBe(false);
  });
  it('a rate change while tax is charged or shown needs it too; going to none never does', () => {
    expect(needsTypedConfirm('exclusive', 'exclusive', true)).toBe(true);
    expect(needsTypedConfirm('inclusive', 'inclusive', true)).toBe(true);
    expect(needsTypedConfirm('none', 'none', true)).toBe(false);
    expect(needsTypedConfirm('exclusive', 'none', true)).toBe(false);
  });
  it('maps the server messages to their field', () => {
    expect(gstErrorField('Seller GSTIN: check digit is wrong')).toBe('seller_gstin');
    expect(gstErrorField('The GST rate must be a number from 0 to 28.')).toBe('rate_percent');
    expect(gstErrorField("Add the seller's legal name before switching GST on. Prices are not changed until you do.")).toBe('seller_legal_name');
    expect(gstErrorField('SAC code must be 4 to 8 digits.')).toBe('sac_code');
    expect(gstErrorField('The invoice prefix must be 1 to 10 letters or digits.')).toBe('invoice_prefix');
    expect(gstErrorField('Could not save tax settings')).toBeNull();
  });
  it('explains each mode', () => {
    expect(GST_MODE_OPTIONS.map((o) => o.value)).toEqual(['none', 'inclusive', 'exclusive']);
  });
});
