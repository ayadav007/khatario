import {
  buildCancelPurchaseBody,
  computePurchaseTotals,
  draftDeletedMessage,
  getPurchaseAction,
  matchesPurchaseStatusFilter,
  purchaseRowBalance,
  type PurchaseTotalsInput,
} from '@/lib/accounting-ui/purchase-actions';

const bill = (over: Partial<PurchaseTotalsInput>): PurchaseTotalsInput => ({
  status: 'final',
  payment_status: 'unpaid',
  grand_total: 1000,
  paid_amount: 0,
  ...over,
});

describe('getPurchaseAction', () => {
  it('offers "Delete draft" for drafts', () => {
    expect(getPurchaseAction({ status: 'draft', paid_amount: 0 })).toEqual({ kind: 'delete_draft' });
  });

  it('offers "Cancel bill" for unpaid final bills', () => {
    expect(getPurchaseAction({ status: 'final', paid_amount: '0.00' })).toEqual({ kind: 'cancel_bill' });
  });

  it('offers no action for cancelled bills', () => {
    expect(getPurchaseAction({ status: 'cancelled', paid_amount: 0 }).kind).toBe('none');
  });

  it('blocks cancel when a payment is recorded, with the payment message', () => {
    const action = getPurchaseAction({ status: 'final', paid_amount: '250.00' });
    expect(action.kind).toBe('cancel_bill');
    expect(action.blocked?.code).toBe('PURCHASE_HAS_PAYMENTS');
    expect(action.blocked?.message).toContain(
      'This bill cannot be cancelled because a payment has already been recorded.'
    );
  });

  it('does not block a draft that carries payments (draft delete reverses them)', () => {
    expect(getPurchaseAction({ status: 'draft', paid_amount: 500 }).blocked).toBeUndefined();
  });
});

describe('purchase totals and filters', () => {
  const list = [
    bill({ grand_total: 1000, paid_amount: 400, payment_status: 'partially_paid' }),
    bill({ grand_total: 500, paid_amount: 500, payment_status: 'paid' }),
    bill({ status: 'cancelled', grand_total: 9999, paid_amount: 0, payment_status: 'unpaid' }),
    bill({ status: 'cancelled', grand_total: 700, paid_amount: 700, payment_status: 'paid' }),
  ];

  it('excludes cancelled bills from total, paid and due', () => {
    expect(computePurchaseTotals(list)).toEqual({ total: 1500, paid: 900, due: 600 });
  });

  it('excludes cancelled bills from the unpaid filter', () => {
    const unpaid = list.filter((p) => matchesPurchaseStatusFilter(p, 'unpaid'));
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0].status).toBe('final');
  });

  it('excludes cancelled bills from the paid filter', () => {
    const paid = list.filter((p) => matchesPurchaseStatusFilter(p, 'paid'));
    expect(paid.map((p) => p.status)).toEqual(['final']);
  });

  it('shows no outstanding balance on a cancelled row', () => {
    expect(purchaseRowBalance(list[0])).toBe(600);
    expect(purchaseRowBalance(list[2])).toBe(0);
  });

  it('keeps cancelled bills visible under "All" and "Cancelled"', () => {
    expect(list.filter((p) => matchesPurchaseStatusFilter(p, 'all'))).toHaveLength(4);
    expect(list.filter((p) => matchesPurchaseStatusFilter(p, 'cancelled'))).toHaveLength(2);
  });
});

describe('purchase requests and messages', () => {
  it('cancel body carries only the trimmed reason, never cancelled_by', () => {
    const body = JSON.parse(buildCancelPurchaseBody('  Entered twice  '));
    expect(body).toEqual({ reason: 'Entered twice' });
    expect(body).not.toHaveProperty('cancelled_by');
  });

  it('draft delete message shows the supplier balance adjustment', () => {
    expect(draftDeletedMessage({ supplier_balance_restored: 1250.5 })).toBe(
      'Draft deleted. Supplier balance adjusted by ₹1,250.5.'
    );
    expect(draftDeletedMessage({ supplier_balance_restored: 0 })).toBe('Draft deleted.');
    expect(draftDeletedMessage(null)).toBe('Draft deleted.');
  });
});
