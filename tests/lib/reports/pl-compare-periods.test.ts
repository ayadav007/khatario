import {
  CompareInputError,
  changeBetween,
  comparisonPeriods,
  isIsoDate,
  isReportDate,
  parseCompareRequest,
  periodLabel,
  previousPeriod,
  samePeriodLastYear,
} from '@/lib/reports/pl-compare-periods';

const P = (from: string, to: string) => ({ from, to });

test('previous period steps back by whole months when the period is whole months', () => {
  expect(previousPeriod(P('2026-04-01', '2026-06-30'))).toEqual(P('2026-01-01', '2026-03-31'));
  expect(previousPeriod(P('2026-04-01', '2027-03-31'))).toEqual(P('2025-04-01', '2026-03-31'));
  expect(previousPeriod(P('2026-09-01', '2026-09-30'))).toEqual(P('2026-08-01', '2026-08-31'));
  expect(previousPeriod(P('2026-03-01', '2026-03-31'))).toEqual(P('2026-02-01', '2026-02-28'));
  expect(previousPeriod(P('2024-03-01', '2024-03-31'))).toEqual(P('2024-02-01', '2024-02-29'));
  expect(previousPeriod(P('2026-01-01', '2026-01-31'))).toEqual(P('2025-12-01', '2025-12-31'));
});
test('previous period steps back by days otherwise', () => {
  expect(previousPeriod(P('2026-10-01', '2026-10-15'))).toEqual(P('2026-09-16', '2026-09-30'));
  expect(previousPeriod(P('2026-04-01', '2026-11-10'))).toEqual(P('2025-08-20', '2026-03-31'));
  expect(previousPeriod(P('2026-03-01', '2026-03-01'))).toEqual(P('2026-02-28', '2026-02-28'));
});
test('same period last year keeps month ends', () => {
  expect(samePeriodLastYear(P('2026-04-01', '2026-09-30'))).toEqual(P('2025-04-01', '2025-09-30'));
  expect(samePeriodLastYear(P('2025-02-01', '2025-02-28'))).toEqual(P('2024-02-01', '2024-02-29'));
  expect(samePeriodLastYear(P('2024-02-01', '2024-02-29'))).toEqual(P('2023-02-01', '2023-02-28'));
  expect(samePeriodLastYear(P('2026-10-01', '2026-10-15'))).toEqual(P('2025-10-01', '2025-10-15'));
});
test('several periods, most recent first', () => {
  expect(comparisonPeriods(P('2026-07-01', '2026-07-31'), 'previous_period', 3)).toEqual([
    P('2026-06-01', '2026-06-30'), P('2026-05-01', '2026-05-31'), P('2026-04-01', '2026-04-30'),
  ]);
  expect(comparisonPeriods(P('2026-04-01', '2026-09-30'), 'previous_year', 2)).toEqual([
    P('2025-04-01', '2025-09-30'), P('2024-04-01', '2024-09-30'),
  ]);
  expect(comparisonPeriods(P('2026-04-01', '2026-09-30'), 'custom', 3, P('2026-01-01', '2026-01-15'))).toEqual([
    P('2026-01-01', '2026-01-15'),
  ]);
});
test('isIsoDate accepts only real dates', () => {
  expect(isIsoDate('2026-02-28')).toBe(true);
  expect(isIsoDate('2024-02-29')).toBe(true);
  expect(isIsoDate('2026-02-29')).toBe(false);
  expect(isIsoDate('2026-13-01')).toBe(false);
  expect(isIsoDate('2026-4-1')).toBe(false);
  expect(isIsoDate('abc')).toBe(false);
  expect(isIsoDate(null)).toBe(false);
});
test('parseCompareRequest defaults and results', () => {
  const base = { from_date: '2026-07-01', to_date: '2026-09-30', compare: null, count: null, compare_from: null, compare_to: null };
  expect(parseCompareRequest(base)).toEqual({ mode: 'previous_period', periods: [P('2026-07-01', '2026-09-30'), P('2026-04-01', '2026-06-30')] });
  expect(parseCompareRequest({ ...base, compare: 'previous_year', count: '2' }).periods).toHaveLength(3);
  expect(parseCompareRequest({ ...base, compare: 'custom', compare_from: '2026-04-01', compare_to: '2026-04-30' }).periods[1]).toEqual(P('2026-04-01', '2026-04-30'));
});
test('parseCompareRequest rejects bad input with the exact message', () => {
  const base = { from_date: '2026-07-01', to_date: '2026-09-30', compare: null, count: null, compare_from: null, compare_to: null };
  const msg = (q: any) => { try { parseCompareRequest(q); return null; } catch (e) { expect(e).toBeInstanceOf(CompareInputError); return (e as Error).message; } };
  expect(msg({ ...base, from_date: '2026-13-01' })).toBe('Dates must be in YYYY-MM-DD format.');
  expect(msg({ ...base, from_date: '2026-10-01' })).toBe('From date cannot be after To date.');
  expect(msg({ ...base, compare: 'weekly' })).toBe('Compare with must be previous_period, previous_year or custom.');
  expect(msg({ ...base, count: '4' })).toBe('Number of periods must be 1, 2 or 3.');
  expect(msg({ ...base, count: '0' })).toBe('Number of periods must be 1, 2 or 3.');
  expect(msg({ ...base, compare: 'custom', compare_from: '2026-04-01' })).toBe('A custom comparison needs both dates.');
  expect(msg({ ...base, compare: 'custom', compare_from: '2026-05-01', compare_to: '2026-04-01' })).toBe('From date cannot be after To date.');
  expect(msg({ ...base, compare: 'custom', compare_from: 'x', compare_to: '2026-04-01' })).toBe('Dates must be in YYYY-MM-DD format.');
});
test('changeBetween', () => {
  expect(changeBetween(1200, 1000)).toEqual({ amount: 200, percent: 20 });
  expect(changeBetween(800, 1000)).toEqual({ amount: -200, percent: -20 });
  expect(changeBetween(1000, 3000)).toEqual({ amount: -2000, percent: -66.7 });
  expect(changeBetween(100, 0)).toEqual({ amount: 100, percent: null });
  expect(changeBetween(0, 0)).toEqual({ amount: 0, percent: null });
  expect(changeBetween(50, -100)).toEqual({ amount: 150, percent: 150 });   // a loss became a profit
  expect(changeBetween(-50, 100)).toEqual({ amount: -150, percent: -150 }); // a profit became a loss
});
test('periodLabel', () => {
  expect(periodLabel(P('2026-04-01', '2026-09-30'))).toBe('1 Apr 2026 – 30 Sep 2026');
});
test('isReportDate needs a real date in or after 1900', () => {
  expect(isReportDate('2026-04-01')).toBe(true);
  expect(isReportDate('1900-01-01')).toBe(true);
  expect(isReportDate('1899-12-31')).toBe(false);
  expect(isReportDate('0202-04-01')).toBe(false);
  expect(isReportDate('abc')).toBe(false);
  expect(isReportDate(null)).toBe(false);
});
test('dates before 1900 are rejected, including computed periods', () => {
  const base = { from_date: '2026-07-01', to_date: '2026-09-30', compare: null, count: null, compare_from: null, compare_to: null };
  const msg = (q: any) => { try { parseCompareRequest(q); return null; } catch (e) { expect(e).toBeInstanceOf(CompareInputError); return (e as Error).message; } };
  const M = 'Dates must be in or after the year 1900.';
  expect(msg({ ...base, from_date: '0202-04-01' })).toBe(M);
  expect(msg({ ...base, from_date: '1900-01-01', to_date: '1900-01-31' })).toBe(M);                                   // previous period is December 1899
  expect(msg({ ...base, from_date: '1901-04-01', to_date: '1901-09-30', compare: 'previous_year', count: '2' })).toBe(M); // second step is 1899
  expect(msg({ ...base, compare: 'custom', compare_from: '1899-12-01', compare_to: '1899-12-31' })).toBe(M);
  expect(parseCompareRequest({ ...base, from_date: '1900-02-01', to_date: '1900-02-28' }).periods[1]).toEqual({ from: '1900-01-01', to: '1900-01-31' });
});
