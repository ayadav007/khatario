jest.mock('@/lib/ledger-utils', () => ({ getAccountForPaymentMode: jest.fn() }));

import { splitExpense, ExpenseValidationError } from '@/lib/accounting/expense-posting';
import { parseExpenseTaxFields } from '@/lib/accounting/expense-fields';
import { buildClosingLines } from '@/lib/accounting/year-close';
import { disposalLines } from '@/lib/accounting/fixed-asset-posting';
import { counterAccountCodes, itcReversalSplit } from '@/lib/inventory/adjustment-posting';

const sum = (lines: Array<{ debit: number; credit: number }>) =>
  lines.reduce((a, l) => ({ dr: a.dr + l.debit, cr: a.cr + l.credit }), { dr: 0, cr: 0 });

describe('splitExpense', () => {
  it('claims ITC on an eligible intra-state bill', () => {
    const s = splitExpense({ amount: 1180, cgst: 90, sgst: 90, igst: 0, itcEligible: true, isReverseCharge: false, tdsAmount: 0 });
    expect(s.expenseDebit).toBe(1000);
    expect(s.input).toEqual({ cgst: 90, sgst: 90, igst: 0 });
    expect(s.paymentCredit).toBe(1180);
  });

  it('adds blocked GST (s.17(5)) to the expense', () => {
    const s = splitExpense({ amount: 1180, cgst: 90, sgst: 90, igst: 0, itcEligible: false, isReverseCharge: false, tdsAmount: 0 });
    expect(s.expenseDebit).toBe(1180);
    expect(s.input).toEqual({ cgst: 0, sgst: 0, igst: 0 });
  });

  it('books RCM: supplier paid the bill value, GST payable by recipient', () => {
    const s = splitExpense({ amount: 10000, cgst: 900, sgst: 900, igst: 0, itcEligible: true, isReverseCharge: true, tdsAmount: 0 });
    expect(s.expenseDebit).toBe(10000);
    expect(s.rcmPayable).toBe(1800);
    expect(s.paymentCredit).toBe(10000);
    const dr = s.expenseDebit + s.input.cgst + s.input.sgst;
    expect(dr).toBe(s.paymentCredit + s.rcmPayable);
  });

  it('deducts TDS from the amount paid', () => {
    const s = splitExpense({ amount: 59000, cgst: 4500, sgst: 4500, igst: 0, itcEligible: true, isReverseCharge: false, tdsAmount: 5000 });
    expect(s.tdsPayable).toBe(5000);
    expect(s.paymentCredit).toBe(54000);
    expect(s.expenseDebit + 9000).toBe(s.paymentCredit + s.tdsPayable);
  });

  it('rejects mixed IGST and CGST, or RCM without GST', () => {
    expect(() =>
      splitExpense({ amount: 100, cgst: 5, sgst: 5, igst: 5, itcEligible: true, isReverseCharge: false, tdsAmount: 0 })
    ).toThrow(ExpenseValidationError);
    expect(() =>
      splitExpense({ amount: 100, cgst: 0, sgst: 0, igst: 0, itcEligible: true, isReverseCharge: true, tdsAmount: 0 })
    ).toThrow(ExpenseValidationError);
  });
});

describe('parseExpenseTaxFields', () => {
  it('defaults ITC from the category blocked flag', () => {
    expect(parseExpenseTaxFields({}, { account_id: null, itc_blocked: true }).itcEligible).toBe(false);
    expect(parseExpenseTaxFields({}, { account_id: null, itc_blocked: false }).itcEligible).toBe(true);
    expect(parseExpenseTaxFields({ itc_eligible: 'true' }, { account_id: null, itc_blocked: true }).itcEligible).toBe(true);
  });

  it('normalises TDS section', () => {
    expect(parseExpenseTaxFields({ tds_amount: 100, tds_section: '194j' }, null).tdsSection).toBe('194J');
    expect(parseExpenseTaxFields({ tds_amount: 100, tds_section: 'x' }, null).tdsSection).toBe('OTHER');
    expect(parseExpenseTaxFields({ tds_section: '194J' }, null).tdsSection).toBeNull();
  });
});

describe('buildClosingLines', () => {
  it('closes income and expense to retained earnings (profit)', () => {
    const { lines, profit } = buildClosingLines(
      [
        { account_id: 'sales', account_code: '4101', account_type: 'income', net: -10000 },
        { account_id: 'rent', account_code: '5213', account_type: 'expense', net: 4000 },
      ],
      're',
      'close'
    );
    expect(profit).toBe(6000);
    const t = sum(lines);
    expect(t.dr).toBeCloseTo(t.cr, 2);
    expect(lines.find((l) => l.accountId === 'sales')).toMatchObject({ debit: 10000, credit: 0 });
    expect(lines.find((l) => l.accountId === 're')).toMatchObject({ debit: 0, credit: 6000 });
  });

  it('debits retained earnings on a loss', () => {
    const { lines, profit } = buildClosingLines(
      [
        { account_id: 'sales', account_code: '4101', account_type: 'income', net: -1000 },
        { account_id: 'rent', account_code: '5213', account_type: 'expense', net: 2500 },
      ],
      're',
      'close'
    );
    expect(profit).toBe(-1500);
    expect(lines.find((l) => l.accountId === 're')).toMatchObject({ debit: 1500, credit: 0 });
  });
});

describe('disposalLines', () => {
  const base = {
    assetAccountId: 'fa',
    accumAccountId: 'acc',
    proceedsAccountId: 'bank',
    gainAccountId: 'gain',
    lossAccountId: 'loss',
    label: 'sale',
  };

  it('books a profit on sale', () => {
    const { lines, gainLoss } = disposalLines({ ...base, cost: 100000, accumulated: 40000, proceeds: 70000 });
    expect(gainLoss).toBe(10000);
    const t = sum(lines);
    expect(t.dr).toBe(t.cr);
  });

  it('books a loss on sale', () => {
    const { lines, gainLoss } = disposalLines({ ...base, cost: 100000, accumulated: 40000, proceeds: 50000 });
    expect(gainLoss).toBe(-10000);
    expect(lines.find((l) => l.accountId === 'loss')).toMatchObject({ debit: 10000 });
    const t = sum(lines);
    expect(t.dr).toBe(t.cr);
  });
});

describe('stock adjustment helpers', () => {
  it('maps reasons to the counter ledger', () => {
    expect(counterAccountCodes('DAMAGE', true)[0]).toBe('5106');
    expect(counterAccountCodes('FREE_SAMPLE', true)[0]).toBe('5202');
    expect(counterAccountCodes('STOCK_TAKE', false)[0]).toBe('4201');
    expect(counterAccountCodes('LANDED_COST', false)[0]).toBe('5105');
  });

  it('splits ITC reversal by supply type', () => {
    expect(itcReversalSplit(7000, 18, false)).toEqual({ igst: 0, cgst: 630, sgst: 630 });
    expect(itcReversalSplit(7000, 18, true)).toEqual({ igst: 1260, cgst: 0, sgst: 0 });
    const odd = itcReversalSplit(100.05, 5, false);
    expect(odd.cgst + odd.sgst).toBeCloseTo(5, 2);
  });
});
