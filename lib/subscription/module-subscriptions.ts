/**
 * Per-module subscriptions — one plan row per (business, module).
 * Falls back to legacy business_subscriptions when the new table is empty.
 */

import * as db from '@/lib/db';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { productLineToModule, type PlatformModule } from '@/lib/platform-modules';
import { normalizeProductLine } from '@/lib/product-lines';
import {
  getEntitlementPlanId,
  type SubscriptionForEffectivePlan,
} from '@/lib/subscription/effective-plan';
import { MODULE_ADD_CONFIG } from '@/lib/subscription/module-entitlements';
import { isModuleSubscriptionOperational } from '@/lib/subscription/module-operational-check';

export interface ModuleSubscriptionRow extends SubscriptionForEffectivePlan {
  business_id: string;
  module_key: PlatformModule;
  plan_id: string;
  status: string;
  start_date: string;
  trial_end_date: string | null;
  end_date: string | null;
  grace_period_end?: string | null;
  billing_cycle?: 'monthly' | 'yearly';
  scheduled_plan_id?: string | null;
  cancel_at_period_end?: boolean;
  plan_display_name?: string;
  product_line?: string;
}

const moduleSubCache = new Map<
  string,
  { rows: ModuleSubscriptionRow[]; timestamp: number }
>();
const MODULE_SUB_CACHE_TTL = 60_000;

export function clearModuleSubscriptionCache(businessId: string): void {
  moduleSubCache.delete(businessId);
}

function cacheKey(businessId: string): string {
  return businessId;
}

async function loadModuleSubscriptionsFromDb(
  businessId: string,
): Promise<ModuleSubscriptionRow[]> {
  try {
    const rows = await db.queryRows<ModuleSubscriptionRow>(
      `SELECT
         bms.business_id,
         bms.module_key,
         bms.plan_id,
         bms.status,
         bms.start_date::text AS start_date,
         bms.end_date::text AS end_date,
         bms.trial_end_date::text AS trial_end_date,
         bms.grace_period_end::text AS grace_period_end,
         bms.billing_cycle,
         bms.scheduled_plan_id,
         bms.cancel_at_period_end,
         sp.display_name AS plan_display_name,
         sp.product_line
       FROM business_module_subscriptions bms
       JOIN subscription_plans sp ON sp.id = bms.plan_id
       WHERE bms.business_id = $1
       ORDER BY bms.module_key`,
      [businessId],
    );
    if (rows.length > 0) return rows;
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code !== '42P01') {
      console.warn('[loadModuleSubscriptionsFromDb] query failed:', error);
    }
  }

  // Legacy: single business_subscriptions row → infer module from plan product_line
  try {
    const legacy = await db.queryOne<ModuleSubscriptionRow>(
      `SELECT
         bs.business_id,
         CASE
           WHEN sp.product_line = 'hr' THEN 'hr'
           WHEN sp.product_line = 'connect' THEN 'connect'
           ELSE 'billing'
         END AS module_key,
         bs.plan_id,
         bs.status,
         bs.start_date::text AS start_date,
         bs.end_date::text AS end_date,
         bs.trial_end_date::text AS trial_end_date,
         bs.grace_period_end::text AS grace_period_end,
         bs.billing_cycle,
         sp.display_name AS plan_display_name,
         sp.product_line
       FROM business_subscriptions bs
       JOIN subscription_plans sp ON sp.id = bs.plan_id
       WHERE bs.business_id = $1
         AND bs.status IN ('active', 'trial')
       ORDER BY bs.created_at DESC
       LIMIT 1`,
      [businessId],
    );
    return legacy ? [legacy] : [];
  } catch {
    return [];
  }
}

export async function getModuleSubscriptions(
  businessId: string,
  skipCache = false,
): Promise<ModuleSubscriptionRow[]> {
  const key = cacheKey(businessId);
  if (!skipCache) {
    const cached = moduleSubCache.get(key);
    if (cached && Date.now() - cached.timestamp < MODULE_SUB_CACHE_TTL) {
      return cached.rows;
    }
  }

  const rows = await loadModuleSubscriptionsFromDb(businessId);
  moduleSubCache.set(key, { rows, timestamp: Date.now() });
  return rows;
}

export async function getOperationalModuleSubscriptions(
  businessId: string,
  skipCache = false,
): Promise<ModuleSubscriptionRow[]> {
  const ctx = await getBusinessPlatformContext(businessId);
  const all = await getModuleSubscriptions(businessId, skipCache);
  return all.filter(
    (row) =>
      ctx.enabledModules.includes(row.module_key) &&
      isModuleSubscriptionOperational(row),
  );
}

export async function getModuleSubscription(
  businessId: string,
  moduleKey: PlatformModule,
  skipCache = false,
): Promise<ModuleSubscriptionRow | null> {
  const rows = await getModuleSubscriptions(businessId, skipCache);
  return rows.find((r) => r.module_key === moduleKey) ?? null;
}

export function getEntitlementPlanIdForModuleSub(row: ModuleSubscriptionRow): string {
  return getEntitlementPlanId(row);
}

/** Seed or update a module subscription (signup, add-module). */
export async function upsertModuleSubscription(
  client: { query: typeof db.query },
  businessId: string,
  moduleKey: PlatformModule,
  planId: string,
  status: 'trial' | 'active',
  trialDays: number | null,
): Promise<void> {
  if (trialDays != null && status === 'trial') {
    await client.query(
      `INSERT INTO business_module_subscriptions (
         business_id, module_key, plan_id, status, start_date, trial_end_date
       ) VALUES ($1, $2, $3, 'trial', CURRENT_DATE, CURRENT_DATE + ($4::text || ' days')::interval)
       ON CONFLICT (business_id, module_key) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         start_date = CURRENT_DATE,
         trial_end_date = EXCLUDED.trial_end_date,
         updated_at = CURRENT_TIMESTAMP`,
      [businessId, moduleKey, planId, trialDays],
    );
  } else {
    await client.query(
      `INSERT INTO business_module_subscriptions (
         business_id, module_key, plan_id, status, start_date, trial_end_date
       ) VALUES ($1, $2, $3, $4, CURRENT_DATE, NULL)
       ON CONFLICT (business_id, module_key) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         start_date = CURRENT_DATE,
         trial_end_date = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [businessId, moduleKey, planId, status],
    );
  }
}

export async function seedInitialModuleSubscription(
  client: { query: typeof db.query },
  businessId: string,
  productLine: string,
  planId: string,
  status: 'trial' | 'active',
  trialDays: number | null,
): Promise<void> {
  const moduleKey = productLineToModule(normalizeProductLine(productLine));
  await upsertModuleSubscription(client, businessId, moduleKey, planId, status, trialDays);
}

export function getAddModuleConfig(moduleKey: PlatformModule) {
  if (moduleKey === 'crm') return null;
  return MODULE_ADD_CONFIG[moduleKey];
}
