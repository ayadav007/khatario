import {
  earnedAmount,
  monthBounds,
  splitSalaryPaymentBooks,
  weekBounds,
} from '@/lib/hr/staff-wage';

describe('staff wage amounts', () => {
  it('pays half the daily rate for a half day and nothing for a week of monthly staff', () => {
    expect(earnedAmount({
      payBasis: 'daily',
      rate: 1000,
      periodKind: 'week',
      presentDays: 4,
      halfDays: 2,
    })).toBe(5000);

    expect(earnedAmount({
      payBasis: 'monthly',
      rate: 20000,
      periodKind: 'week',
      presentDays: 6,
      halfDays: 0,
    })).toBe(0);

    expect(earnedAmount({
      payBasis: 'monthly',
      rate: 20000,
      periodKind: 'month',
      presentDays: 10,
      halfDays: 4,
    })).toBe(20000);
  });

  it('uses Monday to Sunday weeks and calendar months', () => {
    expect(weekBounds('2026-10-09')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    expect(monthBounds('2026-10-09')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('expenses only the part not already accrued and keeps the voucher balanced', () => {
    const split = splitSalaryPaymentBooks({
      earned: 10000,
      net: 7400,
      tds: 500,
      pf: 1200,
      esi: 0,
      professionalTax: 200,
      advanceRecovery: 700,
      advanceOnBooks: 700,
      loan: 0,
      otherDeductions: 0,
      accrualOutstanding: 4000,
    });
    expect(split.expense).toBe(6000);
    expect(split.payableDebit).toBe(4000);
    const credits = split.cash + split.tds + split.pf + split.esi + split.professionalTax
      + split.advanceOnBooks + split.withheld;
    expect(credits).toBe(split.expense + split.payableDebit);
  });
});
