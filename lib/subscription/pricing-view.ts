import type { PricingCatalog, PricingFeature, PricingLimit, PricingPlan } from '@/lib/subscription/pricing-catalog';
import type { ProductLine } from '@/lib/product-lines';

/** Pure helpers that turn the pricing catalog into what the landing cards and table show. */

export type PricingCycle = 'monthly' | 'yearly' | 'three_year';

export const PRICING_CATEGORY_LABELS: Record<string, string> = {
  sales: 'Billing & GST',
  reports: 'Reports',
  integrations: 'WhatsApp & payments',
  inventory: 'Stock & barcodes',
  purchase: 'Purchases & expenses',
  accounting: 'Accounting',
  advanced: 'Growth tools',
  settings: 'Business & team',
  tools: 'Tools',
  hr: 'HR & attendance',
};
const CATEGORY_ORDER = Object.keys(PRICING_CATEGORY_LABELS);

export function plansForLine(catalog: PricingCatalog, line: ProductLine): PricingPlan[] {
  return catalog.plans.filter((p) => p.productLine === line);
}

const byRank = (a: { rank: number; label?: string }, b: { rank: number; label?: string }) =>
  a.rank - b.rank || (a.label ?? '').localeCompare(b.label ?? '');

/**
 * Card list for a plan: what it adds over the plan before it in the same product line, best-ranked first.
 * `previous` is set only when this plan really has every feature of the plan before it; otherwise
 * (and for the first plan) the card lists everything the plan includes.
 */
export function planCardFeatures(
  catalog: PricingCatalog,
  plans: PricingPlan[],
  index: number,
): { previous: PricingPlan | null; features: PricingFeature[] } {
  const plan = plans[index];
  const planSet = new Set(plan.features);
  const before = index > 0 ? plans[index - 1] : null;
  const previous = before && before.features.every((id) => planSet.has(id)) ? before : null;
  const prevSet = new Set(previous?.features ?? []);
  const featureById = new Map(catalog.features.map((f) => [f.id, f]));
  const features = plan.features
    .filter((id) => !prevSet.has(id))
    .map((id) => featureById.get(id))
    .filter((f): f is PricingFeature => !!f)
    .sort(byRank);
  return { previous, features };
}

/**
 * Line for a Billing card about the HR plan that comes with it (subscription_plans.bundled_hr_plan_id),
 * e.g. "HR Starter included · up to 50 employees". Null when the plan has no bundled HR.
 */
export function bundledHrNote(catalog: PricingCatalog, plan: PricingPlan): string | null {
  if (!plan.bundledHrPlanId) return null;
  const hr = catalog.plans.find((p) => p.id === plan.bundledHrPlanId);
  if (!hr) return null;
  const limit = catalog.limits.find((l) => l.key === 'max_employees');
  const staff = hr.limits.max_employees;
  if (!limit || staff === undefined || staff === 0) return `${hr.name} included`;
  return `${hr.name} included · ${staff === -1 ? `unlimited ${limit.many}` : `up to ${limitText(limit, staff)}`}`;
}

const WEB_ACCESS_FEATURE = 'web_access';

/** True for a plan without website access (the Free plan works only in the phone app). */
export function isPhoneOnlyPlan(catalog: PricingCatalog, plan: PricingPlan): boolean {
  return catalog.features.some((f) => f.id === WEB_ACCESS_FEATURE) && !plan.features.includes(WEB_ACCESS_FEATURE);
}

export function limitText(limit: PricingLimit, value: number): string {
  if (value === -1) return `Unlimited ${limit.many}`;
  return `${value.toLocaleString('en-IN')} ${value === 1 ? limit.one : limit.many}`;
}

/** Limit chips for a card: shown limits that are set and differ from the previous plan. */
export function planCardLimits(catalog: PricingCatalog, plan: PricingPlan, previous: PricingPlan | null): string[] {
  return [...catalog.limits]
    .sort(byRank)
    .filter((l) => {
      const v = plan.limits[l.key];
      if (v === undefined || v === 0) return false;
      return !previous || previous.limits[l.key] !== v;
    })
    .map((l) => limitText(l, plan.limits[l.key]));
}

export type ComparisonRow =
  | { kind: 'group'; label: string }
  | { kind: 'limit'; label: string; values: Array<number | null> }
  | { kind: 'feature'; label: string; included: boolean[] };

export function comparisonRows(catalog: PricingCatalog, plans: PricingPlan[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const limits = [...catalog.limits].sort(byRank).filter((l) => plans.some((p) => p.limits[l.key] !== undefined));
  if (limits.length) {
    rows.push({ kind: 'group', label: 'Limits' });
    for (const l of limits) {
      rows.push({
        kind: 'limit',
        label: l.many.charAt(0).toUpperCase() + l.many.slice(1),
        values: plans.map((p) => (p.limits[l.key] === undefined || p.limits[l.key] === 0 ? null : p.limits[l.key])),
      });
    }
  }
  const sets = plans.map((p) => new Set(p.features));
  const feats = catalog.features.filter((f) => sets.some((s) => s.has(f.id)));
  const position = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  const categories = Array.from(new Set(feats.map((f) => f.category))).sort((a, b) => position(a) - position(b));
  for (const c of categories) {
    rows.push({ kind: 'group', label: PRICING_CATEGORY_LABELS[c] ?? c });
    for (const f of feats.filter((x) => x.category === c).sort(byRank)) {
      rows.push({ kind: 'feature', label: f.label, included: sets.map((s) => s.has(f.id)) });
    }
  }
  return rows;
}

export type CycleOption = { id: PricingCycle; label: string; savePercent: number };

/** Monthly always; yearly / 3-year only when every paid plan in the line has that price. */
export function cycleOptions(plans: PricingPlan[]): CycleOption[] {
  const paid = plans.filter((p) => p.priceMonthly > 0);
  const save = (pick: (p: PricingPlan) => number, months: number) =>
    Math.max(0, ...paid.map((p) => (pick(p) > 0 ? Math.round((1 - pick(p) / (p.priceMonthly * months)) * 100) : 0)));
  const options: CycleOption[] = [{ id: 'monthly', label: 'Monthly', savePercent: 0 }];
  if (paid.length && paid.every((p) => p.priceYearly > 0)) {
    options.push({ id: 'yearly', label: 'Yearly', savePercent: save((p) => p.priceYearly, 12) });
  }
  if (paid.length && paid.every((p) => p.price3Year > 0)) {
    options.push({ id: 'three_year', label: '3 years', savePercent: save((p) => p.price3Year, 36) });
  }
  return options;
}

export function priceForCycle(plan: PricingPlan, cycle: PricingCycle): { perMonth: number; billed: number | null } {
  if (cycle === 'yearly' && plan.priceYearly > 0) return { perMonth: plan.priceYearly / 12, billed: plan.priceYearly };
  if (cycle === 'three_year' && plan.price3Year > 0) return { perMonth: plan.price3Year / 36, billed: plan.price3Year };
  return { perMonth: plan.priceMonthly, billed: null };
}
