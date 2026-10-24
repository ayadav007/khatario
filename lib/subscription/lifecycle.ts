/**
 * Subscription Lifecycle Management
 *
 * Event log, downgrade impact, trial expiry checks, and the cron batch that
 * processes per-product (business_module_subscriptions) renewals and expiries.
 */

import { query, queryOne, queryRows } from '@/lib/db';
import {
  getBusinessSubscription,
  clearSubscriptionCache,
  checkLimit,
  type SubscriptionPlan,
} from '@/lib/subscription';
import { HR_TRIAL_PLAN_ID, SIGNUP_TRIAL_DAYS } from '@/lib/product-lines';
import { type PlatformModule } from '@/lib/platform-modules';
import {
  isLocalCalendarOnOrBeforeToday,
  parseLocalDateOnly,
  startOfLocalToday,
} from '@/lib/subscription/date-only';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubscriptionEvent {
  id: string;
  business_id: string;
  event_type: string;
  from_plan_id: string | null;
  to_plan_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface DataImpactWarning {
  limitType: string;
  currentCount: number;
  newLimit: number;
  willExceed: boolean;
  message: string;
}

export interface TrialExpiryInfo {
  isExpired: boolean;
  daysRemaining: number;
  graceEndsAt: Date | null;
  isInGracePeriod: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log an event to the subscription_events audit table.
 *
 * @param businessId - Business UUID
 * @param eventType  - One of: created, upgraded, downgraded, cancelled, renewed,
 *                     expired, trial_started, trial_expired, grace_started,
 *                     grace_expired, payment_succeeded, payment_failed
 * @param details    - Arbitrary JSON payload (from_plan_id / to_plan_id are
 *                     top-level columns, everything else goes here)
 */
export async function logSubscriptionEvent(
  businessId: string,
  eventType: string,
  details?: {
    from_plan_id?: string;
    to_plan_id?: string;
    [key: string]: unknown;
  },
): Promise<SubscriptionEvent> {
  const { from_plan_id, to_plan_id, ...rest } = details ?? {};

  const event = await queryOne<SubscriptionEvent>(
    `INSERT INTO subscription_events
       (business_id, event_type, from_plan_id, to_plan_id, details)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      businessId,
      eventType,
      from_plan_id ?? null,
      to_plan_id ?? null,
      JSON.stringify(rest),
    ],
  );

  return event!;
}

/**
 * Get the full subscription event history for a business, newest first.
 */
export async function getSubscriptionHistory(
  businessId: string,
): Promise<SubscriptionEvent[]> {
  return queryRows<SubscriptionEvent>(
    `SELECT id, business_id, event_type, from_plan_id, to_plan_id, details, created_at
     FROM subscription_events
     WHERE business_id = $1
     ORDER BY created_at DESC`,
    [businessId],
  );
}

// ---------------------------------------------------------------------------
// Downgrade impact
// ---------------------------------------------------------------------------

/**
 * Check what plan limits will be exceeded if a business downgrades.
 *
 * Compares current usage counts against the target plan's limits and returns
 * a per-limit breakdown.
 *
 * @param businessId   - Business UUID
 * @param targetPlanId - ID of the plan to downgrade to
 * @returns Array of warnings per limit type
 */
export async function getDataImpactWarnings(
  businessId: string,
  targetPlanId: string,
): Promise<DataImpactWarning[]> {
  const targetPlan = await queryOne<SubscriptionPlan>(
    `SELECT id, features FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [targetPlanId],
  );

  if (!targetPlan) {
    throw new Error(`Target plan "${targetPlanId}" not found or inactive`);
  }

  const features =
    typeof targetPlan.features === 'string'
      ? JSON.parse(targetPlan.features)
      : targetPlan.features;

  // Also fetch from the limits registry (takes precedence over JSONB)
  const registryLimits = await queryRows<{ limit_key: string; limit_value: number }>(
    `SELECT limit_key, limit_value FROM subscription_plan_limits WHERE plan_id = $1`,
    [targetPlanId],
  );

  const registryMap = new Map(registryLimits.map((r) => [r.limit_key, r.limit_value]));

  const limitTypes = [
    'invoices',
    'customers',
    'items',
    'users',
    'employees',
    'suppliers',
    'purchases',
    'expenses',
    'estimates',
    'credit_notes',
    'sales_orders',
    'purchase_orders',
    'branches',
  ] as const;

  const { LIMIT_KEY_BY_TYPE } = await import('@/lib/subscription/limit-registry');
  const { resolvePlanLimitValue } = await import('@/lib/subscription');

  const friendlyNames: Record<string, string> = {
    invoices: 'Invoices per month',
    customers: 'Customers',
    items: 'Items',
    users: 'Users',
    employees: 'Employees',
    suppliers: 'Suppliers',
    purchases: 'Purchases per month',
    expenses: 'Expenses per month',
    estimates: 'Estimates per month',
    credit_notes: 'Credit notes per month',
    sales_orders: 'Sales orders per month',
    purchase_orders: 'Purchase orders per month',
    branches: 'Branches',
  };

  const warnings: DataImpactWarning[] = [];

  for (const lt of limitTypes) {
    const key = LIMIT_KEY_BY_TYPE[lt];

    const resolved = await resolvePlanLimitValue(targetPlanId, key);
    const newLimit =
      resolved ??
      registryMap.get(key) ??
      features?.limits?.[key] ??
      0;

    // -1 means unlimited on target plan — no risk
    if (newLimit === -1) continue;

    const usage = await checkLimit(businessId, lt as any);

    const willExceed = usage.current > newLimit;
    warnings.push({
      limitType: lt,
      currentCount: usage.current,
      newLimit,
      willExceed,
      message: willExceed
        ? `${friendlyNames[lt]}: you currently have ${usage.current} but the new plan allows only ${newLimit}`
        : `${friendlyNames[lt]}: ${usage.current}/${newLimit} — within limit`,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Trial expiry
// ---------------------------------------------------------------------------

/**
 * Check whether a business's trial has expired.
 *
 * Trial duration is {@link SIGNUP_TRIAL_DAYS} days from signup. After expiry the tenant may
 * use a one-time in-app extension ({@link TRIAL_EXTENSION_DAYS} days). Until they extend
 * or choose Free, entitlements follow the free plan while the extend modal is offered.
 *
 * @param businessId - Business UUID
 * @returns Trial status including days remaining and grace period info
 */
export async function checkTrialExpiry(
  businessId: string,
): Promise<TrialExpiryInfo> {
  const subscription = await getBusinessSubscription(businessId);

  if (!subscription || subscription.status !== 'trial') {
    return {
      isExpired: true,
      daysRemaining: 0,
      graceEndsAt: null,
      isInGracePeriod: false,
    };
  }

  // Calendar dates, same rule as effective-plan: the end date is the last full trial day.
  let trialEnd = parseLocalDateOnly(subscription.trial_end_date);
  if (!trialEnd) {
    const start = parseLocalDateOnly(subscription.start_date) ?? startOfLocalToday();
    trialEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + SIGNUP_TRIAL_DAYS);
  }

  const isExpired = !isLocalCalendarOnOrBeforeToday(trialEnd);
  const dayMs = 24 * 60 * 60 * 1000;
  const daysRemaining = isExpired
    ? 0
    : Math.round((trialEnd.getTime() - startOfLocalToday().getTime()) / dayMs) + 1;

  return { isExpired, daysRemaining, graceEndsAt: null, isInGracePeriod: false };
}

// ---------------------------------------------------------------------------
// Move to free
// ---------------------------------------------------------------------------

/**
 * Move one product (default: the business's primary product) to its free plan.
 * Used by the trial-extension decline flow, stale-trial cleanup, and scripts.
 */
export async function moveSubscriptionToFree(
  businessId: string,
  fromPlanId: string,
  eventType: string,
  moduleKey?: PlatformModule,
): Promise<void> {
  const { getBusinessPlatformContext } = await import('@/lib/business-modules');
  const { moveModuleSubscriptionToFree } = await import(
    '@/lib/subscription/module-plan-lifecycle'
  );
  const target = moduleKey ?? (await getBusinessPlatformContext(businessId)).primaryModule;
  await moveModuleSubscriptionToFree(businessId, target, fromPlanId, eventType);
}

// ---------------------------------------------------------------------------
// Batch processing (cron)
// ---------------------------------------------------------------------------

export interface ModuleExpiredSubscriptionCounts {
  trialExpired: number;
  cancelledAtPeriodEnd: number;
  scheduledDowngrades: number;
  graceStarted: number;
  graceExpired: number;
}

/**
 * Batch-process per-product subscription lifecycle. Invoked by the check-subscriptions cron.
 *
 * 1. Extended trials expired — one-time extension used and `trial_end_date` passed → free
 * 2. Scheduled cancellations — `cancel_at_period_end` and `end_date` passed → free
 * 3. Scheduled downgrades — `scheduled_plan_id` and `end_date` passed → switch plan
 * 4. Lapsed renewals — active past `end_date` → start a 7-day grace period
 * 5. Grace period expired → free
 */
export async function processExpiredModuleSubscriptions(): Promise<ModuleExpiredSubscriptionCounts> {
  const { moveModuleSubscriptionToFree } = await import(
    '@/lib/subscription/module-plan-lifecycle'
  );
  const { clearModuleSubscriptionCache } = await import(
    '@/lib/subscription/module-subscriptions'
  );

  const counts: ModuleExpiredSubscriptionCounts = {
    trialExpired: 0,
    cancelledAtPeriodEnd: 0,
    scheduledDowngrades: 0,
    graceStarted: 0,
    graceExpired: 0,
  };

  const expiredTrials = await queryRows<{
    business_id: string;
    module_key: string;
    plan_id: string;
  }>(
    `SELECT business_id, module_key, plan_id
     FROM business_module_subscriptions
     WHERE plan_id IN ('trial', $1)
       AND trial_extension_granted = true
       AND trial_end_date IS NOT NULL
       AND trial_end_date < CURRENT_DATE
       AND trial_extension_declined_at IS NULL`,
    [HR_TRIAL_PLAN_ID],
  );

  for (const row of expiredTrials) {
    await moveModuleSubscriptionToFree(
      row.business_id,
      row.module_key as PlatformModule,
      row.plan_id,
      'trial_expired',
    );
    counts.trialExpired++;
  }

  const cancelledSubs = await queryRows<{
    business_id: string;
    module_key: string;
    plan_id: string;
  }>(
    `SELECT business_id, module_key, plan_id
     FROM business_module_subscriptions
     WHERE status IN ('active', 'trial')
       AND cancel_at_period_end = true
       AND end_date IS NOT NULL
       AND end_date < CURRENT_DATE`,
  );

  for (const row of cancelledSubs) {
    await moveModuleSubscriptionToFree(
      row.business_id,
      row.module_key as PlatformModule,
      row.plan_id,
      'cancelled',
    );
    counts.cancelledAtPeriodEnd++;
  }

  const scheduledDowngrades = await queryRows<{
    business_id: string;
    module_key: string;
    plan_id: string;
    scheduled_plan_id: string;
  }>(
    `SELECT business_id, module_key, plan_id, scheduled_plan_id
     FROM business_module_subscriptions
     WHERE status IN ('active', 'trial')
       AND scheduled_plan_id IS NOT NULL
       AND end_date IS NOT NULL
       AND end_date < CURRENT_DATE`,
  );

  for (const row of scheduledDowngrades) {
    await query(
      `UPDATE business_module_subscriptions
       SET plan_id = $3,
           scheduled_plan_id = NULL,
           downgraded_from = $4,
           start_date = CURRENT_DATE,
           end_date = (CURRENT_DATE + INTERVAL '1 month')::date,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND module_key = $2`,
      [row.business_id, row.module_key, row.scheduled_plan_id, row.plan_id],
    );

    await logSubscriptionEvent(row.business_id, 'downgraded', {
      module_key: row.module_key,
      from_plan_id: row.plan_id,
      to_plan_id: row.scheduled_plan_id,
    });

    clearSubscriptionCache(row.business_id);
    clearModuleSubscriptionCache(row.business_id);
    counts.scheduledDowngrades++;
  }

  const lapsedSubs = await queryRows<{
    business_id: string;
    module_key: string;
    plan_id: string;
    end_date: string;
  }>(
    `SELECT business_id, module_key, plan_id, end_date::text AS end_date
     FROM business_module_subscriptions
     WHERE status = 'active'
       AND cancel_at_period_end = false
       AND scheduled_plan_id IS NULL
       AND end_date IS NOT NULL
       AND end_date < CURRENT_DATE
       AND grace_period_end IS NULL`,
  );

  for (const row of lapsedSubs) {
    await query(
      `UPDATE business_module_subscriptions
       SET grace_period_end = (end_date + INTERVAL '7 days')::date,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND module_key = $2`,
      [row.business_id, row.module_key],
    );
    await logSubscriptionEvent(row.business_id, 'grace_started', {
      module_key: row.module_key,
      from_plan_id: row.plan_id,
    });
    clearSubscriptionCache(row.business_id);
    counts.graceStarted++;
  }

  const graceExpired = await queryRows<{
    business_id: string;
    module_key: string;
    plan_id: string;
  }>(
    `SELECT business_id, module_key, plan_id
     FROM business_module_subscriptions
     WHERE status = 'active'
       AND grace_period_end IS NOT NULL
       AND grace_period_end < CURRENT_DATE`,
  );

  for (const row of graceExpired) {
    await moveModuleSubscriptionToFree(
      row.business_id,
      row.module_key as PlatformModule,
      row.plan_id,
      'grace_expired',
    );
    counts.graceExpired++;
  }

  return counts;
}
