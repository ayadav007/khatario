import { queryOne } from '@/lib/db';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import {
  getModuleSubscription,
  clearModuleSubscriptionCache,
} from '@/lib/subscription/module-subscriptions';
import { clearSubscriptionCache } from '@/lib/subscription';

/**
 * Keeps legacy business_subscriptions in sync when primary module changes
 * or primary module plan updates.
 */
export async function syncLegacySubscriptionFromPrimaryModule(
  businessId: string,
): Promise<void> {
  const ctx = await getBusinessPlatformContext(businessId);
  const sub = await getModuleSubscription(businessId, ctx.primaryModule, true);
  if (!sub) return;

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM business_subscriptions WHERE business_id = $1`,
    [businessId],
  );

  if (existing) {
    await queryOne(
      `UPDATE business_subscriptions
       SET plan_id = $2,
           status = $3,
           start_date = $4,
           end_date = $5,
           trial_end_date = $6,
           billing_cycle = COALESCE($7, billing_cycle),
           scheduled_plan_id = $8,
           grace_period_end = $9,
           cancel_at_period_end = COALESCE($10, false),
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1`,
      [
        businessId,
        sub.plan_id,
        sub.status,
        sub.start_date,
        sub.end_date,
        sub.trial_end_date,
        sub.billing_cycle ?? 'monthly',
        sub.scheduled_plan_id ?? null,
        sub.grace_period_end ?? null,
        sub.cancel_at_period_end ?? false,
      ],
    );
  } else {
    await queryOne(
      `INSERT INTO business_subscriptions (
         business_id, plan_id, status, start_date, end_date, trial_end_date,
         billing_cycle, scheduled_plan_id, grace_period_end, cancel_at_period_end
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        businessId,
        sub.plan_id,
        sub.status,
        sub.start_date,
        sub.end_date,
        sub.trial_end_date,
        sub.billing_cycle ?? 'monthly',
        sub.scheduled_plan_id ?? null,
        sub.grace_period_end ?? null,
        sub.cancel_at_period_end ?? false,
      ],
    );
  }

  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);
}
