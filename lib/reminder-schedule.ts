import { formatInTimeZone, toDate } from 'date-fns-tz';

const DEFAULT_TIME = '09:00:00';
const DEFAULT_TZ = 'Asia/Kolkata';

/** Match cron cadence: window length in minutes (keep in sync with vercel.json). */
export const REMINDER_SEND_WINDOW_MINUTES = 15;

/**
 * True if the IANA time zone is accepted by the engine (and thus usable in scheduling).
 */
export function isValidIanaTimeZone(tz: string | null | undefined): boolean {
  if (!tz || !tz.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a DB TIME, string, or Date to "HH:mm" for forms and APIs.
 */
export function reminderTimeToHhMm(value: unknown): string {
  if (value == null) return '09:00';
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    return '09:00';
  }
  return '09:00';
}

/**
 * "HH:mm" or "HH:mm:ss" → "HH:mm:ss" for PostgreSQL TIME.
 */
export function parseReminderTimeToSql(timeInput: string | undefined | null): string {
  const raw = (timeInput || '09:00').trim();
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{1,2}:\d{2}$/.test(raw)) return `${raw}:00`;
  return DEFAULT_TIME;
}

/**
 * True when `now` falls in [scheduled start, start + window) in the business time zone
 * (same calendar day in that zone).
 */
export function isInReminderSendWindow(
  timeZone: string,
  timeLocal: string,
  nowUtc: Date = new Date(),
  windowMinutes: number = REMINDER_SEND_WINDOW_MINUTES
): boolean {
  const tz = (timeZone || DEFAULT_TZ).trim() || DEFAULT_TZ;
  if (!isValidIanaTimeZone(tz)) return false;

  const t = parseReminderTimeToSql(timeLocal);
  const hm = t.slice(0, 5);

  let ymd: string;
  try {
    ymd = formatInTimeZone(nowUtc, tz, 'yyyy-MM-dd');
  } catch {
    return false;
  }

  const localStart = toDate(`${ymd}T${hm}:00`, { timeZone: tz });
  if (isNaN(localStart.getTime())) return false;

  const end = new Date(localStart.getTime() + windowMinutes * 60 * 1000);
  return nowUtc.getTime() >= localStart.getTime() && nowUtc.getTime() < end.getTime();
}

export { DEFAULT_TZ, DEFAULT_TIME };
