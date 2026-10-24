/**
 * Which subscription statuses a platform admin may set for a plan (pure, safe for client code).
 * "expired" is never set by hand; the daily cron moves lapsed products to their free plan.
 */

import { isPurchasableUpgradePlan, isTrialPlanId } from '@/lib/subscription/trial-plan';

export type AdminSubscriptionStatus = 'active' | 'trial' | 'cancelled';

export function allowedAdminStatusesForPlan(planId: string): AdminSubscriptionStatus[] {
  if (isTrialPlanId(planId)) return ['trial'];
  if (isPurchasableUpgradePlan(planId)) return ['active', 'cancelled'];
  return ['active'];
}

export function isAllowedAdminStatus(planId: string, status: string): boolean {
  return (allowedAdminStatusesForPlan(planId) as string[]).includes(status);
}
