/**
 * Subscription Lifecycle Management
 *
 * Handles cancellation scheduling, downgrades, trial expiry checks,
 * and batch processing of expired subscriptions.
 */

import { query, queryOne, queryRows } from '@/lib/db';
import {
  getBusinessSubscription,
  clearSubscriptionCache,
  checkLimit,
  type BusinessSubscription,
  type SubscriptionPlan,
} from '@/lib/subscription';
import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';

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

export interface ExpiredSubscriptionCounts {
  trialExpired: number;
  cancelledAtPeriodEnd: number;
  scheduledDowngrades: number;
  graceStarted: number;
  graceExpired: number;
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
// Cancel
// ---------------------------------------------------------------------------

/**
 * Schedule cancellation at the end of the current billing period.
 *
 * The subscription stays **active** until `end_date` — it is NOT
 * immediately terminated. A background cron job
 * ({@link processExpiredSubscriptions}) finalises the cancellation once the
 * period elapses.
 *
 * @param businessId - Business UUID
 * @param reason     - Optional human-readable cancellation reason
 * @returns The updated subscription row
 */
export async function cancelSubscription(
  businessId: string,
  reason?: string,
): Promise<BusinessSubscription | null> {
  const subscription = await getBusinessSubscription(businessId);
  if (!subscription) {
    throw new Error(`No active subscription found for business ${businessId}`);
  }

  await query(
    `UPDATE business_subscriptions
     SET cancel_at_period_end = true,
         cancelled_at         = NOW(),
         updated_at           = NOW()
     WHERE business_id = $1
       AND status IN ('active', 'trial')`,
    [businessId],
  );

  await logSubscriptionEvent(businessId, 'cancelled', {
    from_plan_id: subscription.plan_id,
    reason: reason ?? null,
  });

  clearSubscriptionCache(businessId);

  return getBusinessSubscription(businessId, true);
}

// ---------------------------------------------------------------------------
// Downgrade
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

/**
 * Schedule a downgrade to a lower-tier plan at the end of the current billing
 * period. The user keeps their current plan until `end_date`, then the cron
 * job ({@link processExpiredSubscriptions}) applies the switch.
 *
 * Call **without** `confirmed` (or `confirmed: false`) to receive a dry-run
 * response containing data-impact warnings. Call with `confirmed: true` to
 * schedule the downgrade.
 *
 * @param businessId   - Business UUID
 * @param targetPlanId - ID of the plan to downgrade to
 * @param options.confirmed - Set to `true` to actually schedule the downgrade
 * @returns `{ dataImpact, scheduled_date, subscription? }`
 */
export async function downgradeSubscription(
  businessId: string,
  targetPlanId: string,
  options?: { confirmed?: boolean },
): Promise<{
  dataImpact: DataImpactWarning[];
  scheduled_date?: string | null;
  subscription?: BusinessSubscription | null;
}> {
  const currentSubscription = await getBusinessSubscription(businessId);
  if (!currentSubscription) {
    throw new Error(`No active subscription found for business ${businessId}`);
  }

  if (targetPlanId === TRIAL_PLAN_ID) {
    throw new Error(
      `Trial cannot be selected as a plan change. Trial is assigned at signup only; choose Free or a paid plan.`,
    );
  }

  // Validate target plan exists
  const targetPlan = await queryOne<{ id: string; sort_order: number }>(
    `SELECT id, sort_order FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [targetPlanId],
  );
  if (!targetPlan) {
    throw new Error(`Target plan "${targetPlanId}" not found or inactive`);
  }

  // Validate it's actually a lower tier (lower sort_order = lower tier)
  const currentPlan = await queryOne<{ sort_order: number }>(
    `SELECT sort_order FROM subscription_plans WHERE id = $1`,
    [currentSubscription.plan_id],
  );
  if (currentPlan && targetPlan.sort_order >= currentPlan.sort_order) {
    throw new Error(
      `Target plan "${targetPlanId}" is not a lower tier than the current plan "${currentSubscription.plan_id}"`,
    );
  }

  const dataImpact = await getDataImpactWarnings(businessId, targetPlanId);

  if (!options?.confirmed) {
    return { dataImpact, scheduled_date: currentSubscription.end_date };
  }

  // Schedule the downgrade — don't change plan_id yet
  await query(
    `UPDATE business_subscriptions
     SET scheduled_plan_id = $2,
         updated_at        = NOW()
     WHERE business_id = $1
       AND status IN ('active', 'trial')`,
    [businessId, targetPlanId],
  );

  await logSubscriptionEvent(businessId, 'downgrade_scheduled', {
    from_plan_id: currentSubscription.plan_id,
    to_plan_id: targetPlanId,
    scheduled_date: currentSubscription.end_date,
    data_impact: dataImpact.filter((w) => w.willExceed),
  });

  clearSubscriptionCache(businessId);

  const updated = await getBusinessSubscription(businessId, true);
  return {
    dataImpact,
    scheduled_date: currentSubscription.end_date,
    subscription: updated,
  };
}

/**
 * Cancel a previously scheduled downgrade.
 */
export async function cancelScheduledDowngrade(
  businessId: string,
): Promise<BusinessSubscription | null> {
  const subscription = await getBusinessSubscription(businessId);
  if (!subscription) {
    throw new Error(`No active subscription found for business ${businessId}`);
  }
  if (!subscription.scheduled_plan_id) {
    throw new Error('No scheduled downgrade to cancel');
  }

  await query(
    `UPDATE business_subscriptions
     SET scheduled_plan_id = NULL,
         updated_at        = NOW()
     WHERE business_id = $1`,
    [businessId],
  );

  await logSubscriptionEvent(businessId, 'downgrade_cancelled', {
    from_plan_id: subscription.plan_id,
    to_plan_id: subscription.scheduled_plan_id,
  });

  clearSubscriptionCache(businessId);

  return getBusinessSubscription(businessId, true);
}

// ---------------------------------------------------------------------------
// Trial expiry
// ---------------------------------------------------------------------------

const TRIAL_DAYS = 30;
const GRACE_DAYS = 7;

/**
 * Check whether a business's trial has expired.
 *
 * Trial duration is {@link TRIAL_DAYS} days from signup. After the trial
 * expires the business enters a {@link GRACE_DAYS}-day grace window. Once
 * the grace window elapses the business is downgraded to the free plan by
 * the batch processor ({@link processExpiredSubscriptions}).
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

  const trialEnd = subscription.trial_end_date
    ? new Date(subscription.trial_end_date)
    : new Date(
        new Date(subscription.start_date).getTime() +
          TRIAL_DAYS * 24 * 60 * 60 * 1000,
      );

  const now = new Date();
  const msRemaining = trialEnd.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));

  const isExpired = now > trialEnd;
  const graceEndsAt = new Date(
    trialEnd.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000,
  );
  const isInGracePeriod = isExpired && now <= graceEndsAt;

  return { isExpired, daysRemaining, graceEndsAt, isInGracePeriod };
}

// ---------------------------------------------------------------------------
// Batch processing (cron)
// ---------------------------------------------------------------------------

/**
 * Downgrade a single business to the free plan (cron, admin, scripts).
 */
export async function moveSubscriptionToFree(
  businessId: string,
  fromPlanId: string,
  eventType: string,
): Promise<void> {
  await query(
    `UPDATE business_subscriptions
     SET plan_id              = 'free',
         status               = 'active',
         trial_end_date       = NULL,
         end_date             = NULL,
         grace_period_end     = NULL,
         scheduled_plan_id    = NULL,
         cancel_at_period_end = false,
         cancelled_at         = NULL,
         downgraded_from      = $2,
         updated_at           = NOW()
     WHERE business_id = $1`,
    [businessId, fromPlanId],
  );

  await logSubscriptionEvent(businessId, eventType, {
    from_plan_id: fromPlanId,
    to_plan_id: 'free',
  });

  clearSubscriptionCache(businessId);
}

async function downgradeToFree(
  businessId: string,
  fromPlanId: string,
  eventType: string,
): Promise<void> {
  await moveSubscriptionToFree(businessId, fromPlanId, eventType);
}

/**
 * Batch-process expired subscriptions. Designed to be invoked by a cron job.
 *
 * Handles four scenarios:
 * 1. **Expired trials past grace** — trial ended > 7 days ago → downgrade to free
 * 2. **Scheduled cancellations** — `cancel_at_period_end = true` and `end_date` in
 *    the past → set status to cancelled, downgrade to free
 * 3. **Lapsed renewals** — active subscription past `end_date` without
 *    cancellation → start a 7-day grace period
 * 4. **Grace period expired** — `grace_period_end` in the past → downgrade to free
 *
 * @returns Counts of subscriptions processed in each category
 */
export async function processExpiredSubscriptions(): Promise<ExpiredSubscriptionCounts> {
  const counts: ExpiredSubscriptionCounts = {
    trialExpired: 0,
    cancelledAtPeriodEnd: 0,
    scheduledDowngrades: 0,
    graceStarted: 0,
    graceExpired: 0,
  };

  // 1. Trials past grace — includes status=trial and stale plan_id=trial rows
  const expiredTrials = await queryRows<{
    business_id: string;
    plan_id: string;
  }>(
    `SELECT business_id, plan_id
     FROM business_subscriptions
     WHERE plan_id = 'trial'
       AND (
         (status = 'trial'
          AND trial_end_date IS NOT NULL
          AND trial_end_date < CURRENT_DATE - INTERVAL '7 days')
         OR (
           end_date IS NOT NULL
           AND end_date < CURRENT_DATE
           AND (
             grace_period_end IS NOT NULL AND grace_period_end < CURRENT_DATE
             OR grace_period_end IS NULL AND end_date < CURRENT_DATE - INTERVAL '7 days'
           )
         )
       )`,
  );

  for (const row of expiredTrials) {
    await downgradeToFree(row.business_id, row.plan_id, 'trial_expired');
    counts.trialExpired++;
  }

  // 2. Scheduled cancellations past end_date
  const cancelledSubs = await queryRows<{
    business_id: string;
    plan_id: string;
  }>(
    `SELECT business_id, plan_id
     FROM business_subscriptions
     WHERE status = 'active'
       AND cancel_at_period_end = true
       AND end_date < NOW()`,
  );

  for (const row of cancelledSubs) {
    await query(
      `UPDATE business_subscriptions
       SET status = 'cancelled', updated_at = NOW()
       WHERE business_id = $1`,
      [row.business_id],
    );
    await downgradeToFree(row.business_id, row.plan_id, 'cancelled');
    counts.cancelledAtPeriodEnd++;
  }

  // 3. Scheduled downgrades past end_date — apply the plan switch
  const scheduledDowngrades = await queryRows<{
    business_id: string;
    plan_id: string;
    scheduled_plan_id: string;
  }>(
    `SELECT business_id, plan_id, scheduled_plan_id
     FROM business_subscriptions
     WHERE status = 'active'
       AND scheduled_plan_id IS NOT NULL
       AND end_date < NOW()`,
  );

  for (const row of scheduledDowngrades) {
    await query(
      `UPDATE business_subscriptions
       SET plan_id            = $2,
           scheduled_plan_id  = NULL,
           downgraded_from    = $3,
           start_date         = CURRENT_DATE,
           end_date           = (CURRENT_DATE + INTERVAL '1 month')::date,
           updated_at         = NOW()
       WHERE business_id = $1`,
      [row.business_id, row.scheduled_plan_id, row.plan_id],
    );

    await logSubscriptionEvent(row.business_id, 'downgraded', {
      from_plan_id: row.plan_id,
      to_plan_id: row.scheduled_plan_id,
    });

    clearSubscriptionCache(row.business_id);
    counts.scheduledDowngrades++;
  }

  // 4. Active subs past end_date without cancellation → start grace period
  const lapsedSubs = await queryRows<{
    business_id: string;
    plan_id: string;
    end_date: string;
  }>(
    `SELECT business_id, plan_id, end_date
     FROM business_subscriptions
     WHERE status = 'active'
       AND cancel_at_period_end = false
       AND end_date < NOW()
       AND grace_period_end IS NULL`,
  );

  for (const row of lapsedSubs) {
    await query(
      `UPDATE business_subscriptions
       SET grace_period_end = (end_date + INTERVAL '7 days')::date,
           updated_at       = NOW()
       WHERE business_id = $1`,
      [row.business_id],
    );
    await logSubscriptionEvent(row.business_id, 'grace_started', {
      from_plan_id: row.plan_id,
      grace_period_end: new Date(
        new Date(row.end_date).getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    counts.graceStarted++;
  }

  // 4. Grace period expired
  const graceExpired = await queryRows<{
    business_id: string;
    plan_id: string;
  }>(
    `SELECT business_id, plan_id
     FROM business_subscriptions
     WHERE grace_period_end IS NOT NULL
       AND grace_period_end < NOW()
       AND status = 'active'`,
  );

  for (const row of graceExpired) {
    await downgradeToFree(row.business_id, row.plan_id, 'grace_expired');
    counts.graceExpired++;
  }

  return counts;
}
