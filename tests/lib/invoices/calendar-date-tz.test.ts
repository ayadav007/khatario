import { calendarDateOnly } from '@/lib/closing-stock-period-lock';

function pgDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

describe('calendar dates in the process timezone', () => {
  const samples: Array<[number, number, number, string]> = [
    [2026, 10, 19, '2026-10-19'],
    [2026, 10, 1, '2026-10-01'],
    [2026, 1, 1, '2026-01-01'],
    [2025, 12, 31, '2025-12-31'],
    [2024, 2, 29, '2024-02-29'],
  ];

  it('keeps node-pg local dates and a date-only string', () => {
    for (const [year, month, day, expected] of samples) {
      expect(calendarDateOnly(pgDate(year, month, day))).toBe(expected);
    }
    expect(calendarDateOnly('2026-10-19')).toBe('2026-10-19');
  });

  it('matches the UTC day only when the process timezone is UTC', () => {
    const value = pgDate(2026, 10, 19);
    const utc = value.toISOString().slice(0, 10);
    expect(calendarDateOnly(value)).toBe('2026-10-19');
    if (process.env.TZ === 'UTC') expect(utc).toBe('2026-10-19');
    if (process.env.TZ === 'Asia/Kolkata') expect(utc).toBe('2026-10-18');
  });
});
