import type { LimitCheckType } from '@/lib/subscription/limit-registry';

/** Limits surfaced in upgrade nudges (dashboard + list pages). */
export type UsageNudgeLimitType = 'invoices' | 'customers' | 'items' | 'users';

export const USAGE_NUDGE_LIMIT_TYPES: UsageNudgeLimitType[] = [
  'invoices',
  'customers',
  'items',
  'users',
];

export const USAGE_LIMIT_LABELS: Record<UsageNudgeLimitType, string> = {
  invoices: 'Invoices this month',
  customers: 'Customers',
  items: 'Items',
  users: 'Team users',
};

export const USAGE_LIMIT_SHORT_LABELS: Record<UsageNudgeLimitType, string> = {
  invoices: 'invoices',
  customers: 'customers',
  items: 'items',
  users: 'users',
};

export function isUsageNudgeLimitType(value: string): value is UsageNudgeLimitType {
  return (USAGE_NUDGE_LIMIT_TYPES as string[]).includes(value);
}

export function usagePercent(current: number, max: number): number {
  if (max === -1) return 0;
  if (max <= 0) return 100;
  return Math.min(Math.round((current / max) * 100), 100);
}

/** Show nudge when at or above this usage ratio (aligned with usage warning emails at 80%). */
export const USAGE_NUDGE_THRESHOLD_PERCENT = 80;

export function shouldShowUsageNudge(current: number, max: number): boolean {
  if (max === -1) return false;
  if (max <= 0) return current > 0;
  return usagePercent(current, max) >= USAGE_NUDGE_THRESHOLD_PERCENT;
}

export function formatPlanLimit(limit: number, limitType: UsageNudgeLimitType): string {
  if (limit === -1) return 'unlimited';
  if (limitType === 'invoices') return `${limit}/month`;
  return String(limit);
}
