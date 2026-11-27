/**
 * Resolves what plan the UI and product should treat as "current"
 * when DB rows are inconsistent (e.g. plan_id trial + status active + past end_date).
 */

import {
  isLocalCalendarOnOrBeforeToday,
  parseLocalDateOnly,
  startOfLocalToday,
} from '@/lib/subscription/date-only';
import {
  HR_FREE_PLAN_ID,
  HR_TRIAL_PLAN_ID,
  isProductLineTrialPlanId,
} from '@/lib/product-lines';

export interface SubscriptionForEffectivePlan {
  plan_id: string;
  status: string;
  trial_end_date?: string | null;
  end_date?: string | null;
  grace_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  scheduled_plan_id?: string | null;
  /**
   * The database's CURRENT_DATE as `YYYY-MM-DD`, selected with the row by every loader. It is the clock for
   * grace and expiry so this check and the nightly SQL job always agree on the day. Only rows that did not
   * come from the database (tests, mocks) leave it out; they fall back to the process's local date.
   */
  db_today?: string | null;
}

/** Days a paid customer keeps access after `end_date` before moving to the Free plan. */
export const GRACE_DAYS = 7;

function getExpiredTrialFallbackPlanId(planId: string): string {
  if (planId === HR_TRIAL_PLAN_ID) return HR_FREE_PLAN_ID;
  return 'free';
}

/** True while trial calendar is still active (no automatic post-expiry grace). */
export function isTrialEntitlementActive(sub: SubscriptionForEffectivePlan): boolean {
  if (!isProductLineTrialPlanId(sub.plan_id)) return false;

  const trialEnd = parseLocalDateOnly(sub.trial_end_date);
  if (!trialEnd) return sub.status === 'trial';

  return isLocalCalendarOnOrBeforeToday(trialEnd);
}

/**
 * Plan id used for badges, labels, and "what plan am I on?" copy.
 * Calendar-expired trials map to the product-line free plan until the user extends via the modal.
 */
export function getDisplayPlanId(sub: SubscriptionForEffectivePlan): string {
  if (sub.plan_id === 'free' || sub.plan_id === HR_FREE_PLAN_ID) return sub.plan_id;
  if (isProductLineTrialPlanId(sub.plan_id) && !isTrialEntitlementActive(sub)) {
    return getExpiredTrialFallbackPlanId(sub.plan_id);
  }
  return sub.plan_id;
}

/**
 * @deprecated Prefer {@link getDisplayPlanId} for UI and {@link getEntitlementPlanId} for limits.
 */
export function getEffectivePlanId(sub: SubscriptionForEffectivePlan): string {
  return getDisplayPlanId(sub);
}

/** Plan id used for limits and feature enforcement. */
export function getEntitlementPlanId(sub: SubscriptionForEffectivePlan): string {
  if (sub.plan_id === 'free' || sub.plan_id === HR_FREE_PLAN_ID) return sub.plan_id;
  if (isProductLineTrialPlanId(sub.plan_id) && !isTrialEntitlementActive(sub)) {
    return getExpiredTrialFallbackPlanId(sub.plan_id);
  }
  return sub.plan_id;
}

export function shouldShowTrialBadge(sub: SubscriptionForEffectivePlan): boolean {
  return isProductLineTrialPlanId(sub.plan_id) && isTrialEntitlementActive(sub);
}

/** @deprecated Use {@link shouldDowngradeStaleTrial} from trial-extension.ts for trial rows. */
export function shouldMoveStaleTrialToFree(sub: SubscriptionForEffectivePlan): boolean {
  if (!isProductLineTrialPlanId(sub.plan_id)) return false;
  return !isTrialEntitlementActive(sub);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The day used for grace decisions: an explicit `today`, else the row's `db_today`, else the local date. */
function resolveTodayYmd(sub: SubscriptionForEffectivePlan, today?: string | Date | null): string {
  const given = today instanceof Date ? toYmd(today) : today;
  const chosen = given || sub.db_today;
  const parsed = chosen ? parseLocalDateOnly(chosen) : null;
  return toYmd(parsed ?? startOfLocalToday());
}

/**
 * The last day of paid grace for this row, or null when it has none.
 *
 * A stamped `grace_period_end` wins. With no stamp, an active paid row that is not cancelled and has no
 * scheduled downgrade is in grace until `end_date` + {@link GRACE_DAYS}, so grace counts from the end
 * date whether or not the nightly job has run yet. Trials and Free rows (no end date) have none; the
 * nightly job skips trial plan ids too. The job stamps the same date (`end_date + 7`) in lifecycle.ts.
 */
export function getPaidGraceEndDate(sub: SubscriptionForEffectivePlan): Date | null {
  if (sub.status === 'active' && isProductLineTrialPlanId(sub.plan_id)) return null;
  const stamped = parseLocalDateOnly(sub.grace_period_end);
  if (stamped) return stamped;

  if (sub.status !== 'active') return null;
  if (sub.cancel_at_period_end) return null;
  if (sub.scheduled_plan_id) return null;
  const end = parseLocalDateOnly(sub.end_date);
  if (!end) return null;
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() + GRACE_DAYS);
}

/**
 * Paid-plan grace (lapsed renewal) — not used for signup trials.
 * `today` (YYYY-MM-DD) overrides the row's `db_today`.
 */
export function isPaidGracePeriodActive(
  sub: SubscriptionForEffectivePlan,
  today?: string | Date | null,
): boolean {
  const graceEnd = getPaidGraceEndDate(sub);
  if (!graceEnd) return false;
  return resolveTodayYmd(sub, today) <= toYmd(graceEnd);
}

export interface SubscriptionUsability {
  /** May the business use the product on this row right now? */
  operational: boolean;
  /** True only while the row is usable because it is inside the paid grace period. */
  graceActive: boolean;
  /** Last day of grace when `graceActive`. */
  graceEnd: Date | null;
  /** Whole days from today to the last grace day (0 on the last day) when `graceActive`. */
  graceDaysRemaining: number | null;
}

/**
 * The one answer to "is this subscription usable now?". Entitlement checks, the current-subscription
 * routes and the nightly job's expiry all follow it.
 */
export function getSubscriptionUsability(
  sub: SubscriptionForEffectivePlan,
  today?: string | Date | null,
): SubscriptionUsability {
  const no: SubscriptionUsability = { operational: false, graceActive: false, graceEnd: null, graceDaysRemaining: null };
  if (sub.status !== 'active' && sub.status !== 'trial') return no;

  const todayYmd = resolveTodayYmd(sub, today);
  const end = sub.end_date ? parseLocalDateOnly(sub.end_date) : null;
  const endPassed = !!end && toYmd(end) < todayYmd;

  if (sub.cancel_at_period_end && endPassed) return no;

  if (sub.status === 'active' && endPassed) {
    const graceEnd = getPaidGraceEndDate(sub);
    if (!graceEnd || todayYmd > toYmd(graceEnd)) return no;
    const t = parseLocalDateOnly(todayYmd)!;
    return {
      operational: true,
      graceActive: true,
      graceEnd,
      graceDaysRemaining: Math.round((graceEnd.getTime() - t.getTime()) / (1000 * 60 * 60 * 24)),
    };
  }
  return { operational: true, graceActive: false, graceEnd: null, graceDaysRemaining: null };
}

export function isSubscriptionUsable(sub: SubscriptionForEffectivePlan, today?: string | Date | null): boolean {
  return getSubscriptionUsability(sub, today).operational;
}
