/**
 * Which plans a business may be offered (the rules; pure, safe to import anywhere). One answer for the module card, the change-plan modal, the
 * upgrade picker and `GET /api/subscriptions/plans` (the phone reads it).
 *
 * The catalogue in the database is the truth: a plan is on sale when it is active and public
 * (`is_public`, migration 387), whatever it costs. A plan priced at ₹1 is listed and buyable.
 * Tier (upgrade or downgrade) is judged elsewhere, by `plan-tier.ts`, never by price.
 *
 * On top of "on sale", a business always sees the plan it is on now (shown as current). The current
 * plan can be selected only to renew it: it has a price, is not a trial and is still active, even
 * when it is no longer on sale (a customer on a retired plan may renew it).
 */
import { HR_STAFF_LITE_PLAN_ID } from '@/lib/product-lines';
import { BILLING_CYCLES, computePlanAmount } from '@/lib/subscription/apply-plan-change';
import { isTrialPlanId } from '@/lib/subscription/trial-plan';

export type OfferablePlan = {
  id: string;
  is_active?: boolean | null;
  is_public?: boolean | null;
  price_monthly?: number | string | null;
  price_yearly?: number | string | null;
  price_3year?: number | string | null;
};

/** What the business is on now, per product. `status` is the module subscription's status. */
export type CurrentPlanRef = { planId: string; status: string };

export type PlanOffer = {
  /** Active and public, and not a signup-only or included plan. */
  on_sale: boolean;
  /** The plan the business is on now. */
  current: boolean;
  /** The current plan can be bought again (renewal). Always false for a plan that is not current. */
  renewable: boolean;
  /** The customer may choose it now: on sale and not current, or current and renewable. */
  selectable: boolean;
};

/** Sentence used wherever a plan that is not on sale is refused. */
export const PLAN_NOT_ON_SALE_MESSAGE = 'This plan is no longer offered. Choose one of the current plans.';

/** Plans that exist for signup or come included with another product: never offered as a purchase. */
export function isSignupOrIncludedPlan(planId: string): boolean {
  return isTrialPlanId(planId) || planId === HR_STAFF_LITE_PLAN_ID;
}

export function planHasAnyPrice(plan: OfferablePlan): boolean {
  const prices = {
    price_monthly: plan.price_monthly ?? 0,
    price_yearly: plan.price_yearly ?? 0,
    price_3year: plan.price_3year ?? 0,
  };
  return BILLING_CYCLES.some((c) => computePlanAmount(prices, c) > 0);
}

/** Active and public (a missing `is_public`, as before migration 387, counts as public), not signup-only. */
export function isPlanOnSale(plan: OfferablePlan): boolean {
  return plan.is_active !== false && plan.is_public !== false && !isSignupOrIncludedPlan(plan.id);
}

/**
 * The offer for one plan, or null when it must not be listed at all (not on sale and not current).
 * Pure: the callers hand in the catalogue row and what the business is on.
 */
export function planOfferFor(
  plan: OfferablePlan,
  current: ReadonlyMap<string, CurrentPlanRef>,
  /** The module's own free plan, for each product whose current plan is paid or a trial (a downgrade target). */
  ownFreePlanIds: ReadonlySet<string> = new Set(),
): PlanOffer | null {
  const onSale = isPlanOnSale(plan);
  const here = current.get(plan.id);
  if (!here) {
    // The module's own free plan stays a valid downgrade target even when it is hidden.
    if (!onSale && plan.is_active !== false && ownFreePlanIds.has(plan.id)) {
      return { on_sale: false, current: false, renewable: false, selectable: true };
    }
    return onSale ? { on_sale: true, current: false, renewable: false, selectable: true } : null;
  }
  const renewable =
    plan.is_active !== false && planHasAnyPrice(plan) && here.status !== 'trial' && !isTrialPlanId(plan.id);
  return { on_sale: onSale, current: true, renewable, selectable: renewable };
}

/** Plans of the catalogue that this business may be shown, each with its `offer`. Catalogue order is kept. */
export function selectOfferedPlans<T extends OfferablePlan>(
  plans: readonly T[],
  current: ReadonlyMap<string, CurrentPlanRef>,
  ownFreePlanIds: ReadonlySet<string> = new Set(),
): Array<T & { offer: PlanOffer }> {
  const out: Array<T & { offer: PlanOffer }> = [];
  for (const plan of plans) {
    const offer = planOfferFor(plan, current, ownFreePlanIds);
    if (offer) out.push({ ...plan, offer });
  }
  return out;
}
