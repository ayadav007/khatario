/**
 * Feature Access Enforcement Primitive
 * 
 * This module provides a single source of truth for feature access enforcement.
 * ALL backend feature checks must go through this module.
 * 
 * FEATURE REGISTRY SYSTEM (ONE-WAY MIGRATION COMPLETE):
 * - Feature Registry (platform_features + subscription_plan_features) is the ONLY source of truth
 * - NO JSONB fallbacks - registry data is mandatory
 * - Supports addon-based features (WhatsApp) - added dynamically
 * - If registry_complete = true, missing features MUST fail fast
 * - Exception: core entitlement keys (customer_management, items, stock, payment_tracking) are not in the DB registry by design
 * 
 * DO NOT inline feature checks elsewhere.
 * DO NOT create duplicate logic.
 * DO NOT add JSONB fallbacks.
 */

import { NextResponse } from 'next/server';
import {
  getBusinessSubscription,
  hasWhatsAppBotAddon,
  isSubscriptionOperationalStatus,
} from '../subscription';
import { checkTrialExpiry } from './lifecycle';
import { getEntitlementPlanId } from './effective-plan';
import * as db from '../db';
import { normalizeFeatureKey, FeatureKeys } from '../featureKeys';

/**
 * Canonical keys not present in platform_features / subscription_plan_features by design.
 * Migrations map these to NULL ("core — always enabled" for any operational subscription).
 * @see database/migrations/012_feature_registry_system.sql (customer_management)
 */
const CORE_ENTITLEMENT_CANONICAL_KEYS = new Set<string>([
  FeatureKeys.CUSTOMER_MANAGEMENT,
  FeatureKeys.ITEM_MANAGEMENT,
  FeatureKeys.STOCK_TRACKING,
  FeatureKeys.PAYMENT_TRACKING,
]);

function isCoreEntitlementKey(canonicalKey: string): boolean {
  return CORE_ENTITLEMENT_CANONICAL_KEYS.has(canonicalKey);
}

/** HTTP 403 JSON `code` for all {@link FeatureAccessDeniedError} API responses — use for frontend handling. */
export const FEATURE_PLAN_DENIED_RESPONSE_CODE = 'FEATURE_NOT_IN_PLAN' as const;

/**
 * Custom error for feature access denial
 */
export class FeatureAccessDeniedError extends Error {
  constructor(
    public featureKey: string,
    public businessId: string,
    public reason: 'NO_SUBSCRIPTION' | 'FEATURE_NOT_ENABLED' | 'SUBSCRIPTION_EXPIRED' | 'SUBSCRIPTION_INACTIVE'
  ) {
    super(`Feature '${featureKey}' is not available for business ${businessId}. Reason: ${reason}`);
    this.name = 'FeatureAccessDeniedError';
  }

  /**
   * Canonical API body for subscription feature denial (403).
   */
  toResponse(): {
    error: string;
    code: typeof FEATURE_PLAN_DENIED_RESPONSE_CODE;
    feature: string;
  } {
    return {
      error: 'Feature not available in your plan',
      code: FEATURE_PLAN_DENIED_RESPONSE_CODE,
      feature: this.featureKey,
    };
  }

  /** Same shape as route handlers using {@link AuthorizationError#toNextResponse} */
  toNextResponse(): NextResponse {
    return NextResponse.json(this.toResponse(), { status: 403 });
  }
}

/**
 * Map legacy feature keys to Feature Registry IDs
 * This ensures backward compatibility when code uses old feature keys
 * 
 * NOTE: This function now uses canonical keys from featureKeys.ts
 * Legacy keys are normalized to canonical form first
 */
export function resolveRegistryFeatureId(featureKey: string): string {
  // Normalize to canonical key first
  const canonicalKey = normalizeFeatureKey(featureKey);
  
  // Map canonical keys to Feature Registry IDs (if different)
  const registryMapping: Record<string, string> = {
    [FeatureKeys.TODO]: 'tools_todo', // Map canonical 'todo' to registry 'tools_todo'
    [FeatureKeys.TEMPLATE_CUSTOMIZATION]: 'settings_template_customization',
    [FeatureKeys.INVOICE_CREATION]: 'sales_invoices',
    [FeatureKeys.ESTIMATES_QUOTATIONS]: 'sales_estimates',
    [FeatureKeys.CREDIT_NOTES]: 'sales_credit_notes',
    [FeatureKeys.DEBIT_NOTES]: 'sales_debit_notes',
    [FeatureKeys.RECURRING_INVOICES]: 'sales_recurring_invoices',
    [FeatureKeys.SALES_ORDERS]: 'sales_sales_orders',
    [FeatureKeys.SUPPLIER_MANAGEMENT]: 'purchase_suppliers',
    [FeatureKeys.EXPENSE_TRACKING]: 'purchase_expenses',
    [FeatureKeys.INVENTORY_ADJUSTMENTS]: 'purchase_inventory_adjustments',
    [FeatureKeys.MULTI_USER]: 'settings_multi_user',
    [FeatureKeys.MULTI_BRANCH]: 'settings_multi_branch',
    [FeatureKeys.MULTI_WAREHOUSE]: 'settings_multi_warehouse',
    [FeatureKeys.BACKUP_RESTORE]: 'settings_backup',
    [FeatureKeys.EMAIL_INVOICING]: 'integration_email',
    [FeatureKeys.PAYMENT_GATEWAY]: 'integration_payment_gateway',
    [FeatureKeys.API_ACCESS]: 'integration_api',
    [FeatureKeys.LEDGER_ACCOUNTING]: 'advanced_ledger',
    /** DB row id in {@code platform_features} (see migration 012 — JSONB alias was {@code custom_branding}) */
    [FeatureKeys.CUSTOM_BRANDING]: 'advanced_custom_branding',
    [FeatureKeys.OFFERS_PERCENT_DISCOUNT]: 'offers_percent_discount',
    [FeatureKeys.OFFERS_FLAT_DISCOUNT]: 'offers_flat_discount',
    [FeatureKeys.OFFERS_BOGO]: 'offers_buy_x_get_y',
    [FeatureKeys.OFFERS_BILL_VALUE]: 'offers_bill_value_discount',
  };
  
  return registryMapping[canonicalKey] || canonicalKey;
}

/**
 * Get enabled features for a business from Feature Registry
 * NO FALLBACKS - Registry is the only source of truth
 * 
 * @throws {Error} If registry is incomplete and registry_complete = true
 */
async function getEnabledFeaturesFromRegistry(
  businessId: string,
  planId: string
): Promise<string[]> {
  if (process.env.NODE_ENV === 'development') {
    console.log('[getEnabledFeaturesFromRegistry] Starting for plan:', planId);
  }

  // Check if plan is marked as registry_complete
  // Handle case where column doesn't exist (graceful degradation)
  let isRegistryComplete = false;
  let planExists = false;
  try {
    const planCheck = await db.queryOne(
      `SELECT registry_complete FROM subscription_plans WHERE id = $1`,
      [planId]
    );
    planExists = !!planCheck;
    isRegistryComplete = planCheck?.registry_complete === true;
  } catch (error: any) {
    // Column doesn't exist - treat as not complete (transition period)
    if (error.code === '42703' && error.message?.includes('registry_complete')) {
      console.warn('[getEnabledFeaturesFromRegistry] registry_complete column does not exist, treating as incomplete');
      isRegistryComplete = false;
      // Check if plan exists at all
      try {
        const planCheck = await db.queryOne(
          `SELECT id FROM subscription_plans WHERE id = $1`,
          [planId]
        );
        planExists = !!planCheck;
      } catch (e) {
        planExists = false;
      }
    } else {
      throw error; // Re-throw if it's a different error
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[getEnabledFeaturesFromRegistry] Plan check:', {
      planId,
      registryComplete: isRegistryComplete,
      planExists
    });
  }

  // Fetch enabled features from Feature Registry
  const result = await db.query(
    `SELECT pf.id
     FROM subscription_plan_features spf
     JOIN platform_features pf ON pf.id = spf.feature_id
     WHERE spf.plan_id = $1 
       AND spf.enabled = true
       AND pf.is_active = true`,
    [planId]
  );

  const enabledIds = result.rows.map((r: any) => r.id);

  if (process.env.NODE_ENV === 'development') {
    console.log('[getEnabledFeaturesFromRegistry] Query result:', {
      planId,
      rowCount: result.rows.length,
      enabledIds
    });
  }

  // HARD FAIL: If registry_complete = true and no features found, this is a critical error
  if (isRegistryComplete && enabledIds.length === 0) {
    throw new Error(
      `Feature Registry is incomplete for plan ${planId}. ` +
      `Plan is marked registry_complete=true but has zero enabled features. ` +
      `This indicates a migration failure or data corruption.`
    );
  }

  // If registry is not complete and empty, log warning but don't fail (transition period)
  if (!isRegistryComplete && enabledIds.length === 0) {
    console.warn(
      `Feature Registry is empty for plan ${planId}. ` +
      `Plan is not marked registry_complete. This should be addressed.`
    );
  }

  return enabledIds;
}

/**
 * Assert that a business has access to a specific feature.
 * 
 * FEATURE REGISTRY SYSTEM (ONE-WAY MIGRATION COMPLETE):
 * 1. Check Feature Registry ONLY (no JSONB fallback)
 * 2. Handle addon-based features (WhatsApp) - added dynamically
 * 3. If registry_complete = true, missing features MUST fail fast
 * 
 * This is the SINGLE source of truth for feature access enforcement.
 * All backend feature checks MUST use this function.
 * 
 * @param businessId - Business ID to check
 * @param featureKey - Feature key (registry ID or canonical key that maps to registry ID)
 * @throws {FeatureAccessDeniedError} If feature is not available
 * @throws {Error} If registry is incomplete and registry_complete = true
 * 
 * @example
 * // In API route
 * await assertFeatureAccess(business_id, 'sales_recurring_invoices');
 * 
 * @example
 * // In cron job
 * try {
 *   await assertFeatureAccess(business_id, 'sales_recurring_invoices');
 * } catch (error) {
 *   if (error instanceof FeatureAccessDeniedError) {
 *     console.log(`Skipping business ${business_id}: ${error.reason}`);
 *     return; // Skip processing
 *   }
 *   throw error;
 * }
 */
export async function assertFeatureAccess(
  businessId: string,
  featureKey: string
): Promise<void> {
  if (!businessId) {
    throw new FeatureAccessDeniedError(
      featureKey,
      businessId || 'unknown',
      'NO_SUBSCRIPTION'
    );
  }

  // Always skip cache: enforcement must match DB (subscription page uses direct SQL;
  // cached getBusinessSubscription can lag up to SUBSCRIPTION_CACHE_TTL after plan changes).
  const subscription = await getBusinessSubscription(businessId, true);

  // Check if subscription exists
  if (!subscription) {
    throw new FeatureAccessDeniedError(
      featureKey,
      businessId,
      'NO_SUBSCRIPTION'
    );
  }

  // Align with enforceAccess + getEnabledFeatures: trial is entitled like active
  if (!isSubscriptionOperationalStatus(subscription.status)) {
    throw new FeatureAccessDeniedError(
      featureKey,
      businessId,
      subscription.status === 'expired' ? 'SUBSCRIPTION_EXPIRED' : 'SUBSCRIPTION_INACTIVE'
    );
  }

  if (subscription.status === 'trial') {
    const trialInfo = await checkTrialExpiry(businessId);
    if (trialInfo.isExpired && !trialInfo.isInGracePeriod) {
      throw new FeatureAccessDeniedError(
        featureKey,
        businessId,
        'SUBSCRIPTION_EXPIRED'
      );
    }
  }

  // Check if subscription has expired (if end_date is set)
  if (subscription.end_date) {
    const endDate = new Date(subscription.end_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (endDate < today) {
      throw new FeatureAccessDeniedError(
        featureKey,
        businessId,
        'SUBSCRIPTION_EXPIRED'
      );
    }
  }

  const canonicalKey = normalizeFeatureKey(featureKey);
  const entitlementPlanId = getEntitlementPlanId(subscription);

  if (isCoreEntitlementKey(canonicalKey)) {
    return;
  }

  // Check if feature exists in Feature Registry (for addon detection)
  let featureInfo = null;
  try {
    featureInfo = await db.queryOne(
      `SELECT id, is_addon FROM platform_features WHERE id = $1 AND is_active = true`,
      [featureKey]
    );
  } catch (error) {
    // If platform_features table doesn't exist, this is a critical error
    throw new Error(
      `Feature Registry table (platform_features) is not accessible. ` +
      `This indicates a database schema issue. Error: ${error}`
    );
  }
  
  // Handle addon-based features (WhatsApp)
  if (featureInfo?.is_addon || 
      canonicalKey === FeatureKeys.WHATSAPP_BOT || 
      canonicalKey === FeatureKeys.WHATSAPP_SEND_MESSAGE ||
      featureKey === 'integration_whatsapp_manual' ||
      featureKey === 'integration_whatsapp_bot') {
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      throw new FeatureAccessDeniedError(
        canonicalKey,
        businessId,
        'FEATURE_NOT_ENABLED'
      );
    }
    // WhatsApp feature granted via addon - return early
    return;
  }

  // Check if plan is marked as registry_complete
  // Handle case where column doesn't exist (graceful degradation)
  let isRegistryComplete = false;
  try {
    const planCheck = await db.queryOne(
      `SELECT registry_complete FROM subscription_plans WHERE id = $1`,
      [entitlementPlanId]
    );
    isRegistryComplete = planCheck?.registry_complete === true;
  } catch (error: any) {
    // Column doesn't exist - treat as not complete (transition period)
    if (error.code === '42703' && error.message?.includes('registry_complete')) {
      console.warn('[assertFeatureAccess] registry_complete column does not exist, treating as incomplete');
      isRegistryComplete = false;
    } else {
      throw error; // Re-throw if it's a different error
    }
  }

  const enabledFeatures = await getEnabledFeaturesFromRegistry(businessId, entitlementPlanId);
  
  // Map canonical feature key to registry ID (e.g., 'template_customization' -> 'settings_template_customization')
  const registryFeatureId = resolveRegistryFeatureId(canonicalKey);
  
  // HARD FAIL: If registry_complete = true and feature not found, fail fast
  if (isRegistryComplete && !enabledFeatures.includes(registryFeatureId)) {
      throw new FeatureAccessDeniedError(
        canonicalKey,
        businessId,
        'FEATURE_NOT_ENABLED'
      );
  }

  // If registry is not complete, still check registry but log warning
  if (!isRegistryComplete && !enabledFeatures.includes(registryFeatureId)) {
    console.warn(
      `Feature ${registryFeatureId} not found in registry for plan ${entitlementPlanId}. ` +
      `Plan is not marked registry_complete. This should be addressed.`
    );
    throw new FeatureAccessDeniedError(
      canonicalKey,
      businessId,
      'FEATURE_NOT_ENABLED'
    );
  }

  // Feature found in registry - access granted
  return;
}

/** Parallel callers with the same canonical `(businessId, featureKey)` share one enforcement pass. */
const inflightHasFeatureAccess = new Map<string, Promise<boolean>>();

/**
 * Check if a business has access to a specific feature (non-throwing version).
 *
 * Resolution order (aligned with {@link assertFeatureAccess}):
 * - Loads subscription via {@link getBusinessSubscription} (`skipCache` for correctness)
 * - Operational `trial` and `active` statuses; rejects expired trials / inactive
 * - Core entitlement keys (`customer_management`, …) always allowed
 * - WhatsApp integrations: addons when flagged on `platform_features`
 * - **`subscription_plan_features` + `platform_features`** (“plan_features” matrix): feature must be enabled on the current `plan_id`
 *
 * Prefer {@link assertFeatureAccess} on API mutation paths where you throw 403 with {@link FEATURE_PLAN_DENIED_RESPONSE_CODE}.
 *
 * @param businessId Business ID
 * @param featureKey Canonical, legacy alias, or registry `feature_id` (see {@link resolveRegistryFeatureId})
 * @returns `true` if the plan matrix grants the capability
 */
export async function hasFeatureAccess(
  businessId: string,
  featureKey: string
): Promise<boolean> {
  if (!businessId?.trim()) return false;
  const canon = normalizeFeatureKey(featureKey);
  const dedupeKey = `${businessId}\u001f${canon}`;
  let pending = inflightHasFeatureAccess.get(dedupeKey);
  if (!pending) {
    pending = (async (): Promise<boolean> => {
      try {
        await assertFeatureAccess(businessId, featureKey);
        return true;
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) return false;
        throw error;
      }
    })();
    inflightHasFeatureAccess.set(dedupeKey, pending);
    void pending.finally(() => inflightHasFeatureAccess.delete(dedupeKey));
  }
  return pending;
}

/** Parallel callers with the same `businessId` share one subscription + matrix lookup for enabled ids. */
const inflightGetEnabledFeatures = new Map<string, Promise<string[]>>();

/**
 * Get enabled features for a business (for UI rendering)
 * Returns features from Feature Registry ONLY
 * NO JSONB fallback - registry is the only source of truth
 *
 * @throws {Error} If registry is incomplete and registry_complete = true
 */
export async function getEnabledFeatures(businessId: string): Promise<string[]> {
  if (!businessId) return [];
  let p = inflightGetEnabledFeatures.get(businessId);
  if (!p) {
    p = loadEnabledFeatureIdsForBusinessInternal(businessId);
    inflightGetEnabledFeatures.set(businessId, p);
    void p.finally(() => inflightGetEnabledFeatures.delete(businessId));
  }
  return p;
}

async function loadEnabledFeatureIdsForBusinessInternal(
  businessId: string
): Promise<string[]> {
  const subscription = await getBusinessSubscription(businessId, true);
  // Allow 'active' and 'trial' status (trial users should have feature access)
  if (!subscription || !isSubscriptionOperationalStatus(subscription.status)) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[getEnabledFeatures] No active/trial subscription found:', {
        businessId,
        subscription: subscription
          ? { status: subscription.status, plan_id: subscription.plan_id }
          : null,
      });
    }
    return [];
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[getEnabledFeatures] Found subscription:', {
      businessId,
      planId: subscription.plan_id,
      status: subscription.status,
    });
  }

  // Check if subscription has expired
  if (subscription.end_date) {
    const endDate = new Date(subscription.end_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (endDate < today) return [];
  }

  const entitlementPlanId = getEntitlementPlanId(subscription);
  const enabledFeatures = await getEnabledFeaturesFromRegistry(businessId, entitlementPlanId);

  for (const coreKey of CORE_ENTITLEMENT_CANONICAL_KEYS) {
    if (!enabledFeatures.includes(coreKey)) {
      enabledFeatures.push(coreKey);
    }
  }
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[getEnabledFeatures] Features from registry:', {
      planId: subscription.plan_id,
      enabledCount: enabledFeatures.length,
      enabledIds: enabledFeatures
    });
  }
  
  // Add addon-based features dynamically
  // Check for WhatsApp addon
  const hasWhatsAppAddon = await hasWhatsAppBotAddon(businessId);
  if (hasWhatsAppAddon) {
    // Add WhatsApp features if not already present
    if (!enabledFeatures.includes('integration_whatsapp_manual')) {
      enabledFeatures.push('integration_whatsapp_manual');
    }
    if (!enabledFeatures.includes('integration_whatsapp_bot')) {
      enabledFeatures.push('integration_whatsapp_bot');
    }
  }
  
  // TODO: Add other addon types here when implemented
  // Example: if (hasOtherAddon) { enabledFeatures.push('other_addon_feature'); }

  if (process.env.NODE_ENV === 'development') {
    console.log('[getEnabledFeatures] Final enabled features:', {
      totalCount: enabledFeatures.length,
      features: enabledFeatures
    });
  }

  return enabledFeatures;
}

/**
 * Efficient snapshot of every enabled registry id (plan matrix + injections + WhatsApp addon rows).
 * Use in multi-gate flows instead of calling {@link hasFeatureAccess} in a tight loop.
 *
 * Backed by {@link getEnabledFeatures} (internally coalesced when requests overlap per `businessId`).
 */
export async function getAllFeatureAccessForBusiness(
  businessId: string
): Promise<ReadonlySet<string>> {
  const list = await getEnabledFeatures(businessId);
  return new Set(list);
}

/**
 * Get report category from database based on route path.
 * Falls back to null if not found (for backward compatibility).
 * 
 * @param routePath - Route path (e.g., '/reports/sales/summary')
 * @returns Category ('basic', 'gst', 'advanced') or null if not found
 */
export async function getReportCategory(routePath: string): Promise<'basic' | 'gst' | 'advanced' | null> {
  try {
    const report = await db.queryOne<{ category: string }>(
      `SELECT category 
       FROM report_definitions 
       WHERE route_path = $1 AND is_active = true
       LIMIT 1`,
      [routePath]
    );

    if (report && ['basic', 'gst', 'advanced'].includes(report.category)) {
      return report.category as 'basic' | 'gst' | 'advanced';
    }
  } catch (error) {
    // Table might not exist yet (migration not run) - return null for fallback
    console.debug('Report definitions table not available, using fallback:', error);
  }
  
  return null;
}

/**
 * Assert that a business has access to a specific report type.
 * 
 * This is a convenience wrapper for report-specific feature checks.
 * All report endpoints MUST use this function.
 * 
 * @param businessId - Business ID to check
 * @param reportType - Type of report: 'basic', 'gst', or 'advanced' (or route path)
 * @param routePath - Optional route path to look up category from database
 * @throws {FeatureAccessDeniedError} If report access is not available
 * 
 * Mapping:
 * - 'basic' → requires 'reports_basic' feature (Professional+)
 * - 'gst' → requires 'reports_gst' feature (Business+)
 * - 'advanced' → requires 'reports_advanced' feature (Business+)
 * 
 * If routePath is provided, the category will be looked up from the database first.
 * This allows admin-managed report categorization.
 * 
 * @example
 * // In report endpoint (using explicit category)
 * await assertReportAccess(business_id, 'gst');
 * 
 * @example
 * // In report endpoint (using route path - preferred)
 * await assertReportAccess(business_id, 'gst', '/reports/gst/gstr1');
 */
export async function assertReportAccess(
  businessId: string,
  reportType: 'basic' | 'gst' | 'advanced' | string,
  routePath?: string
): Promise<void> {
  let category: 'basic' | 'gst' | 'advanced';
  
  // If routePath provided, look up category from database first
  if (routePath) {
    const dbCategory = await getReportCategory(routePath);
    if (dbCategory) {
      category = dbCategory;
    } else {
      // Fallback to reportType if not found in database
      if (!['basic', 'gst', 'advanced'].includes(reportType)) {
        throw new Error(`Invalid report type: ${reportType}. Must be 'basic', 'gst', or 'advanced'`);
      }
      category = reportType as 'basic' | 'gst' | 'advanced';
    }
  } else {
    // Use reportType directly
    if (!['basic', 'gst', 'advanced'].includes(reportType)) {
      throw new Error(`Invalid report type: ${reportType}. Must be 'basic', 'gst', or 'advanced'`);
    }
    category = reportType as 'basic' | 'gst' | 'advanced';
  }

  const featureMap: Record<'basic' | 'gst' | 'advanced', string> = {
    'basic': 'reports_basic',
    'gst': 'reports_gst',
    'advanced': 'reports_advanced'
  };

  const featureKey = featureMap[category];
  if (!featureKey) {
    throw new Error(`Invalid report category: ${category}`);
  }

  await assertFeatureAccess(businessId, featureKey);
}

