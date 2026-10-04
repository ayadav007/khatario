/**
 * Self-serve one-time trial extension (Option A).
 * No automatic grace after trial_end_date — user must extend or choose Free.
 */

import { query, queryOne } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import {
  addLocalDaysFromToday,
  isLocalCalendarBeforeToday,
  parseLocalDateOnly,
} from '@/lib/subscription/date-only';
import { logSubscriptionEvent, moveSubscriptionToFree } from '@/lib/subscription/lifecycle';
import { isProductLineTrialPlanId, TRIAL_EXTENSION_DAYS } from '@/lib/product-lines';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { type PlatformModule } from '@/lib/platform-modules';
import { getFreePlanIdForModule } from '@/lib/subscription/module-operational-check';

export { TRIAL_EXTENSION_DAYS };

export interface TrialExtensionFields {
  plan_id: string;
  trial_end_date?: string | null;
  trial_extension_granted?: boolean | null;
  trial_extension_declined_at?: string | null;
}

/** Trial calendar end date is in the past (local date). */
export function isTrialCalendarExpired(sub: TrialExtensionFields): boolean {
  if (!isProductLineTrialPlanId(sub.plan_id)) return false;
  const trialEnd = parseLocalDateOnly(sub.trial_end_date);
  if (!trialEnd) return false;
  return isLocalCalendarBeforeToday(trialEnd);
}

/**
 * Show the extend-or-free modal on login (Option A: any time after expiry until they decide).
 */
export function shouldOfferTrialExtension(sub: TrialExtensionFields): boolean {
  if (!isProductLineTrialPlanId(sub.plan_id)) return false;
  if (sub.trial_extension_granted) return false;
  if (sub.trial_extension_declined_at) return false;
  return isTrialCalendarExpired(sub);
}

/**
 * Cron / sync: downgrade stale trial rows (after the one-time extension also expired).
 */
export function shouldDowngradeStaleTrial(sub: TrialExtensionFields): boolean {
  if (!isProductLineTrialPlanId(sub.plan_id)) return false;
  if (sub.trial_extension_declined_at) return false;
  if (!isTrialCalendarExpired(sub)) return false;
  if (!sub.trial_extension_granted) return false;
  return true;
}

/** Trial-extension fields of the business's primary product subscription. */
export async function getTrialExtensionState(businessId: string) {
  const ctx = await getBusinessPlatformContext(businessId);
  return queryOne<{
    module_key: PlatformModule;
    plan_id: string;
    trial_end_date: string | null;
    trial_extension_granted: boolean;
    trial_extension_declined_at: string | null;
  }>(
    `SELECT module_key, plan_id, trial_end_date::text,
            COALESCE(trial_extension_granted, false) AS trial_extension_granted,
            trial_extension_declined_at::text
     FROM business_module_subscriptions
     WHERE business_id = $1
     ORDER BY (module_key = $2) DESC, module_key
     LIMIT 1`,
    [businessId, ctx.primaryModule],
  );
}

export async function grantSelfServeTrialExtension(businessId: string): Promise<string> {
  const sub = await getTrialExtensionState(businessId);
  if (!sub) throw new Error('No subscription found');
  if (!shouldOfferTrialExtension(sub)) {
    throw new Error('Trial extension is not available for this account');
  }

  const newTrialEnd = addLocalDaysFromToday(TRIAL_EXTENSION_DAYS);

  await query(
    `UPDATE business_module_subscriptions
     SET status = 'trial',
         trial_end_date = $3,
         trial_extension_granted = true,
         grace_period_end = NULL,
         end_date = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, sub.module_key, newTrialEnd],
  );

  await logSubscriptionEvent(businessId, 'trial_extension_granted', {
    module_key: sub.module_key,
    extension_days: TRIAL_EXTENSION_DAYS,
    trial_end_date: newTrialEnd,
  });

  clearSubscriptionCache(businessId);
  return newTrialEnd;
}

export async function declineSelfServeTrialExtension(businessId: string): Promise<void> {
  const sub = await getTrialExtensionState(businessId);
  if (!sub) throw new Error('No subscription found');
  if (!shouldOfferTrialExtension(sub)) {
    throw new Error('Trial extension offer is not active');
  }

  await query(
    `UPDATE business_module_subscriptions
     SET trial_extension_declined_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, sub.module_key],
  );

  await moveSubscriptionToFree(businessId, sub.plan_id, 'trial_extension_declined', sub.module_key);

  await logSubscriptionEvent(businessId, 'trial_extension_declined', {
    module_key: sub.module_key,
    from_plan_id: sub.plan_id,
    to_plan_id: getFreePlanIdForModule(sub.module_key),
  });
}
