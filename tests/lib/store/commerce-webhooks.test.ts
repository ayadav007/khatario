import { createHmac } from 'crypto';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import {
  hashStoreWebhookToken,
  isValidShiprocketWebhookToken,
  parseShiprocketWebhook,
} from '@/lib/store/delivery/webhooks';
import {
  canBookShipment,
  canTransitionStoreOrder,
  shouldDecrementStockOnPlace,
  shouldRestoreStockOnCancel,
  storePaymentAmountMatches,
  validateStoreOrderLines,
} from '@/lib/store/fulfillment-rules';

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

  it('does not deduct stock at checkout; the final invoice does', () => {
    expect(shouldDecrementStockOnPlace('razorpay')).toBe(false);
    expect(shouldDecrementStockOnPlace('cod')).toBe(false);
  });
});

describe('store order lifecycle rules', () => {
  it('allows only forward steps and cancellation before delivery', () => {
    expect(canTransitionStoreOrder('pending', 'confirmed')).toBe(true);
    expect(canTransitionStoreOrder('confirmed', 'ready')).toBe(true);
    expect(canTransitionStoreOrder('ready', 'delivered')).toBe(true);
    for (const from of ['pending', 'confirmed', 'ready']) {
      expect(canTransitionStoreOrder(from, 'cancelled')).toBe(true);
    }
  });

  it('rejects skipped, backward, terminal and unknown moves', () => {
    expect(canTransitionStoreOrder('pending', 'ready')).toBe(false);
    expect(canTransitionStoreOrder('ready', 'confirmed')).toBe(false);
    expect(canTransitionStoreOrder('pending', 'pending')).toBe(false);
    for (const to of ['pending', 'confirmed', 'ready', 'delivered', 'cancelled']) {
      expect(canTransitionStoreOrder('cancelled', to)).toBe(false);
      expect(canTransitionStoreOrder('delivered', to)).toBe(false);
    }
    expect(canTransitionStoreOrder('pending', 'shipped')).toBe(false);
  });

  it('does not add shelf stock back on cancel', () => {
    expect(shouldRestoreStockOnCancel('cod')).toBe(false);
    expect(shouldRestoreStockOnCancel('paid')).toBe(false);
    expect(shouldRestoreStockOnCancel('unpaid')).toBe(false);
  });
});

describe('store cart line validation', () => {
  it('accepts positive whole quantities', () => {
    expect(validateStoreOrderLines([{ item_id: 'i1', quantity: 2, variant_id: 'v1' }])).toEqual({
      ok: true,
      lines: [{ item_id: 'i1', variant_id: 'v1', quantity: 2 }],
    });
  });

  it.each([0, -1, 1.5, '2', null, Number.NaN, Number.POSITIVE_INFINITY])('rejects quantity %p', (quantity) => {
    expect(validateStoreOrderLines([{ item_id: 'i1', quantity }]).ok).toBe(false);
  });

  it('rejects an empty cart or a line without an item', () => {
    expect(validateStoreOrderLines([]).ok).toBe(false);
    expect(validateStoreOrderLines(undefined).ok).toBe(false);
    expect(validateStoreOrderLines([{ quantity: 1 }]).ok).toBe(false);
  });
});

describe('store payment amount check', () => {
  it('matches to the paisa only', () => {
    expect(storePaymentAmountMatches(1234.5, 1234.5)).toBe(true);
    expect(storePaymentAmountMatches(1234.49, 1234.5)).toBe(false);
    expect(storePaymentAmountMatches(1300, 1234.5)).toBe(false);
    expect(storePaymentAmountMatches(undefined, 10)).toBe(false);
  });
});

describe('Shiprocket webhook token', () => {
  it('requires 24+ alphanumeric characters and hashes deterministically', () => {
    expect(isValidShiprocketWebhookToken('a'.repeat(24))).toBe(true);
    expect(isValidShiprocketWebhookToken('short')).toBe(false);
    expect(isValidShiprocketWebhookToken(`${'a'.repeat(24)}-`)).toBe(false);
    expect(hashStoreWebhookToken('abc')).toBe(hashStoreWebhookToken('abc'));
    expect(hashStoreWebhookToken('abc')).toHaveLength(64);
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
