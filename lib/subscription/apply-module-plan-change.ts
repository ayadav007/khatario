import type { PoolClient, QueryResultRow } from 'pg';
import { queryOne } from '@/lib/db';
import { enableBusinessModule } from '@/lib/business-modules';
import { type PlatformModule } from '@/lib/platform-modules';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';
import {
  computeSubscriptionPeriodEnd,
  unusedTrialDays,
  type BillingCycle,
} from '@/lib/subscription/apply-plan-change';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { assertPlanMatchesModule } from '@/lib/subscription/plan-module';
import { ensureComplimentaryHrForBilling } from '@/lib/subscription/ensure-complimentary-hr';

export interface ApplyModulePlanChangeResult {
  business_id: string;
  module_key: PlatformModule;
  plan_id: string;
  status: string;
  start_date: string;
  end_date: string;
  billing_cycle: BillingCycle;
  /** Plan the module was on before this change (undefined when there was no row). */
  from_plan_id?: string;
  /** Unused trial days added to the new period. */
  trial_days_carried?: number;
}

export interface PlanChangeCommittedMeta {
  fromPlanId: string | undefined;
  paymentMethod: string;
  paymentReference: string | null;
  trialDaysCarried: number;
}

/**
 * Module switch and the Billing plan's bundled HR. These are part of the activation: with a
 * `client` they run inside the caller's transaction, so a failure rolls the whole payment back
 * and a redelivery repairs it instead of leaving a paid business with the product switched off.
 */
async function enableModuleForPlanChange(
  result: ApplyModulePlanChangeResult,
  client?: PoolClient,
): Promise<void> {
  await enableBusinessModule(result.business_id, result.module_key, 'upgrade', client);

  // HR follows the Billing plan's bundled HR plan (lib/subscription/hr-bundle.ts).
  if (result.module_key === 'billing') {
    await ensureComplimentaryHrForBilling(
      result.business_id,
      client ? (client as unknown as Parameters<typeof ensureComplimentaryHrForBilling>[1]) : undefined,
    );
  }
}

/**
 * Side effects of a plan change that must only run once the row is committed:
 * cache clearing and the `upgraded` event. (The module switch and bundled HR are applied by
 * `applyModuleSubscriptionPlanChange` itself, inside the transaction when it was given a client.)
 */
export async function afterPlanChangeCommitted(
  result: ApplyModulePlanChangeResult,
  meta: PlanChangeCommittedMeta,
): Promise<void> {
  clearSubscriptionCache(result.business_id);
  clearModuleSubscriptionCache(result.business_id);

  await logSubscriptionEvent(result.business_id, 'upgraded', {
    module_key: result.module_key,
    to_plan_id: result.plan_id,
    from_plan_id: meta.fromPlanId,
    billing_cycle: result.billing_cycle,
    payment_method: meta.paymentMethod,
    payment_reference: meta.paymentReference,
    trial_days_carried: meta.trialDaysCarried,
  });
}

/**
 * Activates a plan for one product module (Billing / HR / Connect).
 *
 * With `client`, the SELECT, the upsert, the module switch and the bundled HR run on that
 * connection (inside the caller's transaction) and the caller must call `afterPlanChangeCommitted`
 * after its COMMIT. Without `client`, the function runs on the pool and performs those steps itself.
 */
export async function applyModuleSubscriptionPlanChange(
  params: {
    businessId: string;
    moduleKey: PlatformModule;
    planId: string;
    billingCycle: BillingCycle;
    paymentMethod?: string;
    paymentReference?: string | null;
  },
  client?: PoolClient,
): Promise<ApplyModulePlanChangeResult> {
  await assertPlanMatchesModule(params.planId, params.moduleKey, client);

  const paymentMethod = params.paymentMethod ?? 'manual';
  const paymentReference = params.paymentReference?.trim() || null;

  const one = async <T extends QueryResultRow>(sql: string, values: unknown[]): Promise<T | null> =>
    client ? ((await client.query<T>(sql, values)).rows[0] ?? null) : queryOne<T>(sql, values);

  const existing = await one<{ plan_id: string; trial_end_date: string | null }>(
    `SELECT plan_id, trial_end_date::text FROM business_module_subscriptions
     WHERE business_id = $1 AND module_key = $2`,
    [params.businessId, params.moduleKey],
  );

  const trialDaysCarried = unusedTrialDays(existing);
  const startDate = new Date().toISOString().split('T')[0];
  const endDate = computeSubscriptionPeriodEnd(params.billingCycle, trialDaysCarried);

  const row = await one<ApplyModulePlanChangeResult>(
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
       grace_period_end = NULL,
       cancel_at_period_end = false,
       cancelled_at = NULL,
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

  const result: ApplyModulePlanChangeResult = {
    ...row,
    from_plan_id: existing?.plan_id,
    trial_days_carried: trialDaysCarried,
  };

  try {
    await enableModuleForPlanChange(result, client);
  } catch (err) {
    // Without a transaction the plan row is already written: make it visible before failing.
    if (!client) {
      clearSubscriptionCache(result.business_id);
      clearModuleSubscriptionCache(result.business_id);
    }
    throw err;
  }

  if (!client) {
    await afterPlanChangeCommitted(result, {
      fromPlanId: existing?.plan_id,
      paymentMethod,
      paymentReference,
      trialDaysCarried,
    });
  }

  return result;
}

export async function extendModuleSubscriptionForFreeMonths(
  businessId: string,
  moduleKey: PlatformModule,
  freeMonths: number,
  client?: PoolClient,
): Promise<void> {
  if (!Number.isFinite(freeMonths) || freeMonths <= 0) return;

  const sql = `UPDATE business_module_subscriptions
     SET end_date = (
       COALESCE(end_date::date, CURRENT_DATE) + make_interval(months => $3::int)
     )::date,
     updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`;
  const values = [businessId, moduleKey, Math.floor(freeMonths)];

  if (client) {
    // Inside the caller's transaction: the caller clears caches after COMMIT.
    await client.query(sql, values);
    return;
  }

  await queryOne(sql, values);

  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);
}
