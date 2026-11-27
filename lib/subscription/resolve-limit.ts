/**
 * Resolves effective limit caps from per-module subscriptions.
 */

import type { PlatformModule } from '@/lib/platform-modules';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import {
  getEntitlementPlanIdForModuleSub,
  getEntitlementTermsIdForModuleSub,
  getOperationalModuleSubscriptions,
  type ModuleSubscriptionRow,
} from '@/lib/subscription/module-subscriptions';
import {
  getLimitOwnerModule,
  isAccountWideLimit,
} from '@/lib/subscription/module-entitlements';
import type { LimitCheckType } from '@/lib/subscription/limit-registry';
import { planLimitValueQuery } from '@/lib/subscription/plan-terms';
import * as db from '@/lib/db';

export type ResolvedLimit = {
  maxLimit: number;
  moduleKey: PlatformModule | 'account' | null;
  blockedReason?: string;
  /**
   * True when `maxLimit` came from the limits registry (`platform_limits` default or a plan override),
   * so 0 means 0. False only when the key has no active registry row; callers may then fall back to
   * the legacy `features.limits` JSON on the plan row (SUB-39).
   */
  fromRegistry: boolean;
};

async function resolvePlanLimitValueLocal(
  planId: string,
  limitKey: string,
  queryFn: typeof db.queryOne = db.queryOne,
  termsId?: string | null,
): Promise<number | null> {
  // A failing lookup throws: the caller refuses the request (fails closed) instead of reading the
  // missing value as "no registry entry" and falling back to the legacy JSON.
  // A business pinned to older plan terms reads its snapshot's value (see plan-terms.ts).
  const q = planLimitValueQuery(planId, limitKey, termsId);
  const result = await queryFn<{ limit_value: number | string | null }>(q.sql, q.params);
  if (!result || result.limit_value === null || result.limit_value === undefined) {
    return null;
  }
  const n =
    typeof result.limit_value === 'number'
      ? result.limit_value
      : parseInt(String(result.limit_value), 10);
  return Number.isNaN(n) ? null : n;
}

async function planLimitForSub(
  sub: ModuleSubscriptionRow,
  limitKey: string,
  queryFn?: typeof db.queryOne,
): Promise<number | null> {
  const planId = getEntitlementPlanIdForModuleSub(sub);
  return resolvePlanLimitValueLocal(planId, limitKey, queryFn, getEntitlementTermsIdForModuleSub(sub));
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
      fromRegistry: true,
    };
  }

  let best = 0;
  let found = false;
  for (const sub of subs) {
    const value = await planLimitForSub(sub, limitKey, queryFn);
    if (value === null) continue;
    found = true;
    if (value === -1) {
      return { maxLimit: -1, moduleKey: 'account', fromRegistry: true };
    }
    if (value > best) best = value;
  }

  if (!found) {
    return {
      maxLimit: 0,
      moduleKey: 'account',
      blockedReason: 'Limit not defined on your plans.',
      fromRegistry: false,
    };
  }
  return { maxLimit: best, moduleKey: 'account', fromRegistry: true };
}

/**
 * Connect's max_users is its own pool of WhatsApp agents (`connect_agents`), so it never adds
 * Billing/HR users. Other account-wide limits (daily WhatsApp messages) still take the highest plan.
 */
export function seatSourceSubs(
  limitType: LimitCheckType,
  subs: ModuleSubscriptionRow[],
): ModuleSubscriptionRow[] {
  if (limitType !== 'users') return subs;
  return subs.filter((s) => s.module_key !== 'connect');
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
    return resolveAccountWideLimit(businessId, limitKey, seatSourceSubs(limitType, operational), queryFn);
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
      fromRegistry: true,
    };
  }

  const moduleSub = operational.find((s) => s.module_key === owner);
  if (!moduleSub) {
    const label = owner === 'hr' ? 'HR' : owner === 'connect' ? 'Connect' : 'Billing';
    return {
      maxLimit: 0,
      moduleKey: owner,
      blockedReason: `No active ${label} subscription.`,
      fromRegistry: true,
    };
  }

  const planId = getEntitlementPlanIdForModuleSub(moduleSub);
  const maxLimit = await resolvePlanLimitValueLocal(
    planId,
    limitKey,
    queryFn,
    getEntitlementTermsIdForModuleSub(moduleSub),
  );

  if (maxLimit === null) {
    return { maxLimit: 0, moduleKey: owner, fromRegistry: false };
  }

  return { maxLimit, moduleKey: owner, fromRegistry: true };
}
