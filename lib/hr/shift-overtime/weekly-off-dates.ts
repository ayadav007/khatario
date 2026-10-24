import type { WeeklyOffPolicy } from '@/lib/hr/shift-overtime/types';

function dateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

function nthWeekdayOfMonth(year: number, month: number, week: number, weekday: number): number | null {
  if (week === -1) {
    const lastDay = new Date(year, month, 0).getDate();
    for (let day = lastDay; day >= 1; day--) {
      if (new Date(year, month - 1, day).getDay() === weekday) return day;
    }
    return null;
  }
  let count = 0;
  const lastDay = new Date(year, month, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    if (new Date(year, month - 1, day).getDay() === weekday) {
      count++;
      if (count === week) return day;
    }
  }
  return null;
}

export function isWeeklyOffDate(dateStr: string, policy: WeeklyOffPolicy): boolean {
  const wd = weekdayOf(dateStr);
  if (policy.fixed_days.includes(wd)) return true;

  const [y, m, d] = dateStr.split('-').map(Number);
  for (const rule of policy.nth_rules) {
    const nthDay = nthWeekdayOfMonth(y, m, rule.week, rule.weekday);
    if (nthDay === d) return true;
  }
  return false;
}

export function isWeeklyOffToday(policy: WeeklyOffPolicy, ref = new Date()): boolean {
  return isWeeklyOffDate(dateYmd(ref), policy);
}
