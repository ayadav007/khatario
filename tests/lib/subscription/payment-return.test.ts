import {
  PAYMENT_POLL_MAX_MS,
  nextPollStep,
  parsePaymentReturn,
  paymentScreen,
  type ServerCheckoutStatus,
} from '@/lib/subscription/payment-return';

const q = (s: string) => new URLSearchParams(s);
const status = (over: Partial<ServerCheckoutStatus>): ServerCheckoutStatus => ({
  status: 'pending',
  kind: 'subscription',
  plan_name: 'Growth',
  addon_label: null,
  shortened_days: null,
  period_end: null,
  ...over,
});
const ret = { kind: 'subscription' as const, hint: 'success' as const, tx: 'abc' };

describe('parsePaymentReturn', () => {
  it('reads the payment and add-on returns with the payment id', () => {
    expect(parsePaymentReturn(q('payment=success&tx=abc'))).toEqual({ kind: 'subscription', hint: 'success', tx: 'abc' });
    expect(parsePaymentReturn(q('payment=pending&tx=abc'))).toEqual({ kind: 'subscription', hint: 'pending', tx: 'abc' });
    expect(parsePaymentReturn(q('addon=success&tx=abc'))).toEqual({ kind: 'addon', hint: 'success', tx: 'abc' });
    expect(parsePaymentReturn(q('addon=cancelled'))).toEqual({ kind: 'addon', hint: 'cancelled', tx: null });
  });
  it('is null when the page was not opened from a payment page, or the value is unknown', () => {
    expect(parsePaymentReturn(q(''))).toBeNull();
    expect(parsePaymentReturn(q('payment=maybe'))).toBeNull();
    expect(parsePaymentReturn(q('tab=plans'))).toBeNull();
  });
});

describe('nextPollStep', () => {
  it('asks again while pending, stops on any settled answer, times out after two minutes', () => {
    expect(nextPollStep(0, status({ status: 'pending' }))).toBe('again');
    expect(nextPollStep(10_000, null)).toBe('again');
    for (const s of ['completed', 'failed', 'expired', 'refunded'] as const) {
      expect(nextPollStep(1000, status({ status: s }))).toBe('stop');
    }
    expect(nextPollStep(PAYMENT_POLL_MAX_MS, status({ status: 'pending' }))).toBe('timeout');
    expect(nextPollStep(PAYMENT_POLL_MAX_MS + 1, null)).toBe('timeout');
  });
  it('a settled answer wins even after the two minutes', () => {
    expect(nextPollStep(PAYMENT_POLL_MAX_MS + 5000, status({ status: 'completed' }))).toBe('stop');
  });
});

describe('paymentScreen', () => {
  it('while the server has not answered it says "Checking your payment", never that the plan is active', () => {
    const s = paymentScreen(ret, null, false);
    expect(s).toMatchObject({ phase: 'checking', title: 'Checking your payment' });
    expect(`${s.title} ${s.body}`).not.toMatch(/active|welcome|unlocked|received/i);
  });
  it('a pending answer keeps saying checking, even when the URL said success', () => {
    expect(paymentScreen(ret, status({ status: 'pending' }), false).phase).toBe('checking');
  });
  it('says the plan is active only when the server says completed, by name', () => {
    expect(paymentScreen(ret, status({ status: 'completed' }), false)).toMatchObject({ phase: 'done', tone: 'success', title: 'Growth is active' });
  });
  it('shows the end date the server stored', () => {
    const s = paymentScreen(ret, status({ status: 'completed', period_end: '2027-01-20' }), false);
    expect(s.body).toContain('20 Jan 2027');
  });
  it('says how many days a shortened period bought', () => {
    const s = paymentScreen(ret, status({ status: 'completed', shortened_days: 20 }), false);
    expect(s.body).toContain('bought 20 days');
    expect(paymentScreen(ret, status({ status: 'completed', shortened_days: 1 }), false).body).toContain('bought 1 day.');
  });
  it('failed: plan not changed, money that left the account comes back through the bank', () => {
    const s = paymentScreen(ret, status({ status: 'failed' }), false);
    expect(s).toMatchObject({ phase: 'failed', tone: 'danger' });
    expect(s.body).toMatch(/did not go through and your plan was not changed/);
    expect(s.body).toMatch(/bank normally returns it within a few working days; write to support if it does not/);
    expect(s.body).not.toMatch(/nothing was charged/i);
  });
  it('expired and refunded have their own words', () => {
    expect(paymentScreen(ret, status({ status: 'expired' }), false).title).toBe('The payment link expired');
    expect(paymentScreen(ret, status({ status: 'expired' }), false).body).not.toMatch(/nothing was charged/i);
    expect(paymentScreen(ret, status({ status: 'refunded' }), false).title).toBe('This payment was refunded');
  });
  it('timeout: still being confirmed, switches on by itself, nothing to pay again', () => {
    const s = paymentScreen(ret, status({ status: 'pending' }), true);
    expect(s).toMatchObject({ phase: 'waiting', title: 'Your payment is still being confirmed' });
    expect(s.body).toMatch(/switch on by itself/);
    expect(s.body).toMatch(/do not need to pay again/);
  });
  it('an old link with no payment id is "still being confirmed", not success', () => {
    const s = paymentScreen({ ...ret, tx: null }, null, false);
    expect(s.phase).toBe('waiting');
    expect(s.title).not.toMatch(/active/);
  });
  it('a payment the server does not know is said plainly', () => {
    expect(paymentScreen(ret, null, false, true).title).toBe('We could not find this payment');
  });
  it('a cancelled return needs no waiting and changes nothing', () => {
    const s = paymentScreen({ ...ret, hint: 'cancelled' }, null, false);
    expect(s).toMatchObject({ phase: 'failed', title: 'Payment was not completed' });
    expect(s.body).toMatch(/plan was not changed/);
  });
  it('an add-on says add-on and names it', () => {
    const addon = { kind: 'addon' as const, hint: 'success' as const, tx: 'abc' };
    expect(paymentScreen(addon, status({ status: 'completed', kind: 'addon', addon_label: 'Khatario AI' }), false).title).toBe('Khatario AI is active');
    expect(paymentScreen(addon, status({ status: 'failed', kind: 'addon' }), false).body).toMatch(/did not go through/);
  });
  it('never prints a plan id: a missing plan name falls back to generic words', () => {
    const s = paymentScreen(ret, status({ status: 'completed', plan_name: null }), false);
    expect(s.title).toBe('Your plan is active');
  });
});
