import { cashSaleDebitLines } from '@/lib/accounting/cash-sale-debits';

describe('cashSaleDebitLines', () => {
  it('splits a walk-in bill into each mode when the payments match the total', () => {
    expect(
      cashSaleDebitLines(1200, [
        { mode: 'Cash', amount: 500 },
        { mode: 'upi', amount: 700 },
      ]),
    ).toEqual([
      { mode: 'cash', amount: 500 },
      { mode: 'upi', amount: 700 },
    ]);
  });

  it('keeps two UPI receipts on different banks apart', () => {
    expect(
      cashSaleDebitLines(300, [
        { mode: 'upi', amount: 100, settlementAccountId: 'hdfc' },
        { mode: 'upi', amount: 200, settlementAccountId: 'sbi' },
      ]),
    ).toEqual([
      { mode: 'upi', amount: 100, settlementAccountId: 'hdfc' },
      { mode: 'upi', amount: 200, settlementAccountId: 'sbi' },
    ]);
  });

  it('adds two lines of the same mode', () => {
    expect(
      cashSaleDebitLines(300, [
        { mode: 'cash', amount: 100 },
        { mode: 'cash', amount: 200 },
      ]),
    ).toEqual([{ mode: 'cash', amount: 300 }]);
  });

  it('leaves a short collection on the single cash posting', () => {
    expect(cashSaleDebitLines(1200, [{ mode: 'upi', amount: 700 }])).toBeNull();
  });

  it('ignores empty payments', () => {
    expect(cashSaleDebitLines(100, [])).toBeNull();
  });
});
