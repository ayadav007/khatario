import * as db from '@/lib/db';

/**
 * A plan can be bought when it is public (subscription_plans.is_public, migration 387),
 * or when the business is already on it (renewing a "Classic" plan kept for existing customers).
 */
export async function planOpenToBusiness(businessId: string, planId: string): Promise<boolean> {
  let isPublic = true;
  try {
    const row = await db.queryOne<{ is_public: boolean }>(`SELECT is_public FROM subscription_plans WHERE id = $1`, [planId]);
    isPublic = row?.is_public !== false;
  } catch (error) {
    if ((error as { code?: string })?.code !== '42703') throw error;
  }
  if (isPublic) return true;

  const current = await db.queryOne<{ ok: boolean }>(
    `SELECT true AS ok FROM business_module_subscriptions WHERE business_id = $1 AND plan_id = $2`,
    [businessId, planId],
  );
  return !!current?.ok;
}
