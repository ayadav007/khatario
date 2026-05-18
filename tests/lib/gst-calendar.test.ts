import { GST_DEFAULT_CALENDAR_TIMEZONE, gstCalendarDateInTz } from '@/lib/gst/gst-calendar';

describe('gstCalendarDateInTz', () => {
  it('uses Asia/Kolkata calendar day (not UTC) for late-night UTC instants', () => {
    // 2026-01-15 18:30 UTC === 2026-01-16 00:00 IST
    const instant = new Date('2026-01-15T18:30:00.000Z');
    expect(gstCalendarDateInTz(instant, GST_DEFAULT_CALENDAR_TIMEZONE)).toBe('2026-01-16');
  });

  it('still on previous IST day before midnight IST', () => {
    // 2026-01-15 18:29 UTC === 2026-01-15 23:59 IST
    const instant = new Date('2026-01-15T18:29:59.999Z');
    expect(gstCalendarDateInTz(instant, GST_DEFAULT_CALENDAR_TIMEZONE)).toBe('2026-01-15');
  });
});
