import formatInTimeZone from 'date-fns-tz/formatInTimeZone';

/** India GST / business calendar day boundaries (override when `business_settings.timezone` is wired). */
export const GST_DEFAULT_CALENDAR_TIMEZONE = 'Asia/Kolkata';

/**
 * Calendar `YYYY-MM-DD` in the given IANA zone for an instant (default **now**).
 * Used for default `as_on_date` so “today” matches Indian practice, not UTC midnight.
 */
export function gstCalendarDateInTz(
  instant: Date = new Date(),
  timeZone: string = GST_DEFAULT_CALENDAR_TIMEZONE
): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}
