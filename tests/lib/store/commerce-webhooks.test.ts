import { createHmac } from 'crypto';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { parseShiprocketWebhook } from '@/lib/store/delivery/webhooks';
import { canBookShipment, shouldDecrementStockOnPlace } from '@/lib/store/fulfillment-rules';

describe('Razorpay store webhook signature', () => {
  const secret = 'whsec_test';
  const provider = new RazorpayPaymentProvider({
    clientId: 'rzp_test_x',
    clientSecret: secret,
    webhookSecret: secret,
  });

  it('accepts a valid HMAC signature', async () => {
    const rawBody = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'plink_1',
            status: 'paid',
            notes: { store_order_id: 'ord1', business_id: 'biz1' },
          },
        },
      },
    });
    const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
    const result = await provider.verifyWebhook({
      rawBody,
      headers: { 'x-razorpay-signature': sig },
    });
    expect(result.verified).toBe(true);
    expect(result.status).toBe('success');
  });

  it('rejects a bad signature', async () => {
    const rawBody = JSON.stringify({ event: 'payment_link.paid' });
    const result = await provider.verifyWebhook({
      rawBody,
      headers: { 'x-razorpay-signature': '00' },
    });
    expect(result.verified).toBe(false);
  });
});

describe('store fulfilment rules', () => {
  it('does not ship unpaid prepaid orders', () => {
    expect(canBookShipment('unpaid')).toBe(false);
    expect(canBookShipment('paid')).toBe(true);
    expect(canBookShipment('cod')).toBe(true);
  });

  it('does not decrement stock on unpaid Razorpay place', () => {
    expect(shouldDecrementStockOnPlace('razorpay')).toBe(false);
    expect(shouldDecrementStockOnPlace('cod')).toBe(true);
  });
});

describe('Shiprocket webhook mapping', () => {
  it('maps delivered and cancelled statuses', () => {
    expect(parseShiprocketWebhook({ current_status: 'Delivered', awb: 'A1' }).status).toBe(
      'delivered',
    );
    expect(parseShiprocketWebhook({ shipment_status: 'RTO', awb: 'A2' }).status).toBe(
      'cancelled',
    );
    expect(parseShiprocketWebhook({ current_status: 'In Transit', awb: 'A3' }).status).toBe(
      'ready',
    );
  });
});
