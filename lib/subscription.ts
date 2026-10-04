/**
 * Subscription & Feature Entitlement Utilities
 * 
 * This library provides functions to check if a business has access to specific features
 * and whether they have exceeded their usage limits.
 */

import * as db from './db';
import { normalizeFeatureKey, FeatureKey } from './featureKeys';
import { getEntitlementPlanId, type SubscriptionForEffectivePlan } from './subscription/effective-plan';
import {
  type LimitCheckType,
  LIMIT_KEY_BY_TYPE,
  LIMIT_JSONB_KEY_MAP,
  ALL_LIMIT_CHECK_TYPES,
  buildLimitCountQuery,
} from './subscription/limit-registry';
import { resolveBusinessLimit } from './subscription/resolve-limit';
import {
  clearModuleSubscriptionCache,
  getModuleSubscriptions,
  upsertModuleSubscription,
} from './subscription/module-subscriptions';
import { getBusinessPlatformContext } from './business-modules';
import { getFreePlanIdForModule } from './subscription/module-operational-check';
import { getLimitOwnerModule } from './subscription/module-entitlements';
import type { PlatformModule } from './platform-modules';

export type { LimitCheckType } from './subscription/limit-registry';
export { ALL_LIMIT_CHECK_TYPES } from './subscription/limit-registry';

export interface SubscriptionPlan {
  id: string;
  name: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  features: {
    limits: {
      max_invoices_per_month: number; // -1 = unlimited
      max_customers: number;
      max_items: number;
      max_users: number;
      max_whatsapp_per_day: number;
    };
    features: Record<string, boolean>;
  };
  is_active: boolean;
  sort_order: number;
}

export interface BusinessSubscription {
  business_id: string;
  module_key: PlatformModule;
  plan_id: string;
  status: 'active' | 'expired' | 'cancelled' | 'trial';
  start_date: string;
  end_date: string | null;
  trial_end_date: string | null;
  grace_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_extension_granted: boolean;
  trial_extension_declined_at: string | null;
  plan_name: string;
  plan_display_name: string;
  features: SubscriptionPlan['features'];
  scheduled_plan_id: string | null;
  billing_cycle: 'monthly' | 'yearly';
}

/**
 * True when the business subscription row should be treated as "using the product"
 * (API access, limits, crons). Matches {@link getBusinessSubscription}'s filter and
 * {@link enforceAccess} in lib/enforce-access.ts.
 */
export function isSubscriptionOperationalStatus(
  status: string | null | undefined
): boolean {
  return status === 'active' || status === 'trial';
}

/**
 * Active/trial subscription row for one product (default: the business's primary product,
 * falling back to any other enabled product that is active/trial).
 * Reads business_module_subscriptions; cached in memory.
 */
export async function getBusinessSubscription(
  businessId: string,
  skipCache: boolean = false,
  moduleKey?: PlatformModule
): Promise<BusinessSubscription | null> {
  const cacheKey = `${businessId}:${moduleKey ?? '*'}`;
  if (!skipCache) {
    const cached = subscriptionCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SUBSCRIPTION_CACHE_TTL) {
      return cached.subscription;
    }
  }

  try {
    const ctx = await getBusinessPlatformContext(businessId);
    const rows = (await getModuleSubscriptions(businessId, skipCache)).filter((r) =>
      isSubscriptionOperationalStatus(r.status)
    );
    const row = moduleKey
      ? rows.find((r) => r.module_key === moduleKey)
      : rows.find((r) => r.module_key === ctx.primaryModule) ??
        rows.find((r) => ctx.enabledModules.includes(r.module_key));

    const plan = row
      ? await db.queryOne<{ name: string; display_name: string; features: unknown }>(
          `SELECT name, display_name, features FROM subscription_plans WHERE id = $1`,
          [row.plan_id]
        )
      : null;

    let parsedSubscription: BusinessSubscription | null = null;

    if (row && plan) {
      const features = typeof plan.features === 'string'
        ? JSON.parse(plan.features)
        : (plan.features as Record<string, any>) || {};

      // MERGE LIMITS FROM REGISTRY (same logic as admin plans API)
      try {
        const planLimits = await db.query(
          `SELECT limit_key, limit_value 
           FROM subscription_plan_limits 
           WHERE plan_id = $1`,
          [row.plan_id]
        );

        if (planLimits.rows.length > 0) {
          if (!features.limits) features.limits = {};
          
          planLimits.rows.forEach((row: any) => {
            const jsonbKeyMap: Record<string, string> = {
              'max_invoices_per_month': 'max_invoices_per_month',
              'max_customers': 'max_customers',
              'max_items': 'max_items',
              'max_users': 'max_users',
              'max_whatsapp_per_day': 'max_whatsapp_per_day',
              'max_employees': 'max_employees',
              'max_attendance_records_per_month': 'max_attendance_records_per_month',
              'max_leave_requests_per_month': 'max_leave_requests_per_month',
              'max_payroll_records_per_month': 'max_payroll_records_per_month',
              'max_suppliers': 'max_suppliers',
              'max_purchases_per_month': 'max_purchases_per_month',
              'max_expenses_per_month': 'max_expenses_per_month',
            };
            
            const jsonbKey = jsonbKeyMap[row.limit_key] || row.limit_key;
            if (jsonbKey) {
              features.limits[jsonbKey] = row.limit_value;
            }
          });
        }
      } catch (error) {
        // If registry tables don't exist yet, use JSONB only
        console.warn('Limits Registry not available, using JSONB:', error);
      }

      parsedSubscription = {
        business_id: row.business_id,
        module_key: row.module_key,
        plan_id: row.plan_id,
        status: row.status as BusinessSubscription['status'],
        start_date: row.start_date,
        end_date: row.end_date,
        trial_end_date: row.trial_end_date,
        grace_period_end: row.grace_period_end ?? null,
        cancel_at_period_end: Boolean(row.cancel_at_period_end),
        trial_extension_granted: Boolean(row.trial_extension_granted),
        trial_extension_declined_at: row.trial_extension_declined_at ?? null,
        plan_name: plan.name,
        plan_display_name: plan.display_name,
        features,
        scheduled_plan_id: row.scheduled_plan_id ?? null,
        billing_cycle: row.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
      };
    }

    // Update cache (even if null to prevent repeated queries)
    subscriptionCache.set(cacheKey, {
      subscription: parsedSubscription,
      timestamp: Date.now()
    });

    return parsedSubscription;
  } catch (error) {
    console.error('Error fetching business subscription:', error);
    return null;
  }
}

/**
 * Clear subscription cache for a business (call after subscription updates)
 */
export function clearSubscriptionCache(businessId: string) {
  for (const key of subscriptionCache.keys()) {
    if (key.startsWith(`${businessId}:`)) subscriptionCache.delete(key);
  }
  clearModuleSubscriptionCache(businessId);
}

/**
 * Clear all subscription caches (use sparingly, e.g., after plan updates)
 */
export function clearAllSubscriptionCaches() {
  subscriptionCache.clear();
}

/**
 * Check whether a business has access to a feature **using the subscription plan_features matrix**
 * (`subscription_plan_features` joined to `platform_features`), same rules as HTTP enforcement (`assertFeatureAccess`).
 *
 * Legacy JSONB `subscription_plans.features` is **not** consulted — admin updates in the Feature Matrix UI apply consistently.
 *
 * WhatsApp bot / send-capability identifiers still defer to addon purchase (`hasWhatsAppBotAddon`).
 */
export async function hasFeature(businessId: string, featureKey: string): Promise<boolean> {
  const canonicalKey = normalizeFeatureKey(featureKey);

  // WhatsApp addons (basic connect uses plan feature settings_whatsapp via registry)
  if (canonicalKey === 'whatsapp_bot') {
    return await hasWhatsAppBotAddon(businessId);
  }
  if (canonicalKey === 'whatsapp_send_message' || canonicalKey === 'whatsapp_manual') {
    const [hasBot, hasSend] = await Promise.all([
      hasWhatsAppBotAddon(businessId),
      hasWhatsAppSendMessageAddon(businessId),
    ]);
    return hasBot || hasSend;
  }

  try {
    const { hasFeatureAccess } = await import('./subscription/feature-access');
    return await hasFeatureAccess(businessId, featureKey);
  } catch (e) {
    console.error('[hasFeature] plan matrix evaluation failed:', e);
    return false;
  }
}

/** Same COALESCE logic as admin plan limits UI (plan override → platform default). */
export async function resolvePlanLimitValue(
  planId: string,
  limitKey: string,
  queryFn: typeof db.queryOne = db.queryOne
): Promise<number | null> {
  try {
    const result = await queryFn<{ limit_value: number | string | null }>(
      `SELECT COALESCE(spl.limit_value, pl.default_value) AS limit_value
       FROM platform_limits pl
       LEFT JOIN subscription_plan_limits spl
         ON spl.limit_key = pl.limit_key AND spl.plan_id = $1
       WHERE pl.limit_key = $2 AND pl.is_active = true`,
      [planId, limitKey]
    );
    if (!result || result.limit_value === null || result.limit_value === undefined) {
      return null;
    }
    const n =
      typeof result.limit_value === 'number'
        ? result.limit_value
        : parseInt(String(result.limit_value), 10);
    return Number.isNaN(n) ? null : n;
  } catch (error) {
    console.error('Error resolving plan limit:', error);
    return null;
  }
}

/**
 * Check if a business has reached a usage limit
 * Returns { allowed: boolean, current: number, limit: number }
 */
export async function checkLimit(
  businessId: string,
  limitType: LimitCheckType
): Promise<{ allowed: boolean; current: number; limit: number; message?: string }> {
  const ctx = await getBusinessPlatformContext(businessId);
  const ownerModule = getLimitOwnerModule(limitType) ?? ctx.primaryModule;

  // SAFETY FALLBACK: an enabled product with no subscription row at all gets that product's
  // free plan. Rows that exist but are expired/cancelled are left alone on purpose.
  if (ctx.enabledModules.includes(ownerModule)) {
    const rows = await getModuleSubscriptions(businessId);
    if (!rows.some((r) => r.module_key === ownerModule)) {
      console.warn(
        `WARNING: Business ${businessId} has no ${ownerModule} subscription row. Assigning the free plan.`
      );
      try {
        await upsertModuleSubscription(
          { query: db.query },
          businessId,
          ownerModule,
          getFreePlanIdForModule(ownerModule),
          'active',
          null
        );
        clearSubscriptionCache(businessId);
      } catch (error) {
        console.error('Fallback: Error auto-assigning free plan:', error);
      }
    }
  }

  const subscription =
    (await getBusinessSubscription(businessId, false, ownerModule)) ??
    (await getBusinessSubscription(businessId));

  const limitKey = LIMIT_KEY_BY_TYPE[limitType];
  const resolved = await resolveBusinessLimit(businessId, limitType, limitKey);
  let maxLimit: number = resolved.maxLimit;

  if (maxLimit === 0 && resolved.blockedReason) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: resolved.blockedReason,
    };
  }

  if (maxLimit === 0 && subscription) {
    const limits = subscription.features?.limits;
    if (limits) {
      const jsonbKey = LIMIT_JSONB_KEY_MAP[limitKey];
      const jsonbVal =
        jsonbKey && limits[jsonbKey as keyof typeof limits] !== undefined
          ? Number(limits[jsonbKey as keyof typeof limits])
          : null;
      if (jsonbVal !== null && !Number.isNaN(jsonbVal)) {
        maxLimit = jsonbVal;
      }
    }
  }

  if (maxLimit === 0 && !subscription?.features?.limits) {
    return { allowed: false, current: 0, limit: 0, message: 'No limits defined' };
  }

  let currentCount = 0;
  try {
    const { sql, params } = buildLimitCountQuery(limitType, businessId);
    const result = await db.queryOne<{ count: number | string }>(sql, params);
    currentCount = parseInt(String(result?.count ?? '0'), 10);
  } catch (error) {
    console.error(`Error counting ${limitType} for business ${businessId}:`, error);
    // If table doesn't exist yet (for new features), allow (currentCount = 0)
    currentCount = 0;
  }

  // Unlimited plans still report real usage (shown on Plan & billing)
  if (maxLimit === -1) {
    return { allowed: true, current: currentCount, limit: -1 };
  }

  const allowed = currentCount < maxLimit;

  return {
    allowed,
    current: currentCount,
    limit: maxLimit,
    message: allowed ? undefined : `You've reached your ${limitType} limit (${currentCount}/${maxLimit}). Please upgrade your plan to continue.`
  };
}

/**
 * Middleware helper to enforce feature access
 * Throws an error if the business doesn't have access
 * 
 * @param businessId - Business ID
 * @param featureKey - Feature key (canonical or legacy - will be normalized)
 * @throws Error if feature is not available
 */
export async function requireFeature(businessId: string, featureKey: string): Promise<void> {
  const canonicalKey = normalizeFeatureKey(featureKey);
  const hasAccess = await hasFeature(businessId, canonicalKey);
  
  if (!hasAccess) {
    throw new Error(`This feature (${canonicalKey}) is not available in your current plan. Please upgrade.`);
  }
}

/**
 * Middleware helper to enforce usage limits
 * Throws an error if the limit is exceeded
 */
export async function requireLimit(
  businessId: string,
  limitType: LimitCheckType
): Promise<void> {
  const check = await checkLimit(businessId, limitType);
  
  if (!check.allowed) {
    throw new Error(check.message || `You've exceeded your ${limitType} limit`);
  }
}

/**
 * Check limit inside a database transaction with locking to prevent race conditions
 * This MUST be called inside an active transaction (after BEGIN)
 * @param client - The database client (must be in a transaction)
 * @param businessId - Business ID
 * @param limitType - Type of limit to check
 * @returns { allowed: boolean, current: number, limit: number, message?: string }
 */
export async function checkLimitInTransaction(
  client: any,
  businessId: string,
  limitType: LimitCheckType
): Promise<{ allowed: boolean; current: number; limit: number; message?: string }> {
  
  // NOTE: Removed pg_advisory_xact_lock as it was causing deadlocks/hangs
  // The FOR UPDATE lock on the owning product's subscription row serialises concurrent creates.
  const ctx = await getBusinessPlatformContext(businessId);
  const ownerModule = getLimitOwnerModule(limitType) ?? ctx.primaryModule;

  const subscriptionResult = await client.query(`
    SELECT
      sp.id AS plan_id,
      bms.status,
      bms.trial_end_date,
      bms.end_date,
      bms.grace_period_end,
      sp.features->'limits' AS limits
    FROM business_module_subscriptions bms
    JOIN subscription_plans sp ON bms.plan_id = sp.id
    WHERE bms.business_id = $1 AND bms.status IN ('active', 'trial')
    ORDER BY (bms.module_key = $2) DESC, bms.module_key
    LIMIT 1
    FOR UPDATE OF bms
  `, [businessId, ownerModule]);


  if (subscriptionResult.rows.length === 0) {
    // Auto-assign free plan if no subscription (outside transaction context)
    // For now, return strict limits
    return { allowed: false, current: 0, limit: 0, message: 'No active subscription. Please contact support.' };
  }

  const subRow = subscriptionResult.rows[0];

  const limitKey = LIMIT_KEY_BY_TYPE[limitType];

  const txQueryOne = async (sql: string, params?: unknown[]) => {
    const result = await client.query(sql, params ?? []);
    return result.rows[0] ?? null;
  };

  const resolved = await resolveBusinessLimit(businessId, limitType, limitKey, txQueryOne);
  let maxLimit: number = resolved.maxLimit;

  if (maxLimit === 0 && resolved.blockedReason) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: resolved.blockedReason,
    };
  }

  if (maxLimit === 0) {
    const limits = subRow.limits;
    if (!limits) {
      return { allowed: false, current: 0, limit: 0, message: 'No limits defined' };
    }
    const jsonbKey = LIMIT_JSONB_KEY_MAP[limitKey];
    const jsonbValue = jsonbKey && limits[jsonbKey] !== undefined ? limits[jsonbKey] : 0;
    maxLimit = typeof jsonbValue === 'number' ? jsonbValue : parseInt(String(jsonbValue || '0'), 10);
  }

  // Ensure maxLimit is a number
  maxLimit = typeof maxLimit === 'number' ? maxLimit : parseInt(String(maxLimit || '0'), 10);

  if (maxLimit === -1) {
    return { allowed: true, current: 0, limit: -1 };
  }

  const { sql, params } = buildLimitCountQuery(limitType, businessId);
  const countResult = await client.query(sql, params);
  const currentCount = parseInt(String(countResult.rows[0]?.count ?? '0'), 10);

  const allowed = currentCount < maxLimit;
  

  return {
    allowed,
    current: currentCount,
    limit: maxLimit,
    message: allowed ? undefined : `You've reached your ${limitType} limit (${currentCount}/${maxLimit}). Please upgrade your plan to continue.`
  };
}

/**
 * Get usage summary for a business
 */
export async function getUsageSummary(businessId: string) {
  const subscription = await getBusinessSubscription(businessId);
  
  if (!subscription) {
    return null;
  }

  const usageTypes: LimitCheckType[] = [
    'invoices',
    'customers',
    'items',
    'users',
    'whatsapp',
    'purchases',
    'suppliers',
    'expenses',
    'estimates',
    'credit_notes',
    'sales_orders',
    'purchase_orders',
    'branches',
    'employees',
  ];

  const checks = await Promise.all(
    usageTypes.map(async (type) => [type, await checkLimit(businessId, type)] as const)
  );

  return {
    plan: {
      id: subscription.plan_id,
      name: subscription.plan_name,
      display_name: subscription.plan_display_name,
      status: subscription.status,
    },
    usage: Object.fromEntries(checks),
  };
}

/**
 * WhatsApp Add-on Types
 */
export type WhatsAppAddonType = 'whatsapp_bot' | 'whatsapp_send_message' | 'khatario_ai';

export interface WhatsAppAddon {
  id: string;
  business_id: string;
  addon_type: WhatsAppAddonType;
  status: 'active' | 'expired' | 'cancelled';
  price_monthly: number;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

// Subscription cache (in-memory cache with TTL)
interface SubscriptionCacheEntry {
  subscription: BusinessSubscription | null;
  timestamp: number;
}

const subscriptionCache = new Map<string, SubscriptionCacheEntry>();
const SUBSCRIPTION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Addon cache (in-memory cache with TTL)
interface AddonCacheEntry {
  hasAddon: boolean;
  timestamp: number;
}

const addonCache = new Map<string, AddonCacheEntry>();
const ADDON_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a business has an active WhatsApp Bot add-on
 * Uses in-memory cache to reduce database queries
 */
export async function hasWhatsAppBotAddon(businessId: string, skipCache: boolean = false): Promise<boolean> {
  // Check cache first (unless skipCache is true)
  if (!skipCache) {
    const cached = addonCache.get(businessId);
    if (cached && (Date.now() - cached.timestamp) < ADDON_CACHE_TTL) {
      return cached.hasAddon;
    }
  }

  try {
    const addon = await db.queryOne<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM whatsapp_addons
      WHERE business_id = $1
        AND addon_type = 'whatsapp_bot'
        AND status = 'active'
        AND (start_date IS NULL OR start_date <= CURRENT_DATE)
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    `, [businessId]);

    const hasAddon = parseInt(addon?.count || '0', 10) > 0;
    
    // Update cache
    addonCache.set(businessId, {
      hasAddon,
      timestamp: Date.now()
    });

    return hasAddon;
  } catch (error) {
    console.error('Error checking WhatsApp Bot addon:', error);
    return false;
  }
}

/**
 * Clear addon cache for a business (call after purchase/activation)
 */
export function clearAddonCache(businessId: string) {
  addonCache.delete(businessId);
}

/**
 * Check if a business has an active WhatsApp Send Message add-on
 */
export async function hasWhatsAppSendMessageAddon(businessId: string): Promise<boolean> {
  try {
    const addon = await db.queryOne<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM whatsapp_addons
      WHERE business_id = $1
        AND addon_type = 'whatsapp_send_message'
        AND status = 'active'
        AND (start_date IS NULL OR start_date <= CURRENT_DATE)
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    `, [businessId]);

    return parseInt(addon?.count || '0', 10) > 0;
  } catch (error) {
    console.error('Error checking WhatsApp Send Message addon:', error);
    return false;
  }
}

/**
 * Get all active add-ons for a business
 */
export async function getBusinessAddons(businessId: string): Promise<WhatsAppAddon[]> {
  try {
    const addons = await db.queryRows<WhatsAppAddon>(`
      SELECT id, business_id, addon_type, status, price_monthly, 
             start_date::text, end_date::text, created_at::text, updated_at::text
      FROM whatsapp_addons
      WHERE business_id = $1
        AND status = 'active'
        AND (start_date IS NULL OR start_date <= CURRENT_DATE)
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
      ORDER BY created_at DESC
    `, [businessId]);

    return addons || [];
  } catch (error) {
    console.error('Error fetching business addons:', error);
    return [];
  }
}


