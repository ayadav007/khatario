import { z } from 'zod';
import { listActiveSubscriptionPlans } from '@/lib/subscription/list-plans';
import { normalizeProductLine } from '@/lib/product-lines';

export const RecommendInputSchema = z.object({
  product: z.enum(['billing', 'hr', 'whatsapp']).default('billing'),
  invoicesPerMonth: z.coerce.number().int().min(0).max(1_000_000).default(0),
  users: z.coerce.number().int().min(1).max(10_000).default(1),
  branches: z.coerce.number().int().min(1).max(1_000).default(1),
  employees: z.coerce.number().int().min(0).max(100_000).default(0),
  needs: z
    .array(z.enum(['gst_reports', 'online_store', 'accounting', 'multi_warehouse', 'payment_links', 'payroll', 'leave']))
    .max(10)
    .default([]),
});
export type RecommendInput = z.infer<typeof RecommendInputSchema>;

const NEED_FEATURES: Record<RecommendInput['needs'][number], { feature: string; label: string }> = {
  gst_reports: { feature: 'reports_gst', label: 'GST reports (GSTR-1, GSTR-3B)' },
  online_store: { feature: 'advanced_online_store', label: 'your own online store' },
  accounting: { feature: 'advanced_ledger', label: 'ledger accounting' },
  multi_warehouse: { feature: 'settings_multi_warehouse', label: 'multiple warehouses' },
  payment_links: { feature: 'integration_payment_gateway', label: 'online payment links' },
  payroll: { feature: 'hr_payroll', label: 'payroll' },
  leave: { feature: 'hr_leaves', label: 'leave management' },
};

export interface PlanRecommendation {
  planId: string;
  displayName: string;
  priceMonthly: number;
  priceYearly: number;
  reasons: string[];
  /** Needs no plan covers; the assistant should say so instead of over-promising. */
  unmet: string[];
  trialUrl: string;
}

type Plan = {
  id: string;
  display_name: string;
  price_monthly: string | number | null;
  price_yearly: string | number | null;
  product_line: string | null;
  sort_order: number;
  features: { limits?: Record<string, number>; features?: Record<string, boolean> };
};

function fits(limit: number | undefined, need: number): boolean {
  if (need <= 0) return true;
  if (limit == null || limit === -1) return true;
  return limit >= need;
}

function isPurchasable(plan: Plan): boolean {
  return !/trial/i.test(plan.id);
}

/** Cheapest live plan that meets the stated limits and features; plans come from the DB, never hard-coded. */
export function pickPlan(plans: Plan[], input: RecommendInput): PlanRecommendation | null {
  const line = input.product === 'whatsapp' ? 'connect' : input.product;
  const candidates = plans
    .filter((p) => normalizeProductLine(p.product_line) === line && isPurchasable(p))
    .sort((a, b) => Number(a.price_monthly ?? 0) - Number(b.price_monthly ?? 0) || a.sort_order - b.sort_order);
  if (!candidates.length) return null;

  const wanted = input.needs.map((n) => NEED_FEATURES[n]);
  const available = new Set(candidates.flatMap((p) => Object.keys(p.features.features ?? {}).filter((k) => p.features.features?.[k])));
  const unmet = wanted.filter((w) => !available.has(w.feature)).map((w) => w.label);
  const required = wanted.filter((w) => available.has(w.feature));

  const match =
    candidates.find((p) => {
      const l = p.features.limits ?? {};
      const f = p.features.features ?? {};
      return (
        fits(l.max_invoices_per_month, input.product === 'billing' ? input.invoicesPerMonth : 0) &&
        fits(l.max_users, input.users) &&
        fits(l.max_branches, input.product === 'billing' ? input.branches : 0) &&
        fits(l.max_employees, input.product === 'hr' ? input.employees : 0) &&
        required.every((w) => f[w.feature])
      );
    }) ?? candidates[candidates.length - 1];

  const l = match.features.limits ?? {};
  const reasons: string[] = [];
  const show = (v: number | undefined) => (v == null || v === -1 ? 'unlimited' : String(v));
  if (input.product === 'billing' && input.invoicesPerMonth > 0) reasons.push(`Covers about ${input.invoicesPerMonth} invoices a month (limit: ${show(l.max_invoices_per_month)}).`);
  if (input.users > 1) reasons.push(`Allows ${show(l.max_users)} team users; you need ${input.users}.`);
  if (input.product === 'billing' && input.branches > 1) reasons.push(`Supports ${show(l.max_branches)} branches; you have ${input.branches}.`);
  if (input.product === 'hr' && input.employees > 0) reasons.push(`Supports ${show(l.max_employees)} employees; you have ${input.employees}.`);
  for (const w of required) reasons.push(`Includes ${w.label}.`);
  if (!reasons.length) reasons.push('The simplest plan that fits what you told me.');

  return {
    planId: match.id,
    displayName: match.display_name,
    priceMonthly: Number(match.price_monthly ?? 0),
    priceYearly: Number(match.price_yearly ?? 0),
    reasons,
    unmet,
    trialUrl: `/signup?src=assistant&product=${input.product === 'whatsapp' ? 'connect' : input.product}`,
  };
}

export async function recommendPlan(input: RecommendInput): Promise<PlanRecommendation | null> {
  const plans = (await listActiveSubscriptionPlans()) as unknown as Plan[];
  return pickPlan(plans, input);
}
