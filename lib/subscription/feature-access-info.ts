import * as db from '../db';
import { formatPlanLabel } from '../format-plan-label';
import { resolveRegistryFeatureId } from './feature-access';

export interface FeatureAccessPlanRow {
  planId: string;
  /** Raw `subscription_plans.display_name` */
  displayName: string;
  /** e.g. "Business plan" — user-facing label */
  planLabel: string;
  priceMonthly: number;
  sortOrder: number;
}

export interface FeatureAccessInfo {
  /** Platform `platform_features.id` / `subscription_plan_features.feature_id` used for the query */
  registryFeatureId: string;
  /** Lowest tier (by `sort_order`, then price) that includes the feature; drives hero copy */
  planLabel: string | null;
  lowestPlan: FeatureAccessPlanRow | null;
  /** All non-trial plans that include this feature, tier order */
  allPlans: FeatureAccessPlanRow[];
}

/**
 * Reads the feature matrix (`subscription_plan_features` + `subscription_plans`).
 * Excludes the trial plan. Ordered by plan priority (`sort_order`, then monthly price).
 *
 * @param featureKey Canonical or legacy key (same resolution as {@link resolveRegistryFeatureId})
 */
export async function getFeatureAccessInfo(
  featureKey: string
): Promise<FeatureAccessInfo> {
  const registryFeatureId = resolveRegistryFeatureId(featureKey);

  const rows = await db.queryRows<{
    plan_id: string;
    display_name: string;
    price_monthly: string | number | null;
    sort_order: number | null;
  }>(
    `SELECT sp.id AS plan_id,
            sp.display_name,
            sp.price_monthly,
            sp.sort_order
     FROM subscription_plan_features spf
     INNER JOIN subscription_plans sp
       ON sp.id = spf.plan_id AND sp.is_active = true
     WHERE spf.feature_id = $1
       AND spf.enabled = true
       AND lower(sp.id) <> 'trial'
     ORDER BY sp.sort_order ASC NULLS LAST,
              (sp.price_monthly IS NULL) ASC,
              sp.price_monthly ASC NULLS LAST`,
    [registryFeatureId]
  );

  const allPlans: FeatureAccessPlanRow[] = rows.map((r) => ({
    planId: r.plan_id,
    displayName: r.display_name?.trim() || r.plan_id,
    planLabel: formatPlanLabel(r.display_name || r.plan_id),
    priceMonthly:
      typeof r.price_monthly === 'number'
        ? r.price_monthly
        : parseFloat(String(r.price_monthly ?? '0')) || 0,
    sortOrder: r.sort_order ?? 0,
  }));

  const lowestPlan = allPlans.length > 0 ? allPlans[0] : null;

  return {
    registryFeatureId,
    planLabel: lowestPlan ? lowestPlan.planLabel : null,
    lowestPlan,
    allPlans,
  };
}
