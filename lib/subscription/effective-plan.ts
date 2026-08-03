/**
 * Resolves what plan the UI and product should treat as "current"
 * when DB rows are inconsistent (e.g. plan_id trial + status active + past end_date).
 */

import {
  isLocalCalendarOnOrBeforeToday,
  parseLocalDateOnly,
} from '@/lib/subscription/date-only';
import {
  HR_FREE_PLAN_ID,
  HR_TRIAL_PLAN_ID,
  isProductLineTrialPlanId,
} from '@/lib/product-lines';

export interface SubscriptionForEffectivePlan {
  plan_id: string;
  status: string;
  trial_end_date?: string | null;
  end_date?: string | null;
  grace_period_end?: string | null;
}

function getExpiredTrialFallbackPlanId(planId: string): string {
  if (planId === HR_TRIAL_PLAN_ID) return HR_FREE_PLAN_ID;
  return 'free';
}

/** True while trial calendar is still active (no automatic post-expiry grace). */
export function isTrialEntitlementActive(sub: SubscriptionForEffectivePlan): boolean {
  if (!isProductLineTrialPlanId(sub.plan_id)) return false;

  const trialEnd = parseLocalDateOnly(sub.trial_end_date);
  if (!trialEnd) return sub.status === 'trial';

  return isLocalCalendarOnOrBeforeToday(trialEnd);
}

/**
 * Plan id used for badges, labels, and "what plan am I on?" copy.
 * Calendar-expired trials map to the product-line free plan until the user extends via the modal.
 */
export function getDisplayPlanId(sub: SubscriptionForEffectivePlan): string {
  if (sub.plan_id === 'free' || sub.plan_id === HR_FREE_PLAN_ID) return sub.plan_id;
  if (isProductLineTrialPlanId(sub.plan_id) && !isTrialEntitlementActive(sub)) {
    return getExpiredTrialFallbackPlanId(sub.plan_id);
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
  if (sub.plan_id === 'free' || sub.plan_id === HR_FREE_PLAN_ID) return sub.plan_id;
  if (isProductLineTrialPlanId(sub.plan_id) && !isTrialEntitlementActive(sub)) {
    return getExpiredTrialFallbackPlanId(sub.plan_id);
  }
  return sub.plan_id;
}

export function shouldShowTrialBadge(sub: SubscriptionForEffectivePlan): boolean {
  return isProductLineTrialPlanId(sub.plan_id) && isTrialEntitlementActive(sub);
}

/** @deprecated Use {@link shouldDowngradeStaleTrial} from trial-extension.ts for trial rows. */
export function shouldMoveStaleTrialToFree(sub: SubscriptionForEffectivePlan): boolean {
  if (!isProductLineTrialPlanId(sub.plan_id)) return false;
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
