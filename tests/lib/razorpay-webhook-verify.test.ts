import { createHmac } from 'crypto';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';

const WEBHOOK_SECRET = 'test_webhook_secret_for_audit';

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function successPayload(businessId: string, billingTxId: string, planId: string) {
  return {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_test_001',
          amount: 99900,
          currency: 'INR',
          status: 'captured',
          notes: {
            business_id: businessId,
            plan_id: planId,
            billing_cycle: 'monthly',
            billing_transaction_id: billingTxId,
          },
        },
      },
    },
  };
}

describe('RazorpayPaymentProvider.verifyWebhook', () => {
  const provider = new RazorpayPaymentProvider({
    clientId: 'rzp_test_x',
    clientSecret: 'secret',
    webhookSecret: WEBHOOK_SECRET,
  });

  it('rejects missing signature', async () => {
    const raw = JSON.stringify(successPayload('biz-1', 'tx-1', 'business'));
    const result = await provider.verifyWebhook({ rawBody: raw, headers: {} });
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/Missing.*Signature/i);
  });

  it('rejects invalid signature (fake webhook)', async () => {
    const raw = JSON.stringify(successPayload('biz-1', 'tx-1', 'business'));
    const result = await provider.verifyWebhook({
      rawBody: raw,
      headers: { 'x-razorpay-signature': 'deadbeef'.repeat(8) },
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/Invalid/i);
  });

  it('accepts valid HMAC signature', async () => {
    const raw = JSON.stringify(successPayload('biz-1', 'tx-1', 'business'));
    const result = await provider.verifyWebhook({
      rawBody: raw,
      headers: { 'x-razorpay-signature': sign(raw) },
    });
    expect(result.verified).toBe(true);
    expect(result.status).toBe('success');
    expect(result.providerPaymentId).toBe('pay_test_001');
  });

  it('rejects replay with tampered body after signing', async () => {
    const raw = JSON.stringify(successPayload('biz-1', 'tx-1', 'business'));
    const sig = sign(raw);
    const tampered = raw.replace('99900', '100');
    const result = await provider.verifyWebhook({
      rawBody: tampered,
      headers: { 'x-razorpay-signature': sig },
    });
    expect(result.verified).toBe(false);
  });
});

describe('RazorpayPaymentProvider.createHostedPaymentLink expiry', () => {
  const provider = new RazorpayPaymentProvider({ clientId: 'rzp_test_x', clientSecret: 'k' });
  afterEach(() => jest.restoreAllMocks());

  const stub = () =>
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'plink_x', short_url: 'https://rzp.io/x' })));

  it('sends expire_by when expiresAt is given', async () => {
    const fetchMock = stub();
    const expiresAt = new Date('2027-01-01T00:00:00Z');
    await provider.createHostedPaymentLink({ businessId: 'b', orderId: 'o', amount: 499, expiresAt });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).expire_by).toBe(
      Math.floor(expiresAt.getTime() / 1000),
    );
  });

  it('omits expire_by when expiresAt is not given', async () => {
    const fetchMock = stub();
    await provider.createHostedPaymentLink({ businessId: 'b', orderId: 'o', amount: 499 });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).not.toHaveProperty('expire_by');
  });
});
