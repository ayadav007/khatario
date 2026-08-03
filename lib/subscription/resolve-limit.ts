/**
 * Resolves effective limit caps from per-module subscriptions.
 */

import type { PlatformModule } from '@/lib/platform-modules';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import {
  getEntitlementPlanIdForModuleSub,
  getOperationalModuleSubscriptions,
  type ModuleSubscriptionRow,
} from '@/lib/subscription/module-subscriptions';
import {
  getLimitOwnerModule,
  isAccountWideLimit,
} from '@/lib/subscription/module-entitlements';
import type { LimitCheckType } from '@/lib/subscription/limit-registry';
import * as db from '@/lib/db';

export type ResolvedLimit = {
  maxLimit: number;
  moduleKey: PlatformModule | 'account' | null;
  blockedReason?: string;
};

async function resolvePlanLimitValueLocal(
  planId: string,
  limitKey: string,
  queryFn: typeof db.queryOne = db.queryOne,
): Promise<number | null> {
  try {
    const result = await queryFn<{ limit_value: number | string | null }>(
      `SELECT COALESCE(spl.limit_value, pl.default_value) AS limit_value
       FROM platform_limits pl
       LEFT JOIN subscription_plan_limits spl
         ON spl.limit_key = pl.limit_key AND spl.plan_id = $1
       WHERE pl.limit_key = $2 AND pl.is_active = true`,
      [planId, limitKey],
    );
    if (!result || result.limit_value === null || result.limit_value === undefined) {
      return null;
    }
    const n =
      typeof result.limit_value === 'number'
        ? result.limit_value
        : parseInt(String(result.limit_value), 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

async function planLimitForSub(
  sub: ModuleSubscriptionRow,
  limitKey: string,
  queryFn?: typeof db.queryOne,
): Promise<number | null> {
  const planId = getEntitlementPlanIdForModuleSub(sub);
  return resolvePlanLimitValueLocal(planId, limitKey, queryFn);
}

/** MAX across module plans (industry standard for shared console seats). */
async function resolveAccountWideLimit(
  businessId: string,
  limitKey: string,
  subs: ModuleSubscriptionRow[],
  queryFn?: typeof db.queryOne,
): Promise<ResolvedLimit> {
  if (subs.length === 0) {
    return {
      maxLimit: 0,
      moduleKey: 'account',
      blockedReason: 'No active product subscription.',
    };
  }

  let best = 0;
  let found = false;
  for (const sub of subs) {
    const value = await planLimitForSub(sub, limitKey, queryFn);
    if (value === null) continue;
    found = true;
    if (value === -1) {
      return { maxLimit: -1, moduleKey: 'account' };
    }
    if (value > best) best = value;
  }

  if (!found) {
    return { maxLimit: 0, moduleKey: 'account', blockedReason: 'Limit not defined on your plans.' };
  }
  return { maxLimit: best, moduleKey: 'account' };
}

export async function resolveBusinessLimit(
  businessId: string,
  limitType: LimitCheckType,
  limitKey: string,
  queryFn?: typeof db.queryOne,
): Promise<ResolvedLimit> {
  const ctx = await getBusinessPlatformContext(businessId);
  const operational = await getOperationalModuleSubscriptions(businessId, true);

  if (isAccountWideLimit(limitType)) {
    return resolveAccountWideLimit(businessId, limitKey, operational, queryFn);
  }

  const owner = getLimitOwnerModule(limitType);
  if (!owner) {
    return resolveAccountWideLimit(businessId, limitKey, operational, queryFn);
  }

  if (!ctx.enabledModules.includes(owner)) {
    const label = owner === 'hr' ? 'HR' : owner === 'connect' ? 'Connect' : 'Billing';
    return {
      maxLimit: 0,
      moduleKey: owner,
      blockedReason: `${label} is not enabled on your account. Add it from Settings → Your products.`,
    };
  }

  const moduleSub = operational.find((s) => s.module_key === owner);
  if (!moduleSub) {
    const label = owner === 'hr' ? 'HR' : owner === 'connect' ? 'Connect' : 'Billing';
    return {
      maxLimit: 0,
      moduleKey: owner,
      blockedReason: `No active ${label} subscription.`,
    };
  }

  const planId = getEntitlementPlanIdForModuleSub(moduleSub);
  let maxLimit = await resolvePlanLimitValueLocal(planId, limitKey, queryFn);

  if (maxLimit === null) {
    maxLimit = 0;
  }

  return { maxLimit, moduleKey: owner };
}
