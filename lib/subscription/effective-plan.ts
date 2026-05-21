/**
 * Resolves what plan the UI and product should treat as "current"
 * when DB rows are inconsistent (e.g. plan_id trial + status active + past end_date).
 */

import {
  isLocalCalendarBeforeToday,
  isLocalCalendarOnOrBeforeToday,
  parseLocalDateOnly,
} from '@/lib/subscription/date-only';

export interface SubscriptionForEffectivePlan {
  plan_id: string;
  status: string;
  trial_end_date?: string | null;
  end_date?: string | null;
  grace_period_end?: string | null;
}

/** True while trial calendar is still active (no automatic post-expiry grace). */
export function isTrialEntitlementActive(sub: SubscriptionForEffectivePlan): boolean {
  if (sub.plan_id !== 'trial') return false;

  const trialEnd = parseLocalDateOnly(sub.trial_end_date);
  if (!trialEnd) return sub.status === 'trial';

  return isLocalCalendarOnOrBeforeToday(trialEnd);
}

/**
 * Plan id used for badges, labels, and "what plan am I on?" copy.
 * Calendar-expired trials map to `free` until the user extends via the modal.
 */
export function getDisplayPlanId(sub: SubscriptionForEffectivePlan): string {
  if (sub.plan_id === 'free') return 'free';
  if (sub.plan_id === 'trial') {
    if (!isTrialEntitlementActive(sub)) return 'free';
  }
  return sub.plan_id;
}

/**
 * @deprecated Prefer {@link getDisplayPlanId} for UI and {@link getEntitlementPlanId} for limits.
 */
export function getEffectivePlanId(sub: SubscriptionForEffectivePlan): string {
  return getDisplayPlanId(sub);
}

/** Plan id used for limits and feature enforcement. */
export function getEntitlementPlanId(sub: SubscriptionForEffectivePlan): string {
  if (sub.plan_id === 'free') return 'free';
  if (sub.plan_id === 'trial' && !isTrialEntitlementActive(sub)) return 'free';
  return sub.plan_id;
}

export function shouldShowTrialBadge(sub: SubscriptionForEffectivePlan): boolean {
  return sub.plan_id === 'trial' && isTrialEntitlementActive(sub);
}

/** @deprecated Use {@link shouldDowngradeStaleTrial} from trial-extension.ts for trial rows. */
export function shouldMoveStaleTrialToFree(sub: SubscriptionForEffectivePlan): boolean {
  if (sub.plan_id !== 'trial') return false;
  return !isTrialEntitlementActive(sub);
}

/**
 * Paid-plan grace (lapsed renewal) — not used for signup trials.
 */
export function isPaidGracePeriodActive(sub: SubscriptionForEffectivePlan): boolean {
  const graceEnd = parseLocalDateOnly(sub.grace_period_end);
  if (!graceEnd) return false;
  return isLocalCalendarOnOrBeforeToday(graceEnd);
}
