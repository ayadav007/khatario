/** Parse `YYYY-MM-DD` (or ISO string) as local calendar midnight — not UTC. */
export function parseLocalDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const part = value.slice(0, 10);
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
