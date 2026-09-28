import { dueRunDates, nextRunDate } from '@/lib/invoices/recurring-schedule';

describe('nextRunDate', () => {
  it('daily and weekly', () => {
    expect(nextRunDate('2026-09-30', 'daily')).toBe('2026-10-01');
    expect(nextRunDate('2026-09-28', 'weekly', 2)).toBe('2026-10-12');
  });
  it('monthly keeps the anchor day across short months', () => {
    expect(nextRunDate('2026-01-31', 'monthly', 1, 31)).toBe('2026-02-28');
    expect(nextRunDate('2026-02-28', 'monthly', 1, 31)).toBe('2026-03-31');
    expect(nextRunDate('2028-01-31', 'monthly', 1, 31)).toBe('2028-02-29');
  });
  it('quarterly, half-yearly and yearly', () => {
    expect(nextRunDate('2026-04-01', 'quarterly')).toBe('2026-07-01');
    expect(nextRunDate('2026-10-15', 'half_yearly')).toBe('2027-04-15');
    expect(nextRunDate('2026-04-01', 'yearly')).toBe('2027-04-01');
  });
});

describe('dueRunDates', () => {
  it('catches up missed months up to today', () => {
    expect(
      dueRunDates({ nextRun: '2026-07-05', today: '2026-09-27', frequency: 'monthly', anchorDay: 5 })
    ).toEqual(['2026-07-05', '2026-08-05', '2026-09-05']);
  });
  it('stops at end_date and the catch-up cap', () => {
    expect(
      dueRunDates({ nextRun: '2026-07-05', today: '2026-09-27', endDate: '2026-08-10', frequency: 'monthly' })
    ).toEqual(['2026-07-05', '2026-08-05']);
    expect(dueRunDates({ nextRun: '2026-01-01', today: '2026-09-27', frequency: 'daily', max: 3 })).toHaveLength(3);
  });
  it('nothing due in the future', () => {
    expect(dueRunDates({ nextRun: '2026-10-01', today: '2026-09-27', frequency: 'monthly' })).toEqual([]);
  });
});
