import { queryOne } from '@/lib/db';
import { enableBusinessModule, getBusinessPlatformContext } from '@/lib/business-modules';
import { type PlatformModule } from '@/lib/platform-modules';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';
import {
  computeSubscriptionPeriodEnd,
  type BillingCycle,
} from '@/lib/subscription/apply-plan-change';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { assertPlanMatchesModule } from '@/lib/subscription/plan-module';
import { syncLegacySubscriptionFromPrimaryModule } from '@/lib/subscription/sync-legacy-subscription';

export interface ApplyModulePlanChangeResult {
  business_id: string;
  module_key: PlatformModule;
  plan_id: string;
  status: string;
  start_date: string;
  end_date: string;
  billing_cycle: BillingCycle;
}

async function syncLegacyRowIfPrimary(
  businessId: string,
  moduleKey: PlatformModule,
  planId: string,
  billingCycle: BillingCycle,
  startDate: string,
  endDate: string,
  paymentMethod: string,
  paymentReference: string | null,
): Promise<void> {
  const ctx = await getBusinessPlatformContext(businessId);
  if (ctx.primaryModule !== moduleKey) return;

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM business_subscriptions WHERE business_id = $1`,
    [businessId],
  );

  if (existing) {
    await queryOne(
      `UPDATE business_subscriptions
       SET plan_id = $1,
           status = 'active',
           start_date = $2,
           end_date = $3,
           billing_cycle = $4,
           payment_method = $5,
           payment_reference = $6,
           trial_end_date = NULL,
           scheduled_plan_id = NULL,
           cancel_at_period_end = false,
           cancelled_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $7`,
      [planId, startDate, endDate, billingCycle, paymentMethod, paymentReference, businessId],
    );
  } else {
    await queryOne(
      `INSERT INTO business_subscriptions (
         business_id, plan_id, status, start_date, end_date,
         billing_cycle, payment_method, payment_reference
       ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7)`,
      [businessId, planId, startDate, endDate, billingCycle, paymentMethod, paymentReference],
    );
  }
}

/**
 * Activates a plan for one product module (Billing / HR / Connect).
 */
export async function applyModuleSubscriptionPlanChange(params: {
  businessId: string;
  moduleKey: PlatformModule;
  planId: string;
  billingCycle: BillingCycle;
  paymentMethod?: string;
  paymentReference?: string | null;
}): Promise<ApplyModulePlanChangeResult> {
  await assertPlanMatchesModule(params.planId, params.moduleKey);

  const startDate = new Date().toISOString().split('T')[0];
  const endDate = computeSubscriptionPeriodEnd(params.billingCycle);
  const paymentMethod = params.paymentMethod ?? 'manual';
  const paymentReference = params.paymentReference?.trim() || null;

  const existing = await queryOne<{ plan_id: string }>(
    `SELECT plan_id FROM business_module_subscriptions
     WHERE business_id = $1 AND module_key = $2`,
    [params.businessId, params.moduleKey],
  );

  const row = await queryOne<ApplyModulePlanChangeResult>(
    `INSERT INTO business_module_subscriptions (
       business_id, module_key, plan_id, status, start_date, end_date,
       billing_cycle, trial_end_date, scheduled_plan_id
     ) VALUES ($1, $2, $3, 'active', $4, $5, $6, NULL, NULL)
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       status = 'active',
       start_date = EXCLUDED.start_date,
       end_date = EXCLUDED.end_date,
       billing_cycle = EXCLUDED.billing_cycle,
       trial_end_date = NULL,
       scheduled_plan_id = NULL,
       updated_at = CURRENT_TIMESTAMP
     RETURNING business_id, module_key, plan_id, status,
               start_date::text, end_date::text, billing_cycle`,
    [
      params.businessId,
      params.moduleKey,
      params.planId,
      startDate,
      endDate,
      params.billingCycle,
    ],
  );

  if (!row) {
    throw new Error('Failed to apply module subscription plan change');
  }

  await enableBusinessModule(params.businessId, params.moduleKey, 'upgrade');

  await syncLegacyRowIfPrimary(
    params.businessId,
    params.moduleKey,
    params.planId,
    params.billingCycle,
    startDate,
    endDate,
    paymentMethod,
    paymentReference,
  );

  clearSubscriptionCache(params.businessId);
  clearModuleSubscriptionCache(params.businessId);
  await syncLegacySubscriptionFromPrimaryModule(params.businessId);

  await logSubscriptionEvent(params.businessId, 'upgraded', {
    module_key: params.moduleKey,
    to_plan_id: params.planId,
    from_plan_id: existing?.plan_id,
    billing_cycle: params.billingCycle,
    payment_method: paymentMethod,
  });

  return row;
}

export async function extendModuleSubscriptionForFreeMonths(
  businessId: string,
  moduleKey: PlatformModule,
  freeMonths: number,
): Promise<void> {
  if (!Number.isFinite(freeMonths) || freeMonths <= 0) return;

  await queryOne(
    `UPDATE business_module_subscriptions
     SET end_date = (
       COALESCE(end_date::date, CURRENT_DATE) + make_interval(months => $3::int)
     )::date,
     updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, moduleKey, Math.floor(freeMonths)],
  );

  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);
}
