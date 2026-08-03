/** Calendar date (YYYY-MM-DD) for attendance — default IST for India deployments. */
export const DEFAULT_ATTENDANCE_TIMEZONE = 'Asia/Kolkata';

export function attendanceDateYmd(
  now: Date = new Date(),
  timeZone: string = DEFAULT_ATTENDANCE_TIMEZONE,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function normalizeAttendanceDateKey(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return attendanceDateYmd(d);
  return s.slice(0, 10);
}

export function isSameAttendanceDate(a: unknown, b: unknown): boolean {
  return normalizeAttendanceDateKey(a) === normalizeAttendanceDateKey(b);
}
