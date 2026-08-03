import { queryOne } from '@/lib/db';
import {
  DEFAULT_WEEKLY_OFF_POLICY,
  parseWeeklyOffPolicy,
  type WeeklyOffPolicy,
} from '@/lib/hr/shift-overtime/types';

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

export async function getBusinessWeeklyOffPolicy(businessId: string): Promise<WeeklyOffPolicy> {
  const row = await queryOne<{ weekly_off_policy: unknown }>(
    `SELECT weekly_off_policy FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return parseWeeklyOffPolicy(row?.weekly_off_policy ?? DEFAULT_WEEKLY_OFF_POLICY);
}

export async function saveBusinessWeeklyOffPolicy(
  businessId: string,
  policy: WeeklyOffPolicy,
): Promise<WeeklyOffPolicy> {
  const parsed = parseWeeklyOffPolicy(policy);
  const existing = await queryOne(`SELECT business_id FROM business_settings WHERE business_id = $1`, [
    businessId,
  ]);
  if (existing) {
    await queryOne(
      `UPDATE business_settings SET weekly_off_policy = $2::jsonb WHERE business_id = $1`,
      [businessId, JSON.stringify(parsed)],
    );
  } else {
    await queryOne(
      `INSERT INTO business_settings (business_id, weekly_off_policy) VALUES ($1, $2::jsonb)`,
      [businessId, JSON.stringify(parsed)],
    );
  }
  return parsed;
}

export async function getEmployeeWeeklyOffPolicy(
  businessId: string,
  employeeId: string,
): Promise<WeeklyOffPolicy> {
  const row = await queryOne<{ weekly_off_override: unknown }>(
    `SELECT weekly_off_override FROM employees WHERE id = $1 AND business_id = $2`,
    [employeeId, businessId],
  );
  if (row?.weekly_off_override) return parseWeeklyOffPolicy(row.weekly_off_override);
  return getBusinessWeeklyOffPolicy(businessId);
}

export async function saveEmployeeWeeklyOffOverride(
  businessId: string,
  employeeId: string,
  policy: WeeklyOffPolicy | null,
): Promise<void> {
  await queryOne(
    `UPDATE employees SET weekly_off_override = $3::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2`,
    [employeeId, businessId, policy ? JSON.stringify(parseWeeklyOffPolicy(policy)) : null],
  );
}

export function isWeeklyOffToday(policy: WeeklyOffPolicy, ref = new Date()): boolean {
  return isWeeklyOffDate(dateYmd(ref), policy);
}

export async function isWeeklyOffForEmployee(
  businessId: string,
  employeeId: string,
  dateStr: string,
): Promise<boolean> {
  const policy = await getEmployeeWeeklyOffPolicy(businessId, employeeId);
  return isWeeklyOffDate(dateStr, policy);
}
