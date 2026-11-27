/**
 * Pure per-module subscription operational checks (no DB imports).
 */

import type { PlatformModule } from '@/lib/platform-modules';
import {
  CONNECT_FREE_PLAN_ID,
  HR_FREE_PLAN_ID,
  HR_STAFF_LITE_PLAN_ID,
} from '@/lib/product-lines';
import {
  isSubscriptionUsable,
  isTrialEntitlementActive,
  type SubscriptionForEffectivePlan,
} from '@/lib/subscription/effective-plan';
import type { ModuleSubscriptionRow } from '@/lib/subscription/module-subscriptions';

export function getFreePlanIdForModule(moduleKey: PlatformModule): string {
  if (moduleKey === 'hr') return HR_FREE_PLAN_ID;
  if (moduleKey === 'connect') return CONNECT_FREE_PLAN_ID;
  return 'free';
}

function asEffectiveSub(row: ModuleSubscriptionRow): SubscriptionForEffectivePlan {
  return {
    plan_id: row.plan_id,
    status: row.status,
    trial_end_date: row.trial_end_date,
    end_date: row.end_date,
    grace_period_end: row.grace_period_end,
    cancel_at_period_end: row.cancel_at_period_end,
    scheduled_plan_id: row.scheduled_plan_id,
    db_today: row.db_today,
  };
}

/** Whether this module row still grants product access (including free tier after trial). */
export function isModuleSubscriptionOperational(row: ModuleSubscriptionRow): boolean {
  return isSubscriptionUsable(asEffectiveSub(row));
}

export function isModuleOnFreePlan(row: ModuleSubscriptionRow): boolean {
  const freeId = getFreePlanIdForModule(row.module_key);
  if (row.plan_id === freeId) return true;
  // Complimentary HR Lite is bundled with Billing — not a cancellable paid SKU.
  if (row.module_key === 'hr' && row.plan_id === HR_STAFF_LITE_PLAN_ID) return true;
  const effective = asEffectiveSub(row);
  if (row.status === 'trial' && !isTrialEntitlementActive(effective)) {
    return true;
  }
  return false;
}
