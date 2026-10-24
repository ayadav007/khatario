export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export function isRecurringFrequency(f: unknown): f is RecurringFrequency {
  return typeof f === 'string' && (RECURRING_FREQUENCIES as readonly string[]).includes(f);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);

/**
 * Next run after `from`. Month-based schedules keep the start date's day of month
 * (31 Jan → 28/29 Feb → 31 Mar) instead of drifting to the shortest month.
 */
export function nextRunDate(from: string, frequency: RecurringFrequency, interval = 1, anchorDay?: number): string {
  const d = parse(from);
  const n = Math.max(1, Math.floor(interval || 1));
  if (frequency === 'daily') {
    d.setUTCDate(d.getUTCDate() + n);
    return iso(d);
  }
  if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * n);
    return iso(d);
  }
  const months = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 }[frequency] * n;
  const day = anchorDay ?? d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return iso(target);
}

/** Run dates that are due on `today`, oldest first, stopping at end_date and a catch-up cap. */
export function dueRunDates(p: {
  nextRun: string;
  today: string;
  endDate?: string | null;
  frequency: RecurringFrequency;
  interval?: number;
  anchorDay?: number;
  max?: number;
}): string[] {
  const out: string[] = [];
  let d = p.nextRun.slice(0, 10);
  const cap = p.max ?? 12;
  while (d <= p.today && (!p.endDate || d <= p.endDate.slice(0, 10)) && out.length < cap) {
    out.push(d);
    d = nextRunDate(d, p.frequency, p.interval, p.anchorDay);
  }
  return out;
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}
