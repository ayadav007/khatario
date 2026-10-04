import { isProductLineTrialPlanId } from '@/lib/product-lines';
import { parseLocalDateOnly, startOfLocalToday } from '@/lib/subscription/date-only';

export const BILLING_CYCLES = ['monthly', 'yearly', 'three_year'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Unknown or missing values fall back to monthly. */
export function normalizeBillingCycle(raw: unknown): BillingCycle {
  return raw === 'yearly' || raw === 'three_year' ? raw : 'monthly';
}

export type PlanPrices = {
  price_monthly: number | string;
  price_yearly: number | string;
  price_3year?: number | string | null;
};

export function computePlanAmount(plan: PlanPrices, billingCycle: BillingCycle): number {
  const raw =
    billingCycle === 'three_year'
      ? Number(plan.price_3year) || 0
      : billingCycle === 'yearly'
        ? Number(plan.price_yearly) || 0
        : Number(plan.price_monthly) || 0;
  return Math.round(raw * 100) / 100;
}

/** A cycle is offered only when the plan has a price for it (free plans: monthly only). */
export function isBillingCycleOffered(plan: PlanPrices, billingCycle: BillingCycle): boolean {
  if (billingCycle === 'monthly') return true;
  return computePlanAmount(plan, billingCycle) > 0;
}

export function billingCycleMonths(billingCycle: BillingCycle): number {
  return billingCycle === 'three_year' ? 36 : billingCycle === 'yearly' ? 12 : 1;
}

export function computeSubscriptionPeriodEnd(billingCycle: BillingCycle, bonusDays = 0): string {
  const start = new Date();
  if (billingCycle === 'three_year') {
    start.setFullYear(start.getFullYear() + 3);
  } else if (billingCycle === 'yearly') {
    start.setFullYear(start.getFullYear() + 1);
  } else {
    start.setMonth(start.getMonth() + 1);
  }
  if (bonusDays > 0) start.setDate(start.getDate() + bonusDays);
  return start.toISOString().split('T')[0];
}

/**
 * Trial days left after today when a business upgrades mid-trial. They are added to the
 * first paid period so paying early never shortens what the customer was promised.
 */
export function unusedTrialDays(sub: { plan_id?: string | null; trial_end_date?: string | null } | null): number {
  if (!sub || !isProductLineTrialPlanId(sub.plan_id)) return 0;
  const end = parseLocalDateOnly(sub.trial_end_date);
  if (!end) return 0;
  const days = Math.round((end.getTime() - startOfLocalToday().getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}
