/**
 * Trial plan rules (signup-only; not a self-service "Change Plan" target).
 * Signup / migrations assign trial plan ids; billing UI hides Trial unless user is already on it.
 */

import { FREE_TIER_PLAN_IDS, comparePlanTier, type TierPlan } from '@/lib/subscription/plan-tier';
import {
  CONNECT_FREE_PLAN_ID,
  HR_FREE_PLAN_ID,
  isProductLineTrialPlanId,
} from '@/lib/product-lines';

export const TRIAL_PLAN_ID = 'trial' as const;

export type PlanChangeAction = 'current' | 'upgrade' | 'downgrade';

export function isTrialPlanId(planId: string | null | undefined): boolean {
  return isProductLineTrialPlanId(planId);
}

/** Paid plans selectable in upgrade/checkout UI (signup-only trial and free excluded). */
export function isPurchasableUpgradePlan(planId: string): boolean {
  return (
    planId !== 'free' &&
    planId !== HR_FREE_PLAN_ID &&
    planId !== CONNECT_FREE_PLAN_ID &&
    !isTrialPlanId(planId)
  );
}

/**
 * Include Trial in the Change Plan grid only when it is the user's current plan
 * (so they see "Current Plan" — not as a selectable destination for others).
 */
export function includeTrialPlanInChangePlanPicker(currentPlanId: string | null | undefined): boolean {
  return isTrialPlanId(currentPlanId);
}

/**
 * Upgrade vs downgrade for billing UI. Tier order comes from `comparePlanTier` (never price).
 * Trial needs special cases: it often has the highest sort_order, but Trial → paid is "Upgrade".
 */
export function getPlanChangeAction(current: TierPlan, target: TierPlan): PlanChangeAction {
  if (target.id === current.id) return 'current';

  if (isTrialPlanId(current.id)) {
    return FREE_TIER_PLAN_IDS.has(target.id) ? 'downgrade' : 'upgrade';
  }

  if (isTrialPlanId(target.id)) {
    return 'downgrade';
  }

  return comparePlanTier(target, current) === 1 ? 'upgrade' : 'downgrade';
}
