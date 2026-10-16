/**
 * HR that comes with the Billing plan (subscription_plans.bundled_hr_plan_id):
 * Starter → HR Lite, Growth → HR Starter, Business → HR Pro, Free → none.
 * Keeps the business's HR subscription in line with its Billing plan without taking away
 * HR the business bought separately (a better bundle still upgrades it) or an HR trial.
 */

import type { query as dbQuery } from '@/lib/db';
import { query as defaultQuery, queryOne } from '@/lib/db';
import {
  HR_FREE_PLAN_ID,
  HR_STAFF_LITE_PLAN_ID,
} from '@/lib/product-lines';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { bundledHrDecision } from '@/lib/subscription/hr-bundle';

type QueryClient = { query: typeof dbQuery };

const UNDEFINED_COLUMN = '42703';

async function billingModuleEnabled(
  client: QueryClient,
  businessId: string,
): Promise<boolean> {
  const row = await client.query<{ enabled: boolean }>(
    `SELECT enabled FROM business_modules
     WHERE business_id = $1 AND module_key = 'billing'`,
    [businessId],
  );
  return row.rows[0]?.enabled === true;
}

/** HR plan bundled with the business's current Billing plan, or null for none. */
async function bundledHrPlanForBusiness(client: QueryClient, businessId: string): Promise<string | null> {
  const billing = await client.query<{ plan_id: string }>(
    `SELECT plan_id FROM business_module_subscriptions
     WHERE business_id = $1 AND module_key = 'billing'`,
    [businessId],
  );
  const billingPlanId = billing.rows[0]?.plan_id;
  if (!billingPlanId) return null;
  try {
    const row = await client.query<{ hr_plan: string | null }>(
      `SELECT hr.id AS hr_plan
       FROM subscription_plans sp
       LEFT JOIN subscription_plans hr ON hr.id = sp.bundled_hr_plan_id AND hr.is_active = true
       WHERE sp.id = $1`,
      [billingPlanId],
    );
    return row.rows[0]?.hr_plan ?? null;
  } catch (error) {
    // Before migration 387 every Billing plan came with HR Lite.
    if ((error as { code?: string })?.code === UNDEFINED_COLUMN) return HR_STAFF_LITE_PLAN_ID;
    throw error;
  }
}

/**
 * Bring the HR module in line with the Billing plan's bundled HR.
 * Safe to call repeatedly (signup, plan change, expiry, missing-row repair).
 */
export async function ensureComplimentaryHrForBilling(
  businessId: string,
  client: QueryClient = { query: defaultQuery },
): Promise<{ attached: boolean; planId: string | null }> {
  if (!(await billingModuleEnabled(client, businessId))) {
    return { attached: false, planId: null };
  }

  const bundledPlanId = await bundledHrPlanForBusiness(client, businessId);

  const current = await client.query<{ plan_id: string; source: string | null }>(
    `SELECT s.plan_id, m.source
     FROM business_module_subscriptions s
     LEFT JOIN business_modules m ON m.business_id = s.business_id AND m.module_key = 'hr'
     WHERE s.business_id = $1 AND s.module_key = 'hr'`,
    [businessId],
  );
  const currentPlanId = current.rows[0]?.plan_id ?? null;
  const decision = bundledHrDecision({
    currentPlanId,
    currentSource: current.rows[0]?.source ?? null,
    bundledPlanId,
  });

  if (decision.action === 'keep') {
    return { attached: false, planId: currentPlanId };
  }

  const targetPlanId = decision.planId;
  const hasHr = targetPlanId !== HR_FREE_PLAN_ID;

  await client.query(
    `INSERT INTO business_modules (business_id, module_key, enabled, source)
     VALUES ($1, 'hr', $2, 'complimentary')
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       source = 'complimentary',
       enabled_at = CASE
         WHEN business_modules.enabled = true THEN business_modules.enabled_at
         ELSE CURRENT_TIMESTAMP
       END`,
    [businessId, hasHr],
  );

  await client.query(
    `INSERT INTO business_module_subscriptions (
       business_id, module_key, plan_id, status, start_date, trial_end_date, end_date
     ) VALUES ($1, 'hr', $2, 'active', CURRENT_DATE, NULL, NULL)
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       status = 'active',
       trial_end_date = NULL,
       end_date = NULL,
       grace_period_end = NULL,
       cancel_at_period_end = false,
       cancelled_at = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [businessId, targetPlanId],
  );

  // Outside a signup transaction, clear caches so session/features refresh.
  if (client.query === defaultQuery) {
    clearSubscriptionCache(businessId);
    clearModuleSubscriptionCache(businessId);
  }

  return { attached: hasHr, planId: targetPlanId };
}

/** Read current HR plan for a business (optional helper for UI). */
export async function getHrModulePlanId(businessId: string): Promise<string | null> {
  const row = await queryOne<{ plan_id: string }>(
    `SELECT plan_id FROM business_module_subscriptions
     WHERE business_id = $1 AND module_key = 'hr'`,
    [businessId],
  );
  return row?.plan_id ?? null;
}
