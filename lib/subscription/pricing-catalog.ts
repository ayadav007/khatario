import * as db from '@/lib/db';
import { normalizeProductLine, type ProductLine } from '@/lib/product-lines';

/**
 * Public pricing data for the marketing site, read straight from the plan matrix:
 * a feature is listed under a plan only when `subscription_plan_features` has it enabled,
 * so turning it off in Admin → Plans removes it from the pricing section.
 * Wording, order and hidden rows come from the pricing columns (migration 385).
 */

export type PricingFeature = { id: string; category: string; label: string; rank: number };
export type PricingLimit = { key: string; one: string; many: string; rank: number };
export type PricingPlan = {
  id: string;
  name: string;
  description: string;
  productLine: ProductLine;
  priceMonthly: number;
  priceYearly: number;
  price3Year: number;
  badge: string | null;
  /** HR plan that comes with this Billing plan (subscription_plans.bundled_hr_plan_id). */
  bundledHrPlanId: string | null;
  /** Ids of enabled features that are shown on pricing, in no particular order. */
  features: string[];
  /** Values for shown limits only; -1 = unlimited. */
  limits: Record<string, number>;
};
export type PricingCatalog = { plans: PricingPlan[]; features: PricingFeature[]; limits: PricingLimit[] };

/** Trials, lapsed states and retired plans are never sold on the landing page. */
export const PRICING_HIDDEN_PLAN_IDS = new Set(['trial', 'hr_trial', 'hr_free', 'connect_free', 'professional', 'enterprise']);

const UNDEFINED_COLUMN = '42703';

function isUndefinedColumn(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNDEFINED_COLUMN;
}

async function loadFeatures(): Promise<PricingFeature[]> {
  try {
    const rows = await db.queryRows<{ id: string; category: string; label: string; rank: number }>(
      `SELECT id, category, COALESCE(NULLIF(TRIM(pricing_label), ''), label) AS label, pricing_rank AS rank
       FROM platform_features
       WHERE is_active = true AND show_on_pricing = true`,
    );
    return rows.map((r) => ({ ...r, rank: Number(r.rank) }));
  } catch (error) {
    if (!isUndefinedColumn(error)) throw error;
    const rows = await db.queryRows<{ id: string; category: string; label: string; sort_order: number }>(
      `SELECT id, category, label, sort_order FROM platform_features WHERE is_active = true`,
    );
    return rows.map((r) => ({ id: r.id, category: r.category, label: r.label, rank: 100 + Number(r.sort_order || 0) }));
  }
}

async function loadLimits(): Promise<PricingLimit[]> {
  try {
    const rows = await db.queryRows<{ key: string; label: string; one: string | null; many: string | null; rank: number }>(
      `SELECT limit_key AS key, label, pricing_label_one AS one, pricing_label_many AS many, pricing_rank AS rank
       FROM platform_limits
       WHERE is_active = true AND show_on_pricing = true`,
    );
    return rows.map((r) => ({
      key: r.key,
      one: r.one?.trim() || r.label,
      many: r.many?.trim() || r.one?.trim() || r.label,
      rank: Number(r.rank),
    }));
  } catch (error) {
    if (!isUndefinedColumn(error)) throw error;
    return [];
  }
}

async function loadPlans(): Promise<Array<Omit<PricingPlan, 'features' | 'limits'>>> {
  const select = (extra: string) => `
    SELECT id, display_name, description, product_line, price_monthly, price_yearly, price_3year, ${extra}
    FROM subscription_plans
    WHERE is_active = true
    ORDER BY sort_order ASC`;
  let rows: Array<Record<string, unknown>> | null = null;
  // Newest columns first: is_public / bundled_hr_plan_id (387), pricing_badge (385).
  for (const extra of [
    'pricing_badge AS badge, is_public, bundled_hr_plan_id',
    'pricing_badge AS badge, true AS is_public, NULL AS bundled_hr_plan_id',
    'NULL AS badge, true AS is_public, NULL AS bundled_hr_plan_id',
  ]) {
    try {
      rows = await db.queryRows(select(extra));
      break;
    } catch (error) {
      if (!isUndefinedColumn(error)) throw error;
    }
  }
  return (rows ?? [])
    .filter((r) => r.is_public !== false && !PRICING_HIDDEN_PLAN_IDS.has(String(r.id)))
    .map((r) => ({
      id: String(r.id),
      name: String(r.display_name ?? r.id),
      description: String(r.description ?? ''),
      productLine: normalizeProductLine(r.product_line as string | null | undefined),
      priceMonthly: Number(r.price_monthly) || 0,
      priceYearly: Number(r.price_yearly) || 0,
      price3Year: Number(r.price_3year) || 0,
      badge: typeof r.badge === 'string' && r.badge.trim() ? r.badge.trim() : null,
      bundledHrPlanId: typeof r.bundled_hr_plan_id === 'string' ? r.bundled_hr_plan_id : null,
    }));
}

export async function loadPricingCatalog(): Promise<PricingCatalog> {
  const [plans, features, limits] = await Promise.all([loadPlans(), loadFeatures(), loadLimits()]);
  if (plans.length === 0) return { plans: [], features, limits };

  const planIds = plans.map((p) => p.id);
  const [enabledRows, limitRows] = await Promise.all([
    db.queryRows<{ plan_id: string; feature_id: string }>(
      `SELECT plan_id, feature_id FROM subscription_plan_features WHERE enabled = true AND plan_id = ANY($1::text[])`,
      [planIds],
    ),
    db.queryRows<{ plan_id: string; limit_key: string; limit_value: number }>(
      `SELECT plan_id, limit_key, limit_value FROM subscription_plan_limits WHERE plan_id = ANY($1::text[])`,
      [planIds],
    ),
  ]);

  const shownFeatures = new Set(features.map((f) => f.id));
  const shownLimits = new Set(limits.map((l) => l.key));
  const featuresByPlan = new Map<string, string[]>();
  for (const row of enabledRows) {
    if (!shownFeatures.has(row.feature_id)) continue;
    const list = featuresByPlan.get(row.plan_id) ?? [];
    list.push(row.feature_id);
    featuresByPlan.set(row.plan_id, list);
  }
  const limitsByPlan = new Map<string, Record<string, number>>();
  for (const row of limitRows) {
    if (!shownLimits.has(row.limit_key)) continue;
    const map = limitsByPlan.get(row.plan_id) ?? {};
    map[row.limit_key] = Number(row.limit_value);
    limitsByPlan.set(row.plan_id, map);
  }

  return {
    plans: plans.map((p) => ({ ...p, features: featuresByPlan.get(p.id) ?? [], limits: limitsByPlan.get(p.id) ?? {} })),
    features: features.filter((f) => enabledRows.some((r) => r.feature_id === f.id)),
    limits,
  };
}
