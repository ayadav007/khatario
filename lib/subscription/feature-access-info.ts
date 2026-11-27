import * as db from '../db';
import { formatPlanLabel } from '../format-plan-label';
import { resolveRegistryFeatureId } from './feature-access';
import { planHasAnyPrice, isPlanOnSale } from './plan-offer-rules';
import { comparePlanTier, planTierRank, type TierPlan } from './plan-tier';

export interface FeatureAccessPlanRow {
  planId: string;
  /** Raw `subscription_plans.display_name` */
  displayName: string;
  /** e.g. "Business plan" — user-facing label */
  planLabel: string;
  priceMonthly: number;
  sortOrder: number;
  /** Tier order is `planTierRank` (sort_order and the free-tier set), never price. */
  productLine?: string;
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

type CatalogueRow = {
  plan_id: string;
  display_name: string;
  price_monthly: string | number | null;
  price_yearly?: string | number | null;
  price_3year?: string | number | null;
  sort_order: number | null;
  is_public?: boolean | null;
  product_line?: string | null;
};

export type UpgradePlanFilter = {
  /** Only plans on sale (active and public, not signup-only), and never one with no price. */
  onSaleOnly: true;
  /** Only plans of this product (`billing`, `hr`, `connect`). Null for a feature shared by products. */
  productLine?: string | null;
  /** The plans the business is on now: the answer must be a higher tier than the current plan of its product. */
  /** A current plan that is not on sale (a retired Classic plan) has no tier among the new plans: it is ignored. */
  current?: Array<TierPlan & { product_line?: string | null; on_sale?: boolean }>;
};

/**
 * The plans an upgrade prompt may name for a feature: on sale, with a price (a free plan is never the
 * answer), of the feature's product, and above the plan the business is on. Tier order, then price.
 * Pure.
 */
export function pickUpgradePlansForFeature(rows: readonly CatalogueRow[], filter: UpgradePlanFilter): CatalogueRow[] {
  return rows
    .filter((r) => {
      const plan = {
        id: r.plan_id,
        is_active: true,
        is_public: r.is_public,
        price_monthly: r.price_monthly,
        price_yearly: r.price_yearly,
        price_3year: r.price_3year,
      };
      if (!isPlanOnSale(plan) || !planHasAnyPrice(plan)) return false;
      const line = r.product_line ?? 'billing';
      if (filter.productLine && line !== filter.productLine) return false;
      const candidate = { id: r.plan_id, sort_order: r.sort_order ?? 0 };
      return !(filter.current ?? []).some(
        (c) => c.on_sale !== false && (c.product_line ?? 'billing') === line && comparePlanTier(candidate, c) <= 0,
      );
    })
    .sort(
      (a, b) =>
        planTierRank({ id: a.plan_id, sort_order: a.sort_order ?? 0 }) -
          planTierRank({ id: b.plan_id, sort_order: b.sort_order ?? 0 }) ||
        (Number(a.price_monthly) || 0) - (Number(b.price_monthly) || 0) ||
        a.plan_id.localeCompare(b.plan_id),
    );
}

/**
 * Reads the feature matrix (`subscription_plan_features` + `subscription_plans`).
 * Excludes the trial plan. Ordered by plan priority (`sort_order`, then monthly price).
 *
 * @param featureKey Canonical or legacy key (same resolution as {@link resolveRegistryFeatureId})
 */
export async function getFeatureAccessInfo(
  featureKey: string,
  /** With a filter the result is what an upgrade prompt may name; without, every active non-trial plan with the feature. */
  upgradeFilter?: UpgradePlanFilter,
): Promise<FeatureAccessInfo> {
  const registryFeatureId = resolveRegistryFeatureId(featureKey);

  const select = (publicCol: string) => `SELECT sp.id AS plan_id,
            sp.display_name,
            sp.price_monthly,
            sp.price_yearly,
            sp.price_3year,
            sp.sort_order,
            ${publicCol}
            sp.product_line
     FROM subscription_plan_features spf
     INNER JOIN subscription_plans sp
       ON sp.id = spf.plan_id AND sp.is_active = true
     WHERE spf.feature_id = $1
       AND spf.enabled = true
       AND lower(sp.id) <> 'trial'
     ORDER BY sp.sort_order ASC NULLS LAST,
              (sp.price_monthly IS NULL) ASC,
              sp.price_monthly ASC NULLS LAST`;
  let rows: CatalogueRow[];
  try {
    rows = await db.queryRows<CatalogueRow>(select('sp.is_public,'), [registryFeatureId]);
  } catch (error) {
    if ((error as { code?: string })?.code !== '42703') throw error;
    rows = await db.queryRows<CatalogueRow>(select('true AS is_public,'), [registryFeatureId]);
  }
  if (upgradeFilter) rows = pickUpgradePlansForFeature(rows, upgradeFilter);

  const allPlans: FeatureAccessPlanRow[] = rows.map((r) => ({
    planId: r.plan_id,
    displayName: r.display_name?.trim() || r.plan_id,
    planLabel: formatPlanLabel(r.display_name || r.plan_id),
    priceMonthly:
      typeof r.price_monthly === 'number'
        ? r.price_monthly
        : parseFloat(String(r.price_monthly ?? '0')) || 0,
    sortOrder: r.sort_order ?? 0,
    productLine: r.product_line ?? 'billing',
  }));

  const lowestPlan = allPlans.length > 0 ? allPlans[0] : null;

  return {
    registryFeatureId,
    planLabel: lowestPlan ? lowestPlan.planLabel : null,
    lowestPlan,
    allPlans,
  };
}
