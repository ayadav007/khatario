import { allocateCreditFifo, unusedCreditAmount } from '@/lib/credit-notes/customer-credit';

describe('unused customer credit', () => {
  it('keeps nothing when the credit note only cancels an unpaid bill', () => {
    expect(
      unusedCreditAmount({
        grandTotal: 1416,
        settledOnSourceInvoice: 1416,
        appliedToLaterInvoices: 0,
        refundedAmount: 0,
      })
    ).toBe(0);
  });

  it('keeps the amount the customer had already paid', () => {
    expect(
      unusedCreditAmount({
        grandTotal: 1416,
        settledOnSourceInvoice: 916,
        appliedToLaterInvoices: 0,
        refundedAmount: 0,
      })
    ).toBe(500);
  });

  it('keeps the whole note when the bill was fully paid', () => {
    expect(
      unusedCreditAmount({
        grandTotal: 1416,
        settledOnSourceInvoice: 0,
        appliedToLaterInvoices: 0,
        refundedAmount: 0,
      })
    ).toBe(1416);
  });

  it('reduces what was already used on a later invoice or refunded', () => {
    expect(
      unusedCreditAmount({
        grandTotal: 1416,
        settledOnSourceInvoice: 0,
        appliedToLaterInvoices: 400,
        refundedAmount: 16,
      })
    ).toBe(1000);
  });

  it('allocates oldest credit first and does not exceed the request', () => {
    expect(
      allocateCreditFifo(
        [
          { id: 'a', available: 500 },
          { id: 'b', available: 1000 },
        ],
        800
      )
    ).toEqual([
      { id: 'a', amount: 500 },
      { id: 'b', amount: 300 },
    ]);
  });
});
