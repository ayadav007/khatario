import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';

describe('RazorpayPaymentProvider.fetchRefund', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function stub(body: Record<string, unknown>, status = 200) {
    const calls: { url: string; init?: RequestInit }[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return calls;
  }

  const provider = new RazorpayPaymentProvider({ clientId: 'rzp_test_key', clientSecret: 'secret' });

  it('fetchRefund maps Razorpay statuses', async () => {
    const calls = stub({ id: 'rfnd_1', status: 'processed' });
    await expect(provider.fetchRefund({ providerPaymentId: 'pay_1', providerRefundId: 'rfnd_1' })).resolves.toEqual({
      status: 'processed',
    });
    expect(calls[0].url).toBe('https://api.razorpay.com/v1/payments/pay_1/refunds/rfnd_1');
    expect(calls[0].init?.method ?? 'GET').toBe('GET');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);

    stub({ id: 'rfnd_1', status: 'failed' });
    await expect(provider.fetchRefund({ providerPaymentId: 'pay_1', providerRefundId: 'rfnd_1' })).resolves.toEqual({
      status: 'failed',
    });

    stub({ id: 'rfnd_1', status: 'pending' });
    await expect(provider.fetchRefund({ providerPaymentId: 'pay_1', providerRefundId: 'rfnd_1' })).resolves.toEqual({
      status: 'pending',
    });

    stub({ id: 'rfnd_1', status: 'created' });
    await expect(provider.fetchRefund({ providerPaymentId: 'pay_1', providerRefundId: 'rfnd_1' })).resolves.toEqual({
      status: 'pending',
    });
  });

  it('fetchRefund throws when Razorpay refuses the lookup', async () => {
    stub({ error: { code: 'BAD_REQUEST_ERROR' } }, 400);
    await expect(provider.fetchRefund({ providerPaymentId: 'pay_1', providerRefundId: 'rfnd_x' })).rejects.toThrow(
      'Razorpay refund lookup failed: 400',
    );
  });
});
