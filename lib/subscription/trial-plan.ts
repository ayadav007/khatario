/**
 * Trial plan rules (signup-only; not a self-service "Change Plan" target).
 * Signup / migrations assign {@link TRIAL_PLAN_ID}; billing UI hides Trial unless user is already on it.
 */

export const TRIAL_PLAN_ID = 'trial' as const;

export type PlanChangeAction = 'current' | 'upgrade' | 'downgrade';

export function isTrialPlanId(planId: string | null | undefined): boolean {
  return planId === TRIAL_PLAN_ID;
}

/**
 * Include Trial in the Change Plan grid only when it is the user's current plan
 * (so they see "Current Plan" — not as a selectable destination for others).
 */
export function includeTrialPlanInChangePlanPicker(currentPlanId: string | null | undefined): boolean {
  return isTrialPlanId(currentPlanId);
}

/**
 * Upgrade vs downgrade for billing UI. DB `sort_order` alone is wrong when the current
 * plan is Trial (often highest sort_order); Trial → paid must be "Upgrade".
 */
export function getPlanChangeAction(
  currentPlanId: string,
  currentSortOrder: number,
  targetPlan: { id: string; sort_order: number },
): PlanChangeAction {
  if (targetPlan.id === currentPlanId) return 'current';

  if (isTrialPlanId(currentPlanId)) {
    if (targetPlan.id === 'free') return 'downgrade';
    return 'upgrade';
  }

  if (isTrialPlanId(targetPlan.id)) {
    return 'downgrade';
  }

  return targetPlan.sort_order > currentSortOrder ? 'upgrade' : 'downgrade';
}
