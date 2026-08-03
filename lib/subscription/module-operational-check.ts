/**
 * Pure per-module subscription operational checks (no DB imports).
 */

import type { PlatformModule } from '@/lib/platform-modules';
import {
  CONNECT_PLAN_ID,
  HR_FREE_PLAN_ID,
} from '@/lib/product-lines';
import {
  isPaidGracePeriodActive,
  isTrialEntitlementActive,
  type SubscriptionForEffectivePlan,
} from '@/lib/subscription/effective-plan';
import {
  isLocalCalendarOnOrBeforeToday,
  parseLocalDateOnly,
} from '@/lib/subscription/date-only';
import type { ModuleSubscriptionRow } from '@/lib/subscription/module-subscriptions';

export function getFreePlanIdForModule(moduleKey: PlatformModule): string {
  if (moduleKey === 'hr') return HR_FREE_PLAN_ID;
  if (moduleKey === 'connect') return CONNECT_PLAN_ID;
  return 'free';
}

function asEffectiveSub(row: ModuleSubscriptionRow): SubscriptionForEffectivePlan {
  return {
    plan_id: row.plan_id,
    status: row.status,
    trial_end_date: row.trial_end_date,
    end_date: row.end_date,
    grace_period_end: row.grace_period_end,
  };
}

/** Whether this module row still grants product access (including free tier after trial). */
export function isModuleSubscriptionOperational(row: ModuleSubscriptionRow): boolean {
  if (row.status === 'cancelled' || row.status === 'expired') {
    return false;
  }

  if (row.status !== 'active' && row.status !== 'trial') {
    return false;
  }

  const effective = asEffectiveSub(row);

  if (row.end_date && row.status === 'active') {
    const end = parseLocalDateOnly(row.end_date);
    if (end && !isLocalCalendarOnOrBeforeToday(end) && !isPaidGracePeriodActive(effective)) {
      return false;
    }
  }

  if (row.cancel_at_period_end && row.end_date) {
    const end = parseLocalDateOnly(row.end_date);
    if (end && !isLocalCalendarOnOrBeforeToday(end)) {
      return false;
    }
  }

  if (row.status === 'trial' && !isTrialEntitlementActive(effective)) {
    return true;
  }

  return true;
}

export function isModuleOnFreePlan(row: ModuleSubscriptionRow): boolean {
  const freeId = getFreePlanIdForModule(row.module_key);
  if (row.plan_id === freeId) return true;
  const effective = asEffectiveSub(row);
  if (row.status === 'trial' && !isTrialEntitlementActive(effective)) {
    return true;
  }
  return false;
}
