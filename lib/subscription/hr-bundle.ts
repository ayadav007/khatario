import { HR_FREE_PLAN_ID, HR_STAFF_LITE_PLAN_ID } from '@/lib/product-lines';

/** Order of HR plans, lowest first. Plans not listed (e.g. hr_trial) are never replaced. */
const HR_PLAN_RANK: Record<string, number> = {
  [HR_FREE_PLAN_ID]: 0,
  [HR_STAFF_LITE_PLAN_ID]: 1,
  hr_starter: 2,
  hr_pro: 3,
};

export type BundledHrDecision = { action: 'keep' } | { action: 'set'; planId: string };

/**
 * What to do with a business's HR subscription given its Billing plan's bundled HR plan.
 * - HR that came from a bundle (module source "complimentary", or the old free tiers) follows the
 *   bundle; no bundle means HR Free.
 * - HR bought separately is kept unless the bundle is a better plan.
 * - Anything else (an HR trial, an unknown plan) is left alone.
 */
export function bundledHrDecision(input: {
  currentPlanId: string | null;
  currentSource: string | null;
  bundledPlanId: string | null;
}): BundledHrDecision {
  const { currentPlanId, currentSource, bundledPlanId } = input;
  const target = bundledPlanId ?? HR_FREE_PLAN_ID;

  if (!currentPlanId) return { action: 'set', planId: target };

  const currentRank = HR_PLAN_RANK[currentPlanId];
  if (currentRank === undefined) return { action: 'keep' };

  const fromBundle =
    currentSource === 'complimentary' || currentPlanId === HR_FREE_PLAN_ID || currentPlanId === HR_STAFF_LITE_PLAN_ID;

  if (fromBundle) {
    return currentPlanId === target ? { action: 'keep' } : { action: 'set', planId: target };
  }

  const bundleRank = bundledPlanId ? HR_PLAN_RANK[bundledPlanId] : undefined;
  if (bundledPlanId && bundleRank !== undefined && bundleRank > currentRank) {
    return { action: 'set', planId: bundledPlanId };
  }
  return { action: 'keep' };
}
