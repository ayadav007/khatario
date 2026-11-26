import type { PlatformModule } from '@/lib/platform-modules';
import { getFreePlanIdForModule } from '@/lib/subscription/module-operational-check';
import { MODULE_ADD_CONFIG } from '@/lib/subscription/module-entitlements';

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
}): ZeroPriceDecision {
  const { moduleKey, targetPlanId, current, currentPlanIsPaid } = input;

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
    if (current) {
      return {
        action: 'reject',
        code: 'TRIAL_ALREADY_USED',
        message: 'The trial for this product has already been used. Choose a paid plan to continue.',
      };
    }
    return { action: 'start_trial', trialDays: config.trialDays };
  }

  return { action: 'reject', code: 'PLAN_NOT_SELECTABLE', message: NOT_SELECTABLE };
}
