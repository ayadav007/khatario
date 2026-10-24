import { computeBrs, signedStatementAmount } from '@/lib/bank/brs';

describe('signedStatementAmount', () => {
  it('deposit is positive, withdrawal negative', () => {
    expect(signedStatementAmount(null, '1500.50')).toBe(1500.5);
    expect(signedStatementAmount('200', 0)).toBe(-200);
  });
});

describe('computeBrs', () => {
  it('reconciles books to bank with all four adjustments', () => {
    // Books 1,00,000 Dr. Cheque issued 20,000 not presented; deposit 5,000 not credited;
    // bank charges 118 and interest 350 not booked. Bank should show 1,15,232.
    const r = computeBrs({
      bookBalance: 100000,
      ledgerItemsNotOnStatement: [
        { debit: 0, credit: 20000 },
        { debit: 5000, credit: 0 },
      ],
      bankItemsNotInBooks: [
        { debit_amount: 118, credit_amount: 0 },
        { debit_amount: 0, credit_amount: 350 },
      ],
      statementBalance: 115232,
    });
    expect(r.add_cheques_issued_not_presented).toBe(20000);
    expect(r.less_deposits_not_credited).toBe(5000);
    expect(r.less_bank_debits_not_in_books).toBe(118);
    expect(r.add_bank_credits_not_in_books).toBe(350);
    expect(r.balance_per_bank_computed).toBe(115232);
    expect(r.unexplained_difference).toBe(0);
  });

  it('reports an unexplained difference and handles overdraft', () => {
    const r = computeBrs({
      bookBalance: -5000,
      ledgerItemsNotOnStatement: [],
      bankItemsNotInBooks: [],
      statementBalance: -4990,
    });
    expect(r.balance_per_bank_computed).toBe(-5000);
    expect(r.unexplained_difference).toBe(10);
  });

  it('no statement balance gives null difference', () => {
    const r = computeBrs({ bookBalance: 10, ledgerItemsNotOnStatement: [], bankItemsNotInBooks: [], statementBalance: null });
    expect(r.unexplained_difference).toBeNull();
  });
});
