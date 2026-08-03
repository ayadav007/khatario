import {
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

describe('computeProRataMonthlySalary', () => {
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
