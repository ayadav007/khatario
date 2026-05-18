import zonedTimeToUtc from 'date-fns-tz/zonedTimeToUtc';
import formatInTimeZone from 'date-fns-tz/formatInTimeZone';

/** Default for India-focused deployments; extend with `business.timezone` when available. */
export const DEFAULT_TODO_TIMEZONE = 'Asia/Kolkata';

/** Valid IANA zone from business, else default (IST). Supports future `business.timezone`. */
export function getBusinessTodoTimezone(business: unknown): string {
  const b = business as { timezone?: string | null } | null | undefined;
  const tz = typeof b?.timezone === 'string' ? b.timezone.trim() : '';
  if (tz) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return tz;
    } catch {
      return DEFAULT_TODO_TIMEZONE;
    }
  }
  return DEFAULT_TODO_TIMEZONE;
}

/** Calendar day key `yyyy-MM-dd` for a due-date instant in the given zone. */
export function dueInstantToZonedDayKey(isoOrDate: string | Date, timeZone: string): string {
  return formatInTimeZone(typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate, timeZone, 'yyyy-MM-dd');
}

/** First instant (UTC) of `yyyy-MM-dd` in `timeZone`, and first instant of the following calendar day (exclusive end). */
export function zonedDayBoundsUtc(ymd: string, timeZone: string): { startUtc: Date; endExclusiveUtc: Date } {
  const startUtc = zonedTimeToUtc(`${ymd} 00:00:00`, timeZone);
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  const nextYmd = `${yy}-${mm}-${dd}`;
  const endExclusiveUtc = zonedTimeToUtc(`${nextYmd} 00:00:00`, timeZone);
  return { startUtc, endExclusiveUtc };
}

/** UTC bounds for an entire calendar month in `timeZone` (year 1–12, month 1–12). */
export function zonedMonthBoundsUtc(year: number, month1to12: number, timeZone: string): { startUtc: Date; endExclusiveUtc: Date } {
  const ymdStart = `${year}-${String(month1to12).padStart(2, '0')}-01`;
  const endYmd =
    month1to12 === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month1to12 + 1).padStart(2, '0')}-01`;
  return {
    startUtc: zonedTimeToUtc(`${ymdStart} 00:00:00`, timeZone),
    endExclusiveUtc: zonedTimeToUtc(`${endYmd} 00:00:00`, timeZone),
  };
}
