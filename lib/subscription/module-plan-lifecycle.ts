import { query, queryOne } from '@/lib/db';
import { type PlatformModule } from '@/lib/platform-modules';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { clearSubscriptionCache, getBusinessSubscription } from '@/lib/subscription';
import { logSubscriptionEvent, getDataImpactWarnings, type DataImpactWarning } from '@/lib/subscription/lifecycle';
import { getModuleSubscription, clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { assertPlanMatchesModule } from '@/lib/subscription/plan-module';
import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';
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
  if (!targetPlan) {
    throw new Error(`Target plan "${targetPlanId}" not found or inactive`);
  }

  const currentPlan = await queryOne<{ sort_order: number }>(
    `SELECT sort_order FROM subscription_plans WHERE id = $1`,
    [current.plan_id],
  );
  if (currentPlan && targetPlan.sort_order >= currentPlan.sort_order) {
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

  const ctx = await import('@/lib/business-modules').then((m) =>
    m.getBusinessPlatformContext(businessId),
  );
  if (ctx.primaryModule === moduleKey) {
    await query(
      `UPDATE business_subscriptions
       SET scheduled_plan_id = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND status IN ('active', 'trial')`,
      [businessId, targetPlanId],
    );
  }

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

  const ctx = await import('@/lib/business-modules').then((m) =>
    m.getBusinessPlatformContext(businessId),
  );
  if (ctx.primaryModule === moduleKey) {
    const legacy = await getBusinessSubscription(businessId, true);
    if (legacy?.scheduled_plan_id) {
      await query(
        `UPDATE business_subscriptions
         SET scheduled_plan_id = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $1`,
        [businessId],
      );
    }
  }

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
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, moduleKey],
  );

  const ctx = await getBusinessPlatformContext(businessId);
  if (ctx.primaryModule === moduleKey) {
    await query(
      `UPDATE business_subscriptions
       SET cancel_at_period_end = true,
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE business_id = $1 AND status IN ('active', 'trial')`,
      [businessId],
    );
  }

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

export async function moveModuleSubscriptionToFree(
  businessId: string,
  moduleKey: PlatformModule,
  fromPlanId: string,
  eventType: string,
): Promise<void> {
  const freePlanId = getFreePlanIdForModule(moduleKey);

  await query(
    `UPDATE business_module_subscriptions
     SET plan_id = $3,
         status = 'active',
         trial_end_date = NULL,
         end_date = NULL,
         grace_period_end = NULL,
         scheduled_plan_id = NULL,
         cancel_at_period_end = false,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, moduleKey, freePlanId],
  );

  await logSubscriptionEvent(businessId, eventType, {
    module_key: moduleKey,
    from_plan_id: fromPlanId,
    to_plan_id: freePlanId,
  });

  const ctx = await getBusinessPlatformContext(businessId);
  if (ctx.primaryModule === moduleKey) {
    const { moveSubscriptionToFree } = await import('@/lib/subscription/lifecycle');
    await moveSubscriptionToFree(businessId, fromPlanId, eventType);
  }

  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);
}
