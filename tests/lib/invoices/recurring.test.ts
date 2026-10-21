import { spawnSync } from 'child_process';
import path from 'path';
import { calendarDateOnly } from '@/lib/closing-stock-period-lock';
import { dueRunDates, nextRunDate } from '@/lib/invoices/recurring-schedule';

/** Local midnight, which is how node-pg returns a PostgreSQL DATE. */
function pgDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

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

describe('recurring calendar dates', () => {
  it('keeps a node-pg date of 2026-10-19 and the first of a month', () => {
    expect(calendarDateOnly(pgDate(2026, 10, 19))).toBe('2026-10-19');
    expect(calendarDateOnly(pgDate(2026, 10, 1))).toBe('2026-10-01');
    expect(calendarDateOnly('2026-10-19')).toBe('2026-10-19');
  });

  it('keeps month boundaries, year boundaries, and a leap day', () => {
    expect(calendarDateOnly(pgDate(2026, 1, 31))).toBe('2026-01-31');
    expect(calendarDateOnly(pgDate(2026, 3, 1))).toBe('2026-03-01');
    expect(calendarDateOnly(pgDate(2025, 12, 31))).toBe('2025-12-31');
    expect(calendarDateOnly(pgDate(2026, 1, 1))).toBe('2026-01-01');
    expect(calendarDateOnly(pgDate(2024, 2, 29))).toBe('2024-02-29');
  });

  it('raises a definition due on the business calendar day and advances one month', () => {
    const start = calendarDateOnly(pgDate(2026, 10, 19));
    const runs = dueRunDates({
      nextRun: start!,
      today: '2026-10-19',
      frequency: 'monthly',
      anchorDay: Number(start!.slice(8, 10)),
    });
    expect(runs).toEqual(['2026-10-19']);
    expect(nextRunDate(runs[0], 'monthly', 1, 19)).toBe('2026-11-19');
    expect(dueRunDates({ nextRun: '2026-11-19', today: '2026-10-19', frequency: 'monthly', anchorDay: 19 })).toEqual([]);
  });

  it('keeps those dates in UTC and in Asia/Kolkata', () => {
    for (const tz of ['UTC', 'Asia/Kolkata']) {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve('node_modules/jest/bin/jest.js'),
          'tests/lib/invoices/calendar-date-tz.test.ts',
          '--runInBand',
          '--forceExit',
          '--watchman=false',
        ],
        { cwd: process.cwd(), env: { ...process.env, TZ: tz }, encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
    }
  });
});
