import type { PlatformModule } from '@/lib/platform-modules';
import { getFreePlanIdForModule } from '@/lib/subscription/module-operational-check';
import { MODULE_ADD_CONFIG } from '@/lib/subscription/module-entitlements';
import { FREE_TIER_PLAN_IDS } from '@/lib/subscription/plan-tier';

export type ZeroPriceDecision =
  | { action: 'apply_free' }
  | { action: 'start_trial'; trialDays: number }
  | {
      action: 'reject';
      code: 'PLAN_NOT_SELECTABLE' | 'USE_DOWNGRADE' | 'TRIAL_ALREADY_USED';
      message: string;
    };

const NOT_SELECTABLE =
  'This plan cannot be selected directly. Choose the Free plan or a paid plan instead.';

/**
 * The one rule for plan requests that need no payment. The upgrade route applies the result;
 * it never applies a plan merely because its prices are all 0.
 */
export function decideZeroPriceChange(input: {
  moduleKey: PlatformModule;
  targetPlanId: string;
  current: { plan_id: string; status: string; trial_end_date: string | null } | null;
  currentPlanIsPaid: boolean;
  /** The business already had this module's trial (see the upgrade route for how it is derived). */
  trialAlreadyUsed: boolean;
}): ZeroPriceDecision {
  const { moduleKey, targetPlanId, current, currentPlanIsPaid, trialAlreadyUsed } = input;

  if (targetPlanId === getFreePlanIdForModule(moduleKey)) {
    if (currentPlanIsPaid) {
      return {
        action: 'reject',
        code: 'USE_DOWNGRADE',
        message:
          'To move from a paid plan to Free, use the downgrade option so your paid period is honoured.',
      };
    }
    return { action: 'apply_free' };
  }

  const config = moduleKey === 'crm' ? undefined : MODULE_ADD_CONFIG[moduleKey];
  if (config && !config.paidOnly && targetPlanId === config.trialPlanId && config.trialDays != null) {
    if (trialAlreadyUsed) {
      return {
        action: 'reject',
        code: 'TRIAL_ALREADY_USED',
        message: 'The trial for this product has already been used. Choose a paid plan to continue.',
      };
    }
    // A free-tier row (signup gives every Billing business hr_free or a bundled plan) is not a trial.
    if (!current || FREE_TIER_PLAN_IDS.has(current.plan_id)) {
      return { action: 'start_trial', trialDays: config.trialDays };
    }
  }

  return { action: 'reject', code: 'PLAN_NOT_SELECTABLE', message: NOT_SELECTABLE };
}
