/**
 * Every Billing package (including Free) includes HR Lite.
 * Auto-enables the HR module + hr_staff_lite subscription without overwriting paid/trial HR.
 */

import type { query as dbQuery } from '@/lib/db';
import { query as defaultQuery, queryOne } from '@/lib/db';
import {
  HR_FREE_PLAN_ID,
  HR_STAFF_LITE_PLAN_ID,
} from '@/lib/product-lines';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';

type QueryClient = { query: typeof dbQuery };

/** HR plans that complimentary Lite may replace. Never overwrite trial/paid HR. */
const REPLACEABLE_HR_PLAN_IDS = new Set<string>([
  HR_FREE_PLAN_ID,
  HR_STAFF_LITE_PLAN_ID,
]);

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

/**
 * Ensure HR module + hr_staff_lite when Billing is enabled.
 * Safe to call repeatedly. No-op if Billing is off or HR is on a paid/trial plan.
 */
export async function ensureComplimentaryHrForBilling(
  businessId: string,
  client: QueryClient = { query: defaultQuery },
): Promise<{ attached: boolean; planId: string | null }> {
  if (!(await billingModuleEnabled(client, businessId))) {
    return { attached: false, planId: null };
  }

  await client.query(
    `INSERT INTO business_modules (business_id, module_key, enabled, source)
     VALUES ($1, 'hr', true, 'complimentary')
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       enabled = true,
       source = CASE
         WHEN business_modules.enabled = true
           AND business_modules.source IS DISTINCT FROM 'complimentary'
           THEN business_modules.source
         ELSE 'complimentary'
       END,
       enabled_at = CASE
         WHEN business_modules.enabled = true THEN business_modules.enabled_at
         ELSE CURRENT_TIMESTAMP
       END`,
    [businessId],
  );

  const existing = await client.query<{ plan_id: string }>(
    `SELECT plan_id FROM business_module_subscriptions
     WHERE business_id = $1 AND module_key = 'hr'`,
    [businessId],
  );
  const currentPlanId = existing.rows[0]?.plan_id ?? null;

  if (currentPlanId && !REPLACEABLE_HR_PLAN_IDS.has(currentPlanId)) {
    return { attached: false, planId: currentPlanId };
  }

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
       updated_at = CURRENT_TIMESTAMP
     WHERE business_module_subscriptions.plan_id = ANY($3::text[])`,
    [businessId, HR_STAFF_LITE_PLAN_ID, [...REPLACEABLE_HR_PLAN_IDS]],
  );

  const after = await client.query<{ plan_id: string }>(
    `SELECT plan_id FROM business_module_subscriptions
     WHERE business_id = $1 AND module_key = 'hr'`,
    [businessId],
  );
  const attachedPlan = after.rows[0]?.plan_id ?? null;
  const attached = attachedPlan === HR_STAFF_LITE_PLAN_ID;

  // Outside a signup transaction, clear caches so session/features refresh.
  if (client.query === defaultQuery) {
    clearSubscriptionCache(businessId);
    clearModuleSubscriptionCache(businessId);
  }

  return { attached, planId: attachedPlan };
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
