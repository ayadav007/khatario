import { todayIst } from '@/lib/gst/time-limits';

export const PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'last_7_days',
  'last_30_days',
  'this_fy',
] as const;
export type PeriodKey = (typeof PERIODS)[number];

export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  from: string;
  to: string;
  /** The matching earlier window, for "up / down vs" comparisons. */
  prevFrom: string;
  prevTo: string;
  prevLabel: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(iso: string): Date {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(day: string): string {
  const d = toDate(monthStart(day));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return iso(d);
}

function addMonths(day: string, n: number): string {
  const d = toDate(monthStart(day));
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
}

/** Same day-of-month in another month, clipped to that month's last day. */
function sameDayInMonth(day: string, otherMonthStart: string): string {
  const end = monthEnd(otherMonthStart);
  const candidate = `${otherMonthStart.slice(0, 8)}${day.slice(8, 10)}`;
  return candidate > end ? end : candidate;
}

/** Monday of the week containing `day`. */
function weekStart(day: string): string {
  const dow = toDate(day).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/** Indian financial year (April to March) start for `day`. */
export function fyStart(day: string): string {
  const year = +day.slice(0, 4);
  const month = +day.slice(5, 7);
  return `${month >= 4 ? year : year - 1}-04-01`;
}

export function formatDay(day: string): string {
  return `${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1]}`;
}

function monthLabel(day: string): string {
  return `${MONTHS[+day.slice(5, 7) - 1]} ${day.slice(0, 4)}`;
}

export function resolvePeriod(key: PeriodKey, today: string = todayIst()): ResolvedPeriod {
  switch (key) {
    case 'today':
      return { key, label: `Today (${formatDay(today)})`, from: today, to: today, prevFrom: addDays(today, -1), prevTo: addDays(today, -1), prevLabel: 'yesterday' };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { key, label: `Yesterday (${formatDay(y)})`, from: y, to: y, prevFrom: addDays(y, -1), prevTo: addDays(y, -1), prevLabel: 'the day before' };
    }
    case 'this_week': {
      const from = weekStart(today);
      return { key, label: `This week (${formatDay(from)} to ${formatDay(today)})`, from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(today, -7), prevLabel: 'the same days last week' };
    }
    case 'last_week': {
      const from = addDays(weekStart(today), -7);
      const to = addDays(from, 6);
      return { key, label: `Last week (${formatDay(from)} to ${formatDay(to)})`, from, to, prevFrom: addDays(from, -7), prevTo: addDays(to, -7), prevLabel: 'the week before' };
    }
    case 'this_month': {
      const from = monthStart(today);
      const prevStart = addMonths(today, -1);
      return { key, label: `This month (${monthLabel(today)})`, from, to: today, prevFrom: prevStart, prevTo: sameDayInMonth(today, prevStart), prevLabel: 'the same days last month' };
    }
    case 'last_month': {
      const from = addMonths(today, -1);
      const prevStart = addMonths(today, -2);
      return { key, label: `Last month (${monthLabel(from)})`, from, to: monthEnd(from), prevFrom: prevStart, prevTo: monthEnd(prevStart), prevLabel: 'the month before' };
    }
    case 'last_7_days': {
      const from = addDays(today, -6);
      return { key, label: 'Last 7 days', from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(today, -7), prevLabel: 'the 7 days before' };
    }
    case 'last_30_days': {
      const from = addDays(today, -29);
      return { key, label: 'Last 30 days', from, to: today, prevFrom: addDays(from, -30), prevTo: addDays(today, -30), prevLabel: 'the 30 days before' };
    }
    case 'this_fy': {
      const from = fyStart(today);
      const prevFrom = `${+from.slice(0, 4) - 1}-04-01`;
      const prevTo = `${+today.slice(0, 4) - 1}${today.slice(4)}`;
      const fyLabel = `FY ${from.slice(0, 4)}-${String(+from.slice(0, 4) + 1).slice(2)}`;
      return { key, label: `This financial year (${fyLabel})`, from, to: today, prevFrom, prevTo: prevTo.endsWith('-02-29') ? addDays(prevTo, -1) : prevTo, prevLabel: 'the same period last year' };
    }
  }
}
