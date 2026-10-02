import { createHash } from 'crypto';
import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';

const KEY = 'PLATKEY';
const SALT = 'PLATSALT';

const completeSubscriptionCheckoutPayment = jest.fn();
const completeAddonCheckoutPayment = jest.fn();
const updateStatusQueries: unknown[][] = [];

jest.mock('@/lib/platform-subscription-checkout', () => ({
  getPlatformRazorpayProvider: jest.fn(() => null),
  getPlatformEasebuzzProvider: jest.fn(
    () => new (jest.requireActual('@/lib/payments/providers/easebuzz-payment-provider').EasebuzzPaymentProvider)({
      clientId: 'PLATKEY',
      clientSecret: 'PLATSALT',
    }),
  ),
  completeSubscriptionCheckoutPayment: (...args: unknown[]) => completeSubscriptionCheckoutPayment(...args),
  extractCheckoutMetaFromWebhookNotes: jest.fn(() => ({})),
}));

jest.mock('@/lib/platform-addon-checkout', () => ({
  completeAddonCheckoutPayment: (...args: unknown[]) => completeAddonCheckoutPayment(...args),
  isWhatsAppAddonType: (v: unknown) => v === 'whatsapp_bot' || v === 'whatsapp_send_message',
}));

const queryOne = jest.fn();
const query = jest.fn(async (...args: unknown[]) => {
  updateStatusQueries.push(args);
  return undefined;
});

jest.mock('@/lib/db', () => ({
  queryOne: (...args: unknown[]) => queryOne(...args),
  query: (...args: unknown[]) => query(...args),
  queryRows: jest.fn(async () => []),
}));

jest.mock('@/lib/subscription', () => ({ clearSubscriptionCache: jest.fn() }));

import { processPlatformEasebuzzCallback } from '@/lib/platform-billing';

const BIZ = '00000000-0000-4000-8000-000000000001';
const TX = '00000000-0000-4000-8000-000000000002';
const TXNID = 'PB-00000000000040008000-1700000000000';

function body(fields: Record<string, string>, salt = SALT) {
  const f = {
    key: KEY,
    txnid: TXNID,
    amount: '999.00',
    productinfo: 'Khatario Business monthly',
    firstname: 'Acme',
    email: 'owner@acme.in',
    udf1: TX,
    udf2: BIZ,
    status: 'success',
    easepayid: 'EPLAT001',
    ...fields,
  };
  const hash = createHash('sha512')
    .update(
      [salt, f.status, '', '', '', '', '', '', '', '', f.udf2, f.udf1, f.email, f.firstname, f.productinfo, f.amount, f.txnid, f.key].join('|'),
    )
    .digest('hex');
  return new URLSearchParams({ ...f, hash }).toString();
}

function billingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX,
    business_id: BIZ,
    plan_id: 'business',
    billing_cycle: 'monthly',
    status: 'pending',
    total_amount: '999.00',
    gateway_response: { checkout_type: 'subscription', provider: 'easebuzz' },
    ...overrides,
  };
}

function mockDb(row: Record<string, unknown> | null, eventIsNew = true) {
  queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM billing_transactions')) return row;
    if (sql.includes('INSERT INTO platform_billing_webhook_events')) return eventIsNew ? { id: 'evt' } : null;
    if (sql.includes('SELECT status FROM billing_transactions')) return { status: 'pending' };
    return null;
  });
}

describe('processPlatformEasebuzzCallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateStatusQueries.length = 0;
    completeSubscriptionCheckoutPayment.mockResolvedValue(undefined);
    completeAddonCheckoutPayment.mockResolvedValue(undefined);
  });

  it('completes the subscription from the stored billing row, not the callback udfs', async () => {
    mockDb(billingRow());
    const r = await processPlatformEasebuzzCallback(body({ udf2: 'attacker-business' }));
    expect(r).toMatchObject({ ok: true, outcome: 'paid', checkoutType: 'subscription', planId: 'business' });
    expect(completeSubscriptionCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ,
        planId: 'business',
        billingTransactionId: TX,
        providerPaymentId: 'EPLAT001',
        paymentMethod: 'easebuzz',
      }),
    );
  });

  it('completes a WhatsApp add-on checkout', async () => {
    mockDb(billingRow({ gateway_response: { checkout_type: 'whatsapp_addon', addon_type: 'whatsapp_bot' } }));
    const r = await processPlatformEasebuzzCallback(body({}));
    expect(r).toMatchObject({ ok: true, outcome: 'paid', checkoutType: 'whatsapp_addon', addonType: 'whatsapp_bot' });
    expect(completeAddonCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BIZ, addonType: 'whatsapp_bot', paymentMethod: 'easebuzz' }),
    );
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });

  it('rejects a body signed with another salt', async () => {
    mockDb(billingRow());
    const r = await processPlatformEasebuzzCallback(body({}, 'NOTOURSALT'));
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(401);
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });

  it('refuses to activate when the paid amount differs from the billing row', async () => {
    mockDb(billingRow());
    const r = await processPlatformEasebuzzCallback(body({ amount: '1.00' }));
    expect(r).toMatchObject({ ok: false, httpStatus: 422 });
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });

  it('treats a repeat of the same result as a duplicate', async () => {
    mockDb(billingRow(), false);
    const r = await processPlatformEasebuzzCallback(body({}));
    expect(r).toMatchObject({ ok: true, outcome: 'duplicate' });
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });

  it('reports an already completed checkout as paid without re-applying it', async () => {
    mockDb(billingRow({ status: 'completed' }));
    const r = await processPlatformEasebuzzCallback(body({}));
    expect(r).toMatchObject({ ok: true, outcome: 'paid' });
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });

  it('marks a failed payment failed and does not activate', async () => {
    mockDb(billingRow());
    const r = await processPlatformEasebuzzCallback(body({ status: 'failure' }));
    expect(r).toMatchObject({ ok: true, outcome: 'failed' });
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
    expect(
      updateStatusQueries.some(([sql]) => String(sql).includes('UPDATE billing_transactions')),
    ).toBe(true);
  });

  it('ignores a txnid that Khatario never issued', async () => {
    mockDb(null);
    const r = await processPlatformEasebuzzCallback(body({}));
    expect(r).toMatchObject({ ok: true, outcome: 'ignored' });
  });
});

describe('platform provider switch', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('with nothing saved in admin, stays on Razorpay unless PLATFORM_PAYMENT_PROVIDER=easebuzz and Easebuzz env is set', async () => {
    const real = jest.requireActual('@/lib/platform-subscription-checkout') as typeof import('@/lib/platform-subscription-checkout');
    queryOne.mockReset();
    queryOne.mockResolvedValue(null);
    delete process.env.PLATFORM_PAYMENT_PROVIDER;
    process.env.PLATFORM_EASEBUZZ_KEY = KEY;
    process.env.PLATFORM_EASEBUZZ_SALT = SALT;
    expect(await real.getPlatformPaymentProviderId()).toBe('razorpay');

    process.env.PLATFORM_PAYMENT_PROVIDER = 'easebuzz';
    expect(await real.getPlatformPaymentProviderId()).toBe('easebuzz');
    expect((await real.getPlatformCheckoutProvider())?.provider).toBeInstanceOf(EasebuzzPaymentProvider);

    delete process.env.PLATFORM_EASEBUZZ_SALT;
    expect(await real.getPlatformPaymentProviderId()).toBe('razorpay');
  });
});
