import type { PoolClient } from 'pg';
import { query, queryOne } from '@/lib/db';
import { type PlatformModule } from '@/lib/platform-modules';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logSubscriptionEvent, getDataImpactWarnings, type DataImpactWarning } from '@/lib/subscription/lifecycle';
import { HR_TRIAL_PLAN_ID } from '@/lib/product-lines';
import { GRACE_DAYS } from '@/lib/subscription/effective-plan';
import { getModuleSubscription, clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { assertPlanMatchesModule } from '@/lib/subscription/plan-module';
import { comparePlanTier, FREE_TIER_PLAN_IDS } from '@/lib/subscription/plan-tier';
import { planOpenToBusiness } from '@/lib/subscription/public-plans';
import { isTrialPlanId, TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';
import {
  getFreePlanIdForModule,
  isModuleOnFreePlan,
} from '@/lib/subscription/module-operational-check';

export async function downgradeModuleSubscription(
  businessId: string,
  moduleKey: PlatformModule,
  targetPlanId: string,
  options?: { confirmed?: boolean },
): Promise<{
  dataImpact: DataImpactWarning[];
  scheduled_date?: string | null;
}> {
  await assertPlanMatchesModule(targetPlanId, moduleKey);

  const current = await getModuleSubscription(businessId, moduleKey, true);
  if (!current || !['active', 'trial'].includes(current.status)) {
    throw new Error(`No active ${moduleKey} subscription found for this business`);
  }

  if (targetPlanId === TRIAL_PLAN_ID || targetPlanId === 'hr_trial') {
    throw new Error('Trial cannot be selected as a plan change target.');
  }

  const targetPlan = await queryOne<{ id: string; sort_order: number }>(
    `SELECT id, sort_order FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [targetPlanId],
  );
  // The module's own free plan stays a valid target even though it may not be public.
  const onSale =
    targetPlanId === getFreePlanIdForModule(moduleKey) ||
    (await planOpenToBusiness(businessId, targetPlanId));
  if (!targetPlan || !onSale) {
    throw new Error(`Target plan "${targetPlanId}" not found or inactive`);
  }

  const currentPlan = await queryOne<{ id: string; sort_order: number }>(
    `SELECT id, sort_order FROM subscription_plans WHERE id = $1`,
    [current.plan_id],
  );
  // A trial plan sorts above every new plan, so tier order alone would call trial -> paid a downgrade.
  const leavingTrialForPaid = isTrialPlanId(current.plan_id) && !FREE_TIER_PLAN_IDS.has(targetPlanId);
  if (leavingTrialForPaid || (currentPlan && comparePlanTier(targetPlan, currentPlan) !== -1)) {
    throw new Error(
      `Target plan "${targetPlanId}" is not a lower tier than the current ${moduleKey} plan`,
    );
  }

  const dataImpact = await getDataImpactWarnings(businessId, targetPlanId);

  if (!options?.confirmed) {
    return { dataImpact, scheduled_date: current.end_date ?? null };
  }

  await query(
    `UPDATE business_module_subscriptions
     SET scheduled_plan_id = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, moduleKey, targetPlanId],
  );

  await logSubscriptionEvent(businessId, 'downgrade_scheduled', {
    module_key: moduleKey,
    from_plan_id: current.plan_id,
    to_plan_id: targetPlanId,
    scheduled_date: current.end_date,
    data_impact: dataImpact.filter((w) => w.willExceed),
  });

  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);

  return { dataImpact, scheduled_date: current.end_date ?? null };
}

export async function cancelModuleScheduledDowngrade(
  businessId: string,
  moduleKey: PlatformModule,
): Promise<void> {
  const current = await getModuleSubscription(businessId, moduleKey, true);
  if (!current) {
    throw new Error(`No ${moduleKey} subscription found`);
  }

  const scheduled = await queryOne<{ scheduled_plan_id: string | null }>(
    `SELECT scheduled_plan_id FROM business_module_subscriptions
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, moduleKey],
  );

  if (!scheduled?.scheduled_plan_id) {
    throw new Error('No scheduled downgrade to cancel for this product');
  }

  await query(
    `UPDATE business_module_subscriptions
     SET scheduled_plan_id = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, moduleKey],
  );

  await logSubscriptionEvent(businessId, 'downgrade_cancelled', {
    module_key: moduleKey,
    from_plan_id: current.plan_id,
    to_plan_id: scheduled.scheduled_plan_id,
  });

  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);
}

export async function cancelModuleSubscription(
  businessId: string,
  moduleKey: PlatformModule,
  reason?: string,
): Promise<{ end_date: string | null }> {
  const current = await getModuleSubscription(businessId, moduleKey, true);
  if (!current || !['active', 'trial'].includes(current.status)) {
    throw new Error(`No active ${moduleKey} subscription found for this business`);
  }

  if (isModuleOnFreePlan(current)) {
    throw new Error(
      'This product is already on the free plan. Use "Disable product" in Your products to turn it off.',
    );
  }

  if (current.cancel_at_period_end) {
    throw new Error('Cancellation is already scheduled for this product.');
  }

  await query(
    `UPDATE business_module_subscriptions
     SET cancel_at_period_end = true,
         cancelled_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, moduleKey],
  );

  await logSubscriptionEvent(businessId, 'cancelled', {
    module_key: moduleKey,
    from_plan_id: current.plan_id,
    reason: reason ?? null,
    scheduled_date: current.end_date,
  });

  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);

  return { end_date: current.end_date ?? null };
}

/** SQL form of "paid grace has ended"; the nightly job's selection and the move-to-free guard share it. */
export const NOT_TRIAL_PLAN_SQL = `plan_id NOT IN ('${TRIAL_PLAN_ID}', '${HR_TRIAL_PLAN_ID}')`;

export const GRACE_EXPIRED_CONDITION = `status = 'active' AND (
    (grace_period_end IS NOT NULL AND grace_period_end < CURRENT_DATE)
    OR (grace_period_end IS NULL
        AND COALESCE(cancel_at_period_end, false) = false
        AND scheduled_plan_id IS NULL
        AND ${NOT_TRIAL_PLAN_SQL}
        AND end_date IS NOT NULL
        AND end_date + ${GRACE_DAYS} < CURRENT_DATE)
  )`;

/** Extra conditions that make the move-to-free UPDATE a no-op if the row changed since it was selected. */
export type MoveToFreeOnlyIf = 'grace_expired' | 'cancel_due' | 'trial_due' | 'scheduled_due';

const MOVE_TO_FREE_CONDITIONS: Record<MoveToFreeOnlyIf, string> = {
  // Grace is over: the stamp has passed, or (no stamp) the end date + GRACE_DAYS has. Mirrors
  // getPaidGraceEndDate() in effective-plan.ts; the nightly selection uses the same text.
  grace_expired: GRACE_EXPIRED_CONDITION,
  cancel_due: 'cancel_at_period_end = true AND end_date IS NOT NULL AND end_date < CURRENT_DATE',
  trial_due:
    'trial_extension_granted = true AND trial_end_date IS NOT NULL AND trial_end_date < CURRENT_DATE AND trial_extension_declined_at IS NULL',
  scheduled_due: 'scheduled_plan_id IS NOT NULL AND end_date IS NOT NULL AND end_date < CURRENT_DATE',
};

/** Run the move-to-free UPDATE on the caller's transaction and hand the follow-up steps back to run after its commit. */
export type MoveToFreeTx = { client: Pick<PoolClient, 'query'>; afterCommit: (fn: () => Promise<void>) => void };

/**
 * Move a module to its free plan. With `onlyIf`, the UPDATE repeats the condition that selected the
 * row; if nothing changed (e.g. a payment landed meanwhile) no event is logged, no cache is touched
 * and `false` is returned. Without `onlyIf` the move is unconditional and returns `true`.
 */
export async function moveModuleSubscriptionToFree(
  businessId: string,
  moduleKey: PlatformModule,
  fromPlanId: string,
  eventType: string,
  onlyIf?: MoveToFreeOnlyIf,
  tx?: MoveToFreeTx,
): Promise<boolean> {
  const freePlanId = getFreePlanIdForModule(moduleKey);
  const guard = onlyIf ? ` AND ${MOVE_TO_FREE_CONDITIONS[onlyIf]}` : '';

  const result = await (tx ? tx.client.query.bind(tx.client) : query)(
    `UPDATE business_module_subscriptions
     SET plan_terms_id = CASE WHEN plan_id IS DISTINCT FROM $3 THEN NULL ELSE plan_terms_id END,
         plan_id = $3,
         status = 'active',
         trial_end_date = NULL,
         end_date = NULL,
         grace_period_end = NULL,
         scheduled_plan_id = NULL,
         cancel_at_period_end = false,
         cancelled_at = NULL,
         downgraded_from = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2${guard}`,
    [businessId, moduleKey, freePlanId, fromPlanId],
  );
  if (onlyIf && (result.rowCount ?? 0) === 0) return false;

  const finish = async () => {
  await logSubscriptionEvent(businessId, eventType, {
    module_key: moduleKey,
    from_plan_id: fromPlanId,
    to_plan_id: freePlanId,
  });

  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);

  // Paid HR cancelled → hr_free, then the Billing bundle applies again.
  // Billing dropped to Free → its bundled HR goes too.
  if (moduleKey === 'hr' || moduleKey === 'billing') {
    const { ensureComplimentaryHrForBilling } = await import(
      '@/lib/subscription/ensure-complimentary-hr'
    );
    await ensureComplimentaryHrForBilling(businessId);
  }
  };
  // With `tx` the plan UPDATE above ran on the caller's transaction; the event, caches and the HR bundle run
  // after the caller commits (`tx.afterCommit`), so a rolled-back caller leaves no trace.
  if (tx) tx.afterCommit(finish);
  else await finish();
  return true;
}
