import type { PoolClient, QueryResultRow } from 'pg';
import { getPool, queryOne } from '@/lib/db';
import { enableBusinessModule } from '@/lib/business-modules';
import { type PlatformModule } from '@/lib/platform-modules';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';
import { type BillingCycle } from '@/lib/subscription/apply-plan-change';
import {
  planHasPaidPrice,
  resolveNewPeriod,
  type CurrentPeriodRow,
  type PeriodKind,
} from '@/lib/subscription/period';
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
  /** How the period was decided: renewal (extends the current end), change, or fresh. */
  period_kind?: PeriodKind;
  /**
   * Renewal only: the old end date, where the days bought by this payment begin. The payment row
   * records its period from here. Absent for a change or a fresh plan (the period starts at start_date).
   */
  paidFrom?: string;
}

export interface PlanChangeCommittedMeta {
  fromPlanId: string | undefined;
  periodKind?: PeriodKind;
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
    period_kind: meta.periodKind,
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
  params: PlanChangeParams,
  client?: PoolClient,
): Promise<ApplyModulePlanChangeResult> {
  if (client) return applyOnClient(params, client);

  // No caller transaction: open one so the lock, the read and the write are atomic.
  const own = await getPool().connect();
  let result: ApplyModulePlanChangeResult;
  try {
    await own.query('BEGIN');
    result = await applyOnClient(params, own);
    await own.query('COMMIT');
  } catch (err) {
    await own.query('ROLLBACK').catch(() => undefined);
    clearSubscriptionCache(params.businessId);
    clearModuleSubscriptionCache(params.businessId);
    throw err;
  } finally {
    own.release();
  }
  await afterPlanChangeCommitted(result, {
    fromPlanId: result.from_plan_id,
    paymentMethod: params.paymentMethod ?? 'manual',
    paymentReference: params.paymentReference?.trim() || null,
    trialDaysCarried: result.trial_days_carried ?? 0,
    periodKind: result.period_kind,
  });
  return result;
}

type PlanChangeParams = {
  businessId: string;
  moduleKey: PlatformModule;
  planId: string;
  billingCycle: BillingCycle;
  paymentMethod?: string;
  paymentReference?: string | null;
};

/** Runs inside a transaction on `client`. Lock order: the caller's checkout row first, then this lock. */
async function applyOnClient(
  params: PlanChangeParams,
  client: PoolClient,
): Promise<ApplyModulePlanChangeResult> {
  await assertPlanMatchesModule(params.planId, params.moduleKey, client);

  // One plan change per (business, module) at a time: two payments completing together must each
  // read the end date the other wrote. The lock also covers the no-row case (nothing to FOR UPDATE).
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`module_plan_change:${params.businessId}:${params.moduleKey}`]);

  const one = async <T extends QueryResultRow>(sql: string, values: unknown[]): Promise<T | null> =>
    (await client.query<T>(sql, values)).rows[0] ?? null;

  const existing = await one<CurrentPeriodRow>(
    `SELECT plan_id, status, start_date::text, end_date::text, trial_end_date::text
     FROM business_module_subscriptions
     WHERE business_id = $1 AND module_key = $2
     FOR UPDATE`,
    [params.businessId, params.moduleKey],
  );

  const period = await resolveNewPeriod(
    {
      current: existing,
      targetPlanId: params.planId,
      billingCycle: params.billingCycle,
      currentPlanIsPaid: existing ? await planHasPaidPrice(existing.plan_id, client) : false,
    },
    client,
  );
  const { startDate, endDate, trialDaysCarried } = period;

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
    period_kind: period.kind,
    paidFrom: period.kind === 'renewal' ? (existing?.end_date ?? undefined) : undefined,
  };

  await enableModuleForPlanChange(result, client);
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
