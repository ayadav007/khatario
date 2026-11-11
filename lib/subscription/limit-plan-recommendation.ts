import * as db from '@/lib/db';
import { formatPlanLabel } from '@/lib/format-plan-label';
import { LIMIT_KEY_BY_TYPE, type LimitCheckType } from '@/lib/subscription/limit-registry';
import { resolvePlanLimitValue } from '@/lib/subscription';
import { isPurchasableUpgradePlan } from '@/lib/subscription/trial-plan';
import { getLimitOwnerModule } from '@/lib/subscription/module-entitlements';
import { productLineForModule } from '@/lib/platform-modules';

export interface LimitPlanRecommendation {
  planId: string;
  planDisplayName: string;
  planLabel: string;
  priceMonthly: number;
  /** Resolved limit on the recommended plan (-1 = unlimited). */
  planLimit: number;
}

/**
 * Lowest paid plan (by sort_order) whose limit for `limitType` exceeds `currentCount`
 * or is unlimited (-1). Only plans of the product that owns the limit are considered,
 * so an employee limit offers HR plans and an estimate limit offers billing plans.
 */
export async function getLowestPlanForLimit(
  limitType: LimitCheckType,
  currentCount: number,
): Promise<LimitPlanRecommendation | null> {
  const limitKey = LIMIT_KEY_BY_TYPE[limitType];
  if (!limitKey) return null;
  const productLine = productLineForModule(getLimitOwnerModule(limitType) ?? 'billing');
  const minNeeded = Math.max(0, currentCount) + 1;

  type PlanRow = {
    id: string;
    display_name: string;
    price_monthly: string | number | null;
    sort_order: number | null;
    product_line: string | null;
  };
  const listPlans = (onlyPublic: boolean) =>
    db.queryRows<PlanRow>(
      `SELECT id, display_name, price_monthly, sort_order, product_line
       FROM subscription_plans
       WHERE is_active = true ${onlyPublic ? 'AND is_public = true' : ''}
       ORDER BY sort_order ASC NULLS LAST, price_monthly ASC NULLS LAST`,
    );
  // Only recommend plans that are still offered (is_public, migration 387).
  let plans: PlanRow[];
  try {
    plans = await listPlans(true);
  } catch (error) {
    if ((error as { code?: string })?.code !== '42703') throw error;
    plans = await listPlans(false);
  }

  for (const plan of plans) {
    if (!isPurchasableUpgradePlan(plan.id)) continue;
    if ((plan.product_line ?? 'billing') !== productLine) continue;

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
