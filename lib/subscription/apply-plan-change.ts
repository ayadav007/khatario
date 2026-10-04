import { isProductLineTrialPlanId } from '@/lib/product-lines';
import { parseLocalDateOnly, startOfLocalToday } from '@/lib/subscription/date-only';

export type BillingCycle = 'monthly' | 'yearly';

export function computePlanAmount(
  plan: { price_monthly: number | string; price_yearly: number | string },
  billingCycle: BillingCycle,
): number {
  const raw =
    billingCycle === 'yearly'
      ? Number(plan.price_yearly) || 0
      : Number(plan.price_monthly) || 0;
  return Math.round(raw * 100) / 100;
}

export function computeSubscriptionPeriodEnd(billingCycle: BillingCycle, bonusDays = 0): string {
  const start = new Date();
  if (billingCycle === 'yearly') {
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
