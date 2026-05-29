/** Parse `YYYY-MM-DD` (or ISO string) as local calendar midnight — not UTC.
 *
 * Accepts `Date` too: node-pg returns `DATE`/`timestamp` columns as JS `Date`
 * objects (not strings), so callers that pass a raw DB value (e.g. an uncast
 * `trial_end_date`) would otherwise hit `value.slice is not a function`. */
export function parseLocalDateOnly(
  value: string | Date | number | null | undefined
): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Normalize to local calendar midnight, dropping any time-of-day.
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const str = typeof value === 'string' ? value : String(value);
  const part = str.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part);
  if (!match) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(year, month - 1, day);
}

export function startOfLocalToday(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** True when `date` is strictly before today (local calendar). */
export function isLocalCalendarBeforeToday(date: Date): boolean {
  return date.getTime() < startOfLocalToday().getTime();
}

/** True when today is on or before `end` (inclusive last day of trial). */
export function isLocalCalendarOnOrBeforeToday(end: Date): boolean {
  return startOfLocalToday().getTime() <= end.getTime();
}

export function addLocalDaysFromToday(days: number): string {
  const d = startOfLocalToday();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
