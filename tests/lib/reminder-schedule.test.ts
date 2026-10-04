import { addCalendarDays, paymentDueWindow } from '@/lib/reminder-schedule';

describe('payment due window', () => {
  it('uses the business calendar, including the hours before UTC midnight', () => {
    // 01:30 IST on 4 Oct 2026 is still 3 Oct in UTC.
    const now = new Date('2026-10-03T20:00:00.000Z');
    expect(paymentDueWindow('Asia/Kolkata', 1, now)).toEqual({ from: '2026-10-04', to: '2026-10-05' });
    expect(paymentDueWindow('Asia/Kolkata', 3, now)).toEqual({ from: '2026-10-04', to: '2026-10-07' });
  });

  it('adds days without crossing a timezone offset', () => {
    expect(addCalendarDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});
