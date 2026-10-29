import {
  addDays,
  isKhataOverdue,
  isKhataStatementDay,
  khataPayBy,
  khataSettlementDayLabel,
  khataShortDate,
  khataStatementDateFor,
  khataStatementPeriod,
} from '@/lib/khata/cycle';

describe('khata cycle', () => {
  test('a bill before the settlement day is due that month', () => {
    expect(khataStatementDateFor('2026-10-29', 5)).toBe('2026-11-05');
    expect(khataStatementDateFor('2026-11-04', 5)).toBe('2026-11-05');
  });

  test('a bill on the settlement day goes on next month\'s statement', () => {
    expect(khataStatementDateFor('2026-11-05', 5)).toBe('2026-12-05');
    expect(khataStatementDateFor('2026-11-20', 5)).toBe('2026-12-05');
  });

  test('a December bill rolls into January', () => {
    expect(khataStatementDateFor('2026-12-10', 5)).toBe('2027-01-05');
  });

  test('last day of month uses the calendar month, including February and leap years', () => {
    expect(khataStatementDateFor('2026-10-01', 0)).toBe('2026-10-31');
    expect(khataStatementDateFor('2026-10-31', 0)).toBe('2026-10-31');
    expect(khataStatementDateFor('2027-02-14', 0)).toBe('2027-02-28');
    expect(khataStatementDateFor('2028-02-14', 0)).toBe('2028-02-29');
  });

  test('day 28 works in February', () => {
    expect(khataStatementDateFor('2027-02-27', 28)).toBe('2027-02-28');
    expect(khataStatementDateFor('2027-02-28', 28)).toBe('2027-03-28');
  });

  test('rejects days outside 0 to 28', () => {
    expect(() => khataStatementDateFor('2026-10-01', 29)).toThrow();
    expect(() => khataStatementDateFor('2026-10-01', -1)).toThrow();
    expect(() => khataStatementDateFor('2026-10-01', 2.5)).toThrow();
  });

  test('statement period covers exactly the bills that get that statement date', () => {
    expect(khataStatementPeriod('2026-11-05', 5)).toEqual({ start: '2026-10-05', end: '2026-11-04' });
    expect(khataStatementPeriod('2027-01-05', 5)).toEqual({ start: '2026-12-05', end: '2027-01-04' });
    expect(khataStatementPeriod('2026-10-31', 0)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    for (const day of [1, 5, 15, 28, 0]) {
      const statement = khataStatementDateFor('2026-10-17', day);
      const { start, end } = khataStatementPeriod(statement, day);
      expect(khataStatementDateFor(start, day)).toBe(statement);
      expect(khataStatementDateFor(end, day)).toBe(statement);
      expect(khataStatementDateFor(addDays(end, 1), day)).not.toBe(statement);
    }
  });

  test('statement day detection', () => {
    expect(isKhataStatementDay('2026-11-05', 5)).toBe(true);
    expect(isKhataStatementDay('2026-11-06', 5)).toBe(false);
    expect(isKhataStatementDay('2026-11-30', 0)).toBe(true);
    expect(isKhataStatementDay('2026-11-29', 0)).toBe(false);
  });

  test('overdue only after the grace days', () => {
    expect(khataPayBy('2026-11-05', 3)).toBe('2026-11-08');
    expect(isKhataOverdue('2026-11-05', '2026-11-05', 0)).toBe(false);
    expect(isKhataOverdue('2026-11-05', '2026-11-06', 0)).toBe(true);
    expect(isKhataOverdue('2026-11-05', '2026-11-08', 3)).toBe(false);
    expect(isKhataOverdue('2026-11-05', '2026-11-09', 3)).toBe(true);
  });

  test('labels', () => {
    expect(khataShortDate('2026-11-05')).toBe('5 Nov');
    expect(khataSettlementDayLabel(5)).toBe('5th of every month');
    expect(khataSettlementDayLabel(1)).toBe('1st of every month');
    expect(khataSettlementDayLabel(22)).toBe('22nd of every month');
    expect(khataSettlementDayLabel(13)).toBe('13th of every month');
    expect(khataSettlementDayLabel(0)).toBe('Last day of every month');
  });
});
