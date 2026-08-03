const completeSubscriptionCheckoutPayment = jest.fn();
const completeAddonCheckoutPayment = jest.fn();

const mockVerifyWebhook = jest.fn();

jest.mock('@/lib/platform-subscription-checkout', () => ({
  getPlatformRazorpayProvider: jest.fn(() => ({
    verifyWebhook: mockVerifyWebhook,
  })),
  completeSubscriptionCheckoutPayment: (...args: unknown[]) =>
    completeSubscriptionCheckoutPayment(...args),
  extractCheckoutMetaFromWebhookNotes: jest.requireActual(
    '@/lib/platform-subscription-checkout',
  ).extractCheckoutMetaFromWebhookNotes,
}));

jest.mock('@/lib/platform-addon-checkout', () => ({
  completeAddonCheckoutPayment: (...args: unknown[]) =>
    completeAddonCheckoutPayment(...args),
  isWhatsAppAddonType: (v: unknown) =>
    v === 'whatsapp_bot' || v === 'whatsapp_send_message',
}));

const queryOne = jest.fn();
const query = jest.fn();

jest.mock('@/lib/db', () => ({
  queryOne: (...args: unknown[]) => queryOne(...args),
  query: (...args: unknown[]) => query(...args),
  queryRows: jest.fn(),
}));

jest.mock('@/lib/subscription', () => ({
  clearSubscriptionCache: jest.fn(),
}));

import { processPlatformRazorpayWebhook } from '@/lib/platform-billing';

const BIZ = '00000000-0000-4000-8000-000000000001';
const TX = '00000000-0000-4000-8000-000000000002';

function verifiedSuccessPayload() {
  return {
    verified: true as const,
    eventType: 'payment.captured',
    status: 'success' as const,
    amount: 499,
    providerPaymentId: 'pay_test_001',
    rawPayload: {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_001',
            notes: {
              business_id: BIZ,
              plan_id: 'business',
              billing_cycle: 'monthly',
              billing_transaction_id: TX,
            },
          },
        },
      },
    },
  };
}

describe('processPlatformRazorpayWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    completeSubscriptionCheckoutPayment.mockResolvedValue(undefined);
    completeAddonCheckoutPayment.mockResolvedValue(undefined);
  });

  it('returns error when provider not configured', async () => {
    const { getPlatformRazorpayProvider } = await import(
      '@/lib/platform-subscription-checkout'
    );
    (getPlatformRazorpayProvider as jest.Mock).mockReturnValueOnce(null);

    const result = await processPlatformRazorpayWebhook('{}', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  it('rejects unverified webhook (invalid signature / fake webhook)', async () => {
    mockVerifyWebhook.mockResolvedValueOnce({
      verified: false,
      reason: 'Invalid Razorpay webhook signature',
    });

    const result = await processPlatformRazorpayWebhook('{}', {
      'x-razorpay-signature': 'bad',
    });
    expect(result.ok).toBe(false);
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });

  it('activates subscription only on verified success webhook', async () => {
    mockVerifyWebhook.mockResolvedValueOnce(verifiedSuccessPayload());

    queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO platform_billing_webhook_events')) return { id: 'evt1' };
      if (sql.includes('FROM business_subscriptions')) return { id: 'sub1', plan_id: 'trial' };
      if (sql.includes('SELECT status FROM billing_transactions')) {
        return { status: 'pending' };
      }
      if (sql.includes('SELECT coupon_id, status FROM billing_transactions')) {
        return { coupon_id: null, status: 'pending' };
      }
      return null;
    });
    query.mockResolvedValue(undefined);

    const result = await processPlatformRazorpayWebhook('{}', {
      'x-razorpay-signature': 'valid',
    });

    expect(result.ok).toBe(true);
    expect(completeSubscriptionCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ,
        planId: 'business',
        billingTransactionId: TX,
      }),
    );
  });

  it('does not activate on failed payment status (missing webhook success)', async () => {
    mockVerifyWebhook.mockResolvedValueOnce({
      verified: true,
      eventType: 'payment.failed',
      status: 'failed',
      amount: 499,
      providerPaymentId: 'pay_fail',
      rawPayload: {
        payload: {
          payment: {
            entity: {
              notes: {
                business_id: BIZ,
                plan_id: 'business',
                billing_transaction_id: TX,
              },
            },
          },
        },
      },
    });

    queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO platform_billing_webhook_events')) return { id: 'evt2' };
      if (sql.includes('FROM business_subscriptions')) return { id: 'sub1', plan_id: 'trial' };
      if (sql.includes('SELECT status FROM billing_transactions')) {
        return { status: 'pending' };
      }
      return null;
    });
    query.mockResolvedValue(undefined);

    const result = await processPlatformRazorpayWebhook('{}', {
      'x-razorpay-signature': 'valid',
    });

    expect(result.ok).toBe(true);
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });

  it('treats duplicate webhook as idempotent (no second activation)', async () => {
    mockVerifyWebhook.mockResolvedValueOnce(verifiedSuccessPayload());

    queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO platform_billing_webhook_events')) {
        return null;
      }
      return null;
    });

    const result = await processPlatformRazorpayWebhook('{}', {
      'x-razorpay-signature': 'valid',
    });

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });

  it('legacy webhook without checkout metadata is ignored (no subscription activation)', async () => {
    mockVerifyWebhook.mockResolvedValueOnce({
      verified: true,
      eventType: 'payment.captured',
      status: 'success',
      amount: 499,
      providerPaymentId: 'pay_legacy_only',
      rawPayload: {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_legacy_only',
              notes: {
                business_id: BIZ,
                plan_id: 'business',
              },
            },
          },
        },
      },
    });

    queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO platform_billing_webhook_events')) return { id: 'evt-legacy' };
      if (sql.includes('FROM business_subscriptions')) return { id: 'sub1', plan_id: 'trial' };
      return null;
    });
    query.mockResolvedValue(undefined);

    const result = await processPlatformRazorpayWebhook('{}', {
      'x-razorpay-signature': 'valid',
    });

    expect(result.ok).toBe(true);
    expect(result.error).toMatch(/checkout transaction reference required/i);
    expect(completeSubscriptionCheckoutPayment).not.toHaveBeenCalled();
  });
});
