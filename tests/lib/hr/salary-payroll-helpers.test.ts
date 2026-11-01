import {
  computeDailyWage,
  computeProRataMonthlySalary,
  inclusiveCalendarDays,
  isPartialAdvanceRecovery,
  suggestAdvanceRecoveries,
  suggestInstallmentForAdvance,
} from '@/lib/hr/salary-payroll-helpers';

describe('inclusiveCalendarDays', () => {
  it('counts inclusive days in a month', () => {
    expect(inclusiveCalendarDays('2025-05-01', '2025-05-31')).toBe(31);
  });

  it('counts partial span from join date', () => {
    expect(inclusiveCalendarDays('2025-05-10', '2025-05-31')).toBe(22);
  });
});

describe('computeDailyWage', () => {
  it('pays the day rate for present days and half for half days', () => {
    const rows = [
      ...Array.from({ length: 7 }, () => ({ status: 'present' })),
      { status: 'half_day' },
      { status: 'absent' },
      { status: 'absent' },
    ];
    const r = computeDailyWage(700, rows);
    expect(r.payableDays).toBe(7.5);
    expect(r.amount).toBe(5250);
  });

  it('pays nothing when no attendance is marked', () => {
    expect(computeDailyWage(700, []).amount).toBe(0);
  });
});

describe('computeProRataMonthlySalary', () => {
  it('accepts a DATE column value from node-postgres (Date at local midnight)', () => {
    const r = computeProRataMonthlySalary({
      monthlySalary: 31000,
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      joiningDate: new Date(2026, 9, 11),
    });
    expect(r.joiningDate).toBe('2026-10-11');
    expect(r.applied).toBe(true);
    expect(r.daysPaid).toBe(21);
    expect(r.proratedAmount).toBe(21000);
  });

  it('pays the full month when a Date joining day is the first of the period', () => {
    const r = computeProRataMonthlySalary({
      monthlySalary: 16000,
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      joiningDate: new Date(2026, 9, 1),
    });
    expect(r.applied).toBe(false);
    expect(r.proratedAmount).toBe(16000);
  });

  it('returns full salary when join is before period', () => {
    const r = computeProRataMonthlySalary({
      monthlySalary: 20000,
      periodFrom: '2025-05-01',
      periodTo: '2025-05-31',
      joiningDate: '2025-04-01',
    });
    expect(r.applied).toBe(false);
    expect(r.proratedAmount).toBe(20000);
  });

  it('pro-rates when joined mid period', () => {
    const r = computeProRataMonthlySalary({
      monthlySalary: 20000,
      periodFrom: '2025-05-01',
      periodTo: '2025-05-31',
      joiningDate: '2025-05-10',
    });
    expect(r.applied).toBe(true);
    expect(r.daysInPeriod).toBe(31);
    expect(r.daysPaid).toBe(22);
    expect(r.proratedAmount).toBeCloseTo(20000 * (22 / 31), 0);
  });

  it('returns zero when join is after period end', () => {
    const r = computeProRataMonthlySalary({
      monthlySalary: 20000,
      periodFrom: '2025-05-01',
      periodTo: '2025-05-31',
      joiningDate: '2025-06-01',
    });
    expect(r.applied).toBe(true);
    expect(r.proratedAmount).toBe(0);
  });
});

describe('suggestInstallmentForAdvance', () => {
  it('returns full remaining when no recovery_months', () => {
    expect(
      suggestInstallmentForAdvance({
        id: 'a1',
        remaining_amount: 5000,
        recovery_months: null,
        recoveries_done: 0,
      })
    ).toBe(5000);
  });

  it('splits evenly across recovery_months', () => {
    expect(
      suggestInstallmentForAdvance({
        id: 'a1',
        remaining_amount: 5000,
        recovery_months: 2,
        recoveries_done: 0,
      })
    ).toBe(2500);
  });

  it('uses remaining months after prior recoveries', () => {
    expect(
      suggestInstallmentForAdvance({
        id: 'a1',
        remaining_amount: 2500,
        recovery_months: 2,
        recoveries_done: 1,
      })
    ).toBe(2500);
  });
});

describe('suggestAdvanceRecoveries', () => {
  it('sums FIFO suggestions', () => {
    const r = suggestAdvanceRecoveries([
      { id: 'a1', remaining_amount: 5000, recovery_months: 2, recoveries_done: 0 },
    ]);
    expect(r.suggested_total).toBe(2500);
    expect(r.breakdown[0].plan_label).toContain('2-month plan');
  });
});

describe('isPartialAdvanceRecovery', () => {
  it('detects partial recovery', () => {
    expect(isPartialAdvanceRecovery(2500, 5000)).toBe(true);
    expect(isPartialAdvanceRecovery(5000, 5000)).toBe(false);
    expect(isPartialAdvanceRecovery(0, 5000)).toBe(false);
  });
});
