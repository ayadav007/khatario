import type { PoolClient } from 'pg';
import { cancelFinalPurchase, PurchaseCancelError } from '@/lib/purchases/cancel-purchase';

/** The paid-bill refusal must not point users at payment void / supplier refund workflows that do not exist. */
describe('cancelFinalPurchase PURCHASE_HAS_PAYMENTS message', () => {
  async function refuse(paidAmount: number, livePayment: boolean) {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'p1', status: 'final', paid_amount: paidAmount }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: livePayment ? [{ '?column?': 1 }] : [] });
    const client = { query } as unknown as PoolClient;
    return cancelFinalPurchase(client, {
      businessId: 'b1',
      purchaseId: 'p1',
      userId: 'u1',
      reason: 'x',
      warehouseModeEnabled: false,
    }).catch((e) => e);
  }

  it.each([
    ['a live payment row', 0, true],
    ['a paid amount', 250, false],
  ])('refuses a bill with %s, truthfully', async (_label, paid, live) => {
    const err = await refuse(paid, live);
    expect(err).toBeInstanceOf(PurchaseCancelError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('PURCHASE_HAS_PAYMENTS');
    expect(err.message).toContain('cannot be cancelled because a payment has already been recorded');
    expect(err.message).toContain('purchase return');
    expect(err.message).not.toMatch(/void|refund/i);
  });
});
