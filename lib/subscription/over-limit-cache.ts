/**
 * Short-lived cache of each business's over-limit state (plan allowance and whether enforcement has started) for
 * the checks that run on every request (lib/subscription/over-limit-access.ts). No imports, so
 * `clearSubscriptionCache` (called after every plan change) can drop it without a circular import.
 */
export const OVER_LIMIT_PLAN_TTL_MS = 10_000;

export type OverLimitState = {
  /** false when the plan could not be resolved: nobody is paused and nothing is set or cleared. */
  known: boolean;
  /** Seats / active branches the plan allows; null = no restriction. */
  allowed: number | null;
  /** true once the 7-day warning has run out. */
  enforce: boolean;
  /** ISO time enforcement starts (set while over the limit), else null. */
  enforceAt: string | null;
};

type Entry = { value: OverLimitState; at: number };
const states = new Map<string, Entry>();

export function getCachedState(businessId: string, kind: string): OverLimitState | null {
  const e = states.get(`${businessId}:${kind}`);
  if (e && Date.now() - e.at < OVER_LIMIT_PLAN_TTL_MS) return e.value;
  return null;
}

export function setCachedState(businessId: string, kind: string, value: OverLimitState): void {
  states.set(`${businessId}:${kind}`, { value, at: Date.now() });
}

export function clearOverLimitCache(businessId?: string): void {
  if (!businessId) {
    states.clear();
    return;
  }
  for (const key of states.keys()) {
    if (key.startsWith(`${businessId}:`)) states.delete(key);
  }
}
