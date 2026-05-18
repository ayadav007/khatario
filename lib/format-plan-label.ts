/**
 * Produce a short label like "Business plan" from `subscription_plans.display_name`.
 * Shared by DB helpers and client UI — no server-only imports.
 */
export function formatPlanLabel(displayName: string): string {
  const t = displayName.trim();
  if (!t) return 'this plan';
  if (/\bplan\b/i.test(t)) return t;
  return `${t} plan`;
}
