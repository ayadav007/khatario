/**
 * Resolves what plan the UI and product should treat as "current"
 * when DB rows are inconsistent (e.g. plan_id trial + status active + past end_date).
 */

const GRACE_DAYS = 7;

export interface SubscriptionForEffectivePlan {
  plan_id: string;
  status: string;
  trial_end_date?: string | null;
  end_date?: string | null;
  grace_period_end?: string | null;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfToday(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** True while trial benefits (including grace) should still apply. */
export function isTrialEntitlementActive(sub: SubscriptionForEffectivePlan): boolean {
  if (sub.plan_id !== 'trial') return false;

  const now = startOfToday();
  const trialEnd = parseDateOnly(sub.trial_end_date);
  const periodEnd = parseDateOnly(sub.end_date);
  const graceEnd = parseDateOnly(sub.grace_period_end);

  if (sub.status === 'trial') {
    if (!trialEnd) return true;
    return now <= addDays(trialEnd, GRACE_DAYS);
  }

  // status active but plan still labeled trial
  if (graceEnd) return now <= graceEnd;
  if (periodEnd) return now <= addDays(periodEnd, GRACE_DAYS);
  if (trialEnd) return now <= addDays(trialEnd, GRACE_DAYS);
  return false;
}

/**
 * Plan id used for badges, labels, and "what plan am I on?" copy.
 * Expired trials map to `free`.
 */
export function getEffectivePlanId(sub: SubscriptionForEffectivePlan): string {
  if (sub.plan_id === 'free') return 'free';
  if (sub.plan_id === 'trial' && !isTrialEntitlementActive(sub)) return 'free';
  return sub.plan_id;
}

/** Plan id used for limits and feature registry (matches subscription UI). */
export function getEntitlementPlanId(sub: SubscriptionForEffectivePlan): string {
  return getEffectivePlanId(sub);
}

export function shouldShowTrialBadge(sub: SubscriptionForEffectivePlan): boolean {
  return sub.plan_id === 'trial' && isTrialEntitlementActive(sub);
}

/** Cron / maintenance: trial label in DB but entitlement has ended. */
export function shouldMoveStaleTrialToFree(sub: SubscriptionForEffectivePlan): boolean {
  if (sub.plan_id !== 'trial') return false;
  return getEffectivePlanId(sub) === 'free';
}
