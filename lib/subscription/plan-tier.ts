/**
 * Tier order between plans. It comes from `sort_order` plus a fixed set of free-tier plans,
 * never from price, so any plan can be priced at ₹1 for live testing and keep its real tier.
 */

export type TierPlan = { id: string; sort_order: number };

/** Plans that are the bottom tier of their product whatever their sort_order. */
export const FREE_TIER_PLAN_IDS: ReadonlySet<string> = new Set([
  'free',
  'hr_free',
  'hr_staff_lite',
  'connect_free',
]);

/** 0 for a free-tier plan, otherwise sort_order + 1. Price is never read. */
export function planTierRank(plan: TierPlan): number {
  return FREE_TIER_PLAN_IDS.has(plan.id) ? 0 : plan.sort_order + 1;
}

/** -1 when a is the lower tier, 1 when higher, 0 when equal. */
export function comparePlanTier(a: TierPlan, b: TierPlan): -1 | 0 | 1 {
  const diff = planTierRank(a) - planTierRank(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}
