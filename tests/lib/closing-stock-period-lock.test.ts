import { calendarDateOnly, assertDocumentDateNotBeforeLockedClosingStock, ClosingStockPeriodLockedError } from '@/lib/closing-stock-period-lock';

describe('calendarDateOnly', () => {
  it('keeps the local calendar day that node-pg uses for a DATE column', () => {
    const parsedLikePg = new Date(2026, 9, 15, 0, 0, 0, 0);
    expect(calendarDateOnly(parsedLikePg)).toBe('2026-10-15');
    if (parsedLikePg.getTimezoneOffset() < 0) {
      expect(parsedLikePg.toISOString().slice(0, 10)).toBe('2026-10-14');
    }
  });

  it('keeps a YYYY-MM-DD string, including one produced for Asia/Kolkata', () => {
    expect(calendarDateOnly('2026-10-15')).toBe('2026-10-15');
    const istMidnight = new Date('2026-10-15T00:00:00+05:30');
    expect(istMidnight.toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(calendarDateOnly('2026-10-15')).not.toBe(istMidnight.toISOString().slice(0, 10));
  });
});

describe('assertDocumentDateNotBeforeLockedClosingStock', () => {
  it('rejects the locked day and earlier days, and allows the next day', () => {
    expect(() => assertDocumentDateNotBeforeLockedClosingStock('2026-10-15', '2026-10-15')).toThrow(ClosingStockPeriodLockedError);
    expect(() => assertDocumentDateNotBeforeLockedClosingStock('2026-10-14', '2026-10-15')).toThrow(ClosingStockPeriodLockedError);
    expect(() => assertDocumentDateNotBeforeLockedClosingStock('2026-10-16', '2026-10-15')).not.toThrow();
    expect(() => assertDocumentDateNotBeforeLockedClosingStock('2026-10-16', null)).not.toThrow();
  });
});
