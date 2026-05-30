import * as db from '@/lib/db';
import { formatPlanLabel } from '@/lib/format-plan-label';
import { LIMIT_KEY_BY_TYPE, type LimitCheckType } from '@/lib/subscription/limit-registry';
import { resolvePlanLimitValue } from '@/lib/subscription';
import { isPurchasableUpgradePlan } from '@/lib/subscription/trial-plan';

export interface LimitPlanRecommendation {
  planId: string;
  planDisplayName: string;
  planLabel: string;
  priceMonthly: number;
  /** Resolved limit on the recommended plan (-1 = unlimited). */
  planLimit: number;
}

const PURCHASABLE_LIMIT_TYPES = new Set<LimitCheckType>([
  'invoices',
  'customers',
  'items',
  'users',
  'whatsapp',
]);

/**
 * Lowest paid plan (by sort_order) whose limit for `limitType` exceeds `currentCount`
 * or is unlimited (-1).
 */
export async function getLowestPlanForLimit(
  limitType: LimitCheckType,
  currentCount: number,
): Promise<LimitPlanRecommendation | null> {
  if (!PURCHASABLE_LIMIT_TYPES.has(limitType)) return null;

  const limitKey = LIMIT_KEY_BY_TYPE[limitType];
  const minNeeded = Math.max(0, currentCount) + 1;

  const plans = await db.queryRows<{
    id: string;
    display_name: string;
    price_monthly: string | number | null;
    sort_order: number | null;
  }>(
    `SELECT id, display_name, price_monthly, sort_order
     FROM subscription_plans
     WHERE is_active = true
     ORDER BY sort_order ASC NULLS LAST, price_monthly ASC NULLS LAST`,
  );

  for (const plan of plans) {
    if (!isPurchasableUpgradePlan(plan.id)) continue;

    const planLimit = await resolvePlanLimitValue(plan.id, limitKey);
    if (planLimit === null) continue;
    if (planLimit === -1 || planLimit >= minNeeded) {
      const displayName = plan.display_name?.trim() || plan.id;
      return {
        planId: plan.id,
        planDisplayName: displayName,
        planLabel: formatPlanLabel(displayName),
        priceMonthly:
          typeof plan.price_monthly === 'number'
            ? plan.price_monthly
            : parseFloat(String(plan.price_monthly ?? '0')) || 0,
        planLimit,
      };
    }
  }

  return null;
}
