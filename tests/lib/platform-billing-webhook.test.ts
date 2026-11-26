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

jest.mock('@/lib/subscription/module-subscriptions', () => ({
  getPrimaryModuleSubscription: jest.fn(async () => ({ module_key: 'billing', plan_id: 'trial' })),
}));

import { processPlatformRazorpayWebhook } from '@/lib/platform-billing';
import { BillingTransactionStateError } from '@/lib/platform-billing-transaction-state';

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
    completeSubscriptionCheckoutPayment.mockResolvedValue('activated');
    completeAddonCheckoutPayment.mockResolvedValue('activated');
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
      if (sql.includes('SELECT status FROM platform_billing_webhook_events')) {
        return { status: 'processed' };
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
  describe('event states (Task 5)', () => {
    function eventUpdates(status: string) {
      return query.mock.calls.filter(
        ([sql, params]) =>
          String(sql).includes('UPDATE platform_billing_webhook_events') &&
          Array.isArray(params) &&
          params[1] === status,
      );
    }

    it.each(['error', 'received'])('reprocesses an event whose stored status is %s', async (stored) => {
      mockVerifyWebhook.mockResolvedValueOnce(verifiedSuccessPayload());
      queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO platform_billing_webhook_events')) return null;
        if (sql.includes('SELECT status FROM platform_billing_webhook_events')) return { status: stored };
        return null;
      });
      query.mockResolvedValue(undefined);

      const result = await processPlatformRazorpayWebhook('{}', { 'x-razorpay-signature': 'valid' });
      expect(result).toEqual({ ok: true });
      expect(completeSubscriptionCheckoutPayment).toHaveBeenCalledTimes(1);
    });

    it('passes the verified paid amount and reports an already completed checkout as a duplicate', async () => {
      mockVerifyWebhook.mockResolvedValueOnce(verifiedSuccessPayload());
      queryOne.mockImplementation(async (sql: string) =>
        sql.includes('INSERT INTO platform_billing_webhook_events') ? { id: 'evt' } : null,
      );
      query.mockResolvedValue(undefined);
      completeSubscriptionCheckoutPayment.mockResolvedValueOnce('already_completed');

      const result = await processPlatformRazorpayWebhook('{}', { 'x-razorpay-signature': 'valid' });
      expect(result).toEqual({ ok: true, duplicate: true });
      expect(completeSubscriptionCheckoutPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 499 }));
      expect(eventUpdates('processed')[0][1][2]).toBe('Duplicate of a completed checkout');
    });

    it('answers Amount mismatch and marks the event ignored', async () => {
      mockVerifyWebhook.mockResolvedValueOnce(verifiedSuccessPayload());
      queryOne.mockImplementation(async (sql: string) =>
        sql.includes('INSERT INTO platform_billing_webhook_events') ? { id: 'evt' } : null,
      );
      query.mockResolvedValue(undefined);
      completeSubscriptionCheckoutPayment.mockRejectedValueOnce(new Error('AMOUNT_MISMATCH'));

      const result = await processPlatformRazorpayWebhook('{}', { 'x-razorpay-signature': 'valid' });
      expect(result).toEqual({ ok: false, error: 'Amount mismatch' });
      expect(eventUpdates('ignored')).toHaveLength(1);
    });

    it('marks the event error and rethrows when completion throws', async () => {
      mockVerifyWebhook.mockResolvedValueOnce(verifiedSuccessPayload());
      queryOne.mockImplementation(async (sql: string) =>
        sql.includes('INSERT INTO platform_billing_webhook_events') ? { id: 'evt' } : null,
      );
      query.mockResolvedValue(undefined);
      completeSubscriptionCheckoutPayment.mockRejectedValueOnce(new Error('boom'));

      await expect(processPlatformRazorpayWebhook('{}', { 'x-razorpay-signature': 'valid' })).rejects.toThrow('boom');
      const errored = query.mock.calls.find(([sql]) => String(sql).includes("status = 'error'"));
      expect(errored?.[1]).toEqual([expect.any(String), 'boom']);
    });
  });
  describe('fix round 1', () => {
    function cancelPayload() {
      return {
        verified: true as const,
        eventType: 'payment_link.cancelled',
        status: 'failed' as const,
        amount: 499,
        providerPaymentId: 'plink_x',
        rawPayload: {
          payload: { payment_link: { entity: { id: 'plink_x', notes: { business_id: BIZ, billing_transaction_id: TX } } } },
        },
      };
    }

    it('a cancel whose guarded update changes no row marks the event processed and sends nothing', async () => {
      mockVerifyWebhook.mockResolvedValueOnce(cancelPayload());
      queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO platform_billing_webhook_events')) return { id: 'evt' };
        if (sql.includes('SELECT status FROM billing_transactions')) return { status: 'pending' };
        return null;
      });
      query.mockImplementation(async (sql: string) =>
        sql.includes('UPDATE billing_transactions') ? { rows: [] } : undefined,
      );

      expect(await processPlatformRazorpayWebhook('{}', { 'x-razorpay-signature': 'valid' })).toEqual({ ok: true });
      const guarded = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE billing_transactions'));
      expect(String(guarded?.[0])).toMatch(/business_id = \$2 AND status = 'pending'/);
      const ev = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE platform_billing_webhook_events'));
      expect(ev?.[1][1]).toBe('processed');
      // no failure email path: dispatchBillingEmails would read the transaction through queryOne
      expect(queryOne.mock.calls.some(([sql]) => String(sql).includes('SELECT business_id, plan_id, amount'))).toBe(false);
    });

    it.each([
      ['CHECKOUT_TRANSACTION_NOT_FOUND', new Error('CHECKOUT_TRANSACTION_NOT_FOUND')],
      [
        'a refunded row',
        new BillingTransactionStateError('INVALID_STATUS_TRANSITION', 'Cannot transition billing transaction from refunded to completed', 'refunded', 'completed'),
      ],
    ])('a success that hits %s is ignored, not retried', async (_label, err) => {
      mockVerifyWebhook.mockResolvedValueOnce(verifiedSuccessPayload());
      queryOne.mockImplementation(async (sql: string) =>
        sql.includes('INSERT INTO platform_billing_webhook_events') ? { id: 'evt' } : null,
      );
      query.mockResolvedValue(undefined);
      completeSubscriptionCheckoutPayment.mockRejectedValueOnce(err);

      const result = await processPlatformRazorpayWebhook('{}', { 'x-razorpay-signature': 'valid' });
      expect(result).toMatchObject({ ok: true, error: expect.any(String) });
      const ev = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE platform_billing_webhook_events'));
      expect(ev?.[1][1]).toBe('ignored');
    });
  });
});
