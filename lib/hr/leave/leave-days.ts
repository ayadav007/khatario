import { queryRows } from '@/lib/db';
import { calculateWorkingDays } from '@/lib/leave-calculator';
import { roundLeaveDays, type LeavePlanTypeRule } from '@/lib/hr/leave/types';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function getHolidaySet(businessId: string, start: Date, end: Date): Promise<Set<string>> {
  const holidays = await queryRows<{ holiday_date: Date }>(
    'SELECT holiday_date FROM holidays WHERE business_id = $1 AND holiday_date BETWEEN $2 AND $3',
    [businessId, start, end],
  );
  return new Set(holidays.map((h) => h.holiday_date.toISOString().slice(0, 10)));
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Count sandwich days (weekends/holidays) between first and last working leave day.
 */
async function countSandwichDays(
  startDate: Date,
  endDate: Date,
  businessId: string,
  rule: LeavePlanTypeRule,
): Promise<number> {
  if (!rule.sandwich_enabled) return 0;

  const holidays = await getHolidaySet(businessId, startDate, endDate);
  let sandwich = 0;
  const current = new Date(startDate);

  while (current <= endDate) {
    const ds = dateStr(current);
    const weekend = isWeekend(current);
    const holiday = holidays.has(ds);
    const isWorking = !weekend && !holiday;

    if (!isWorking) {
      if ((weekend && rule.sandwich_count_weekends) || (holiday && rule.sandwich_count_holidays)) {
        sandwich += 1;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  // Only count sandwich if there are working days on both sides within range
  const workingDays = await calculateWorkingDays(startDate, endDate, businessId);
  if (workingDays <= 0) return 0;

  return Math.max(0, sandwich);
}

export async function calculateLeaveDaysWithSandwich(
  startDate: Date | string,
  endDate: Date | string,
  businessId: string,
  rule: LeavePlanTypeRule,
): Promise<number> {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

  const workingDays = await calculateWorkingDays(start, end, businessId);
  if (workingDays <= 0) return 0;

  let total = workingDays;
  if (rule.sandwich_enabled) {
    const sandwich = await countSandwichDays(start, end, businessId, rule);
    // Add only non-working sandwich days not already counted
    total = workingDays + sandwich;
  }

  return roundLeaveDays(total, rule.rounding_mode);
}

export async function previewLeaveDays(input: {
  businessId: string;
  startDate: string;
  endDate: string;
  rule: LeavePlanTypeRule;
}): Promise<{ working_days: number; total_days: number; sandwich_days: number }> {
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  const workingDays = await calculateWorkingDays(start, end, input.businessId);
  const totalDays = await calculateLeaveDaysWithSandwich(
    start,
    end,
    input.businessId,
    input.rule,
  );
  return {
    working_days: workingDays,
    total_days: totalDays,
    sandwich_days: Math.max(0, totalDays - workingDays),
  };
}

export function prorateAnnualQuota(
  annualQuota: number,
  joiningDate: string,
  leaveYearStartMonth: number,
  referenceDate = new Date(),
): number {
  const join = new Date(joiningDate);
  const refYear =
    referenceDate.getMonth() + 1 >= leaveYearStartMonth
      ? referenceDate.getFullYear()
      : referenceDate.getFullYear() - 1;
  const yearStart = new Date(refYear, leaveYearStartMonth - 1, 1);
  const yearEnd = addDays(new Date(refYear + (leaveYearStartMonth === 1 ? 0 : 1), leaveYearStartMonth === 1 ? 11 : leaveYearStartMonth - 2, leaveYearStartMonth === 1 ? 31 : 0), 0);

  const effectiveStart = join > yearStart ? join : yearStart;
  if (effectiveStart > yearEnd) return 0;

  const totalDays = Math.max(1, Math.ceil((yearEnd.getTime() - yearStart.getTime()) / 86400000) + 1);
  const remainingDays = Math.max(0, Math.ceil((yearEnd.getTime() - effectiveStart.getTime()) / 86400000) + 1);
  return Math.round((annualQuota * remainingDays) / totalDays * 100) / 100;
}
