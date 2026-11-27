/**
 * Short-lived cache of "how many seats / branches does this business's plan allow" for the over-limit
 * checks that run on every request (lib/subscription/over-limit-access.ts). No imports, so
 * `clearSubscriptionCache` (called after every plan change) can drop it without a circular import.
 */
export const OVER_LIMIT_PLAN_TTL_MS = 10_000;

type Entry = { value: number | null; at: number };
const planAllowance = new Map<string, Entry>();

export function getCachedAllowance(businessId: string, kind: string): { hit: boolean; value: number | null } {
  const e = planAllowance.get(`${businessId}:${kind}`);
  if (e && Date.now() - e.at < OVER_LIMIT_PLAN_TTL_MS) return { hit: true, value: e.value };
  return { hit: false, value: null };
}

export function setCachedAllowance(businessId: string, kind: string, value: number | null): void {
  planAllowance.set(`${businessId}:${kind}`, { value, at: Date.now() });
}

export function clearOverLimitCache(businessId?: string): void {
  if (!businessId) {
    planAllowance.clear();
    return;
  }
  for (const key of planAllowance.keys()) {
    if (key.startsWith(`${businessId}:`)) planAllowance.delete(key);
  }
}
