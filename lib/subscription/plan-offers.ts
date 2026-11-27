/**
 * Which plans a business may be offered, read from the database. The rules are in `plan-offer-rules.ts`.
 */
import { queryRows } from '@/lib/db';
import { getDisplayPlanId } from '@/lib/subscription/effective-plan';
import { getModuleSubscriptions } from '@/lib/subscription/module-subscriptions';
import { listActiveSubscriptionPlans } from '@/lib/subscription/list-plans';
import { getFreePlanIdForModule } from '@/lib/subscription/module-operational-check';
import { isTrialPlanId } from '@/lib/subscription/trial-plan';
import {
  isPlanOnSale,
  planHasAnyPrice,
  selectOfferedPlans,
  type CurrentPlanRef,
  type OfferablePlan,
} from '@/lib/subscription/plan-offer-rules';

export * from '@/lib/subscription/plan-offer-rules';

/**
 * What the business is on now: the plan each of its products shows (an expired trial shows its Free
 * plan), keyed by plan id. `null` business (no session) means nothing is current.
 */
export async function currentPlansOfBusiness(businessId: string | null): Promise<Map<string, CurrentPlanRef>> {
  const map = new Map<string, CurrentPlanRef>();
  if (!businessId) return map;
  const rows = await getModuleSubscriptions(businessId, true);
  for (const row of rows) {
    const planId = getDisplayPlanId({
      plan_id: row.plan_id,
      status: row.status,
      trial_end_date: row.trial_end_date,
      end_date: row.end_date,
      grace_period_end: row.grace_period_end,
      cancel_at_period_end: row.cancel_at_period_end,
      scheduled_plan_id: row.scheduled_plan_id,
      db_today: row.db_today,
    });
    map.set(planId, { planId, status: row.status });
  }
  return map;
}

/**
 * The module's own free plan (the one the downgrade route accepts as a target, from
 * `getFreePlanIdForModule`) for each product whose current plan is paid or a trial.
 */
async function ownFreePlansOf(
  businessId: string | null,
  catalogue: ReadonlyArray<OfferablePlan>,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!businessId) return out;
  const priced = new Map(catalogue.map((p) => [p.id, p]));
  for (const row of await getModuleSubscriptions(businessId, true)) {
    const plan = priced.get(row.plan_id);
    const paidOrTrial = row.status === 'trial' || isTrialPlanId(row.plan_id) || (!!plan && planHasAnyPrice(plan));
    if (paidOrTrial) out.add(getFreePlanIdForModule(row.module_key));
  }
  return out;
}

/** The plans this business may be offered, with each plan's `offer`. `productLine` narrows to one product. */
export async function listPlansOfferedTo(
  businessId: string | null,
  options: { productLine?: string | null } = {},
) {
  const [all, current] = await Promise.all([
    listActiveSubscriptionPlans({ includeInactive: true }),
    currentPlansOfBusiness(businessId),
  ]);
  const wanted = options.productLine ?? null;
  const catalogue = all as Array<(typeof all)[number] & OfferablePlan & { product_line?: string | null }>;
  const inLine = catalogue.filter((p) => !wanted || String(p.product_line ?? 'billing') === wanted);
  return selectOfferedPlans(inLine, current, await ownFreePlansOf(businessId, catalogue));
}

/**
 * The plans the business is on now, with their tier data, for the product (`productLine`) or for every
 * product when it is null. A prompt that names a plan to buy must name one above these.
 */
export async function currentTierPlans(
  businessId: string | null,
  productLine: string | null,
): Promise<Array<{ id: string; sort_order: number; product_line: string; on_sale: boolean }>> {
  if (!businessId) return [];
  const rows = await queryRows<{ id: string; sort_order: number | null; product_line: string | null; status: string; is_active: boolean; is_public: boolean | null }>(
    `SELECT sp.id, sp.sort_order, sp.product_line, sp.is_active, sp.is_public, bms.status
       FROM business_module_subscriptions bms
       JOIN subscription_plans sp ON sp.id = bms.plan_id
      WHERE bms.business_id = $1`,
    [businessId],
  );
  return rows
    .filter((r) => !productLine || (r.product_line ?? 'billing') === productLine)
    .filter((r) => r.status !== 'trial')
    .map((r) => ({ id: r.id, sort_order: r.sort_order ?? 0, product_line: r.product_line ?? 'billing', on_sale: isPlanOnSale(r) }));
}
