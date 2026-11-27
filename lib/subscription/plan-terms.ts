/**
 * Plan terms: what a business is entitled to on its plan, and what it pays to renew it.
 *
 * A plan's live terms are `subscription_plan_features`, `subscription_plan_limits` and the plan's prices.
 * When an admin saves a change with "Only new customers", the terms as they were are copied to one
 * `subscription_plan_terms` row and every business on the plan is pinned to it
 * (`business_module_subscriptions.plan_terms_id`). A pinned business reads its features, limits and
 * renewal price from that snapshot; every other business reads the live plan. A plan change clears the pin.
 *
 * This file is the one place that decides which terms apply. Readers build their query here and never
 * test the pin themselves.
 */

import type { PoolClient } from 'pg';
import * as db from '@/lib/db';

export type PlanChangeScope = 'everyone' | 'new_customers';

export const PLAN_CHANGE_SCOPES: readonly PlanChangeScope[] = ['everyone', 'new_customers'];

/** Statuses in which a plan's terms apply to a business today (same set the admin count uses). */
export const PLAN_TERMS_STATUSES = ['active', 'trial'] as const;

export function isPlanChangeScope(raw: unknown): raw is PlanChangeScope {
  return raw === 'everyone' || raw === 'new_customers';
}

// --------------------------------------------------------------------------------------------
// Read side
// --------------------------------------------------------------------------------------------

/**
 * The cap of one limit key for a plan, as `{ sql, params }`; the row has `limit_value` (null when the key has
 * no active registry row). Without a pin it is the live resolution (the plan's own row, else the platform
 * default). With a pin the snapshot's value wins; a key the snapshot does not hold falls through to the live
 * resolution. A pin that does not belong to `planId` is ignored.
 */
export function planLimitValueQuery(
  planId: string,
  limitKey: string,
  termsId?: string | null,
): { sql: string; params: unknown[] } {
  if (!termsId) {
    return {
      sql: `SELECT COALESCE(spl.limit_value, pl.default_value) AS limit_value
     FROM platform_limits pl
     LEFT JOIN subscription_plan_limits spl
       ON spl.limit_key = pl.limit_key AND spl.plan_id = $1
     WHERE pl.limit_key = $2 AND pl.is_active = true`,
      params: [planId, limitKey],
    };
  }
  return {
    sql: `SELECT COALESCE(
              CASE WHEN t.id IS NOT NULL AND t.limits ? pl.limit_key AND jsonb_typeof(t.limits -> pl.limit_key) = 'number'
                   THEN (t.limits ->> pl.limit_key)::int END,
              spl.limit_value, pl.default_value) AS limit_value
     FROM platform_limits pl
     LEFT JOIN subscription_plan_limits spl
       ON spl.limit_key = pl.limit_key AND spl.plan_id = $1
     LEFT JOIN subscription_plan_terms t ON t.id = $3::uuid AND t.plan_id = $1
     WHERE pl.limit_key = $2 AND pl.is_active = true`,
    params: [planId, limitKey, termsId],
  };
}

/** The enabled, active feature ids of a plan (rows have `id`), from the snapshot when pinned. */
export function planEnabledFeaturesQuery(
  planId: string,
  termsId?: string | null,
): { sql: string; params: unknown[] } {
  if (!termsId) {
    return {
      sql: `SELECT pf.id
     FROM subscription_plan_features spf
     JOIN platform_features pf ON pf.id = spf.feature_id
     WHERE spf.plan_id = $1
       AND spf.enabled = true
       AND pf.is_active = true`,
      params: [planId],
    };
  }
  return {
    sql: `SELECT pf.id
     FROM subscription_plan_terms t
     CROSS JOIN LATERAL jsonb_array_elements_text(t.features) AS f(feature_id)
     JOIN platform_features pf ON pf.id = f.feature_id
     WHERE t.id = $2::uuid AND t.plan_id = $1 AND pf.is_active = true`,
    params: [planId, termsId],
  };
}

/** Enabled features with their labels, for the Plan & billing screen (rows have id, label, category, description). */
export function planEnabledFeatureDetailQuery(
  planId: string,
  termsId?: string | null,
): { sql: string; params: unknown[] } {
  if (!termsId) {
    return {
      sql: `SELECT pf.id, pf.label, pf.category, pf.description
         FROM subscription_plan_features spf
         JOIN platform_features pf ON spf.feature_id = pf.id
         WHERE spf.plan_id = $1 AND spf.enabled = true AND pf.is_active = true
         ORDER BY pf.category, pf.sort_order`,
      params: [planId],
    };
  }
  return {
    sql: `SELECT pf.id, pf.label, pf.category, pf.description
         FROM subscription_plan_terms t
         CROSS JOIN LATERAL jsonb_array_elements_text(t.features) AS f(feature_id)
         JOIN platform_features pf ON pf.id = f.feature_id
         WHERE t.id = $2::uuid AND t.plan_id = $1 AND pf.is_active = true
         ORDER BY pf.category, pf.sort_order`,
    params: [planId, termsId],
  };
}

/**
 * The limit rows a plan shows (`limit_key`, `limit_value`): the plan's own rows, or for a pinned business the
 * snapshot's values laid over them (a key only the live plan has stays visible).
 */
export function planLimitRowsQuery(
  planId: string,
  termsId?: string | null,
): { sql: string; params: unknown[] } {
  if (!termsId) {
    return {
      sql: `SELECT limit_key, limit_value FROM subscription_plan_limits WHERE plan_id = $1`,
      params: [planId],
    };
  }
  return {
    sql: `SELECT m.limit_key, m.limit_value FROM (
            SELECT spl.limit_key, spl.limit_value, 1 AS pri
              FROM subscription_plan_limits spl WHERE spl.plan_id = $1
            UNION ALL
            SELECT e.key AS limit_key, (e.value)::int AS limit_value, 2 AS pri
              FROM subscription_plan_terms t
              CROSS JOIN LATERAL jsonb_each(t.limits) AS e(key, value)
             WHERE t.id = $2::uuid AND t.plan_id = $1 AND jsonb_typeof(e.value) = 'number'
          ) m
          ORDER BY m.pri`,
    params: [planId, termsId],
  };
}

/** The pin a business's entitlement reads: only while the entitlement plan is the stored plan (an expired trial reads Free). */
export function entitlementTermsId(
  row: { plan_id: string; plan_terms_id?: string | null },
  entitlementPlanId: string,
): string | null {
  return row.plan_terms_id && entitlementPlanId === row.plan_id ? row.plan_terms_id : null;
}

export type EffectivePlanPrices = {
  price_monthly: string;
  price_yearly: string;
  price_3year: string | null;
  is_active: boolean;
  /** The snapshot the prices came from, or null when they are the plan's live prices. */
  plan_terms_id: string | null;
};

type OneRow = <T extends Record<string, any>>(sql: string, params: unknown[]) => Promise<T | null>;

/**
 * The prices `businessId` pays for `planId`: its snapshot's when it is pinned on this very plan (a renewal),
 * otherwise the plan's live prices. Everything that prices a checkout for a business goes through this.
 */
export async function loadEffectivePlanPrices(
  businessId: string | null | undefined,
  planId: string,
  run: OneRow = (sql, params) => db.queryOne(sql, params),
): Promise<EffectivePlanPrices | null> {
  return run<EffectivePlanPrices>(
    `SELECT CASE WHEN t.id IS NULL THEN sp.price_monthly ELSE COALESCE(t.price_monthly, 0) END AS price_monthly,
            CASE WHEN t.id IS NULL THEN sp.price_yearly ELSE COALESCE(t.price_yearly, 0) END AS price_yearly,
            CASE WHEN t.id IS NULL THEN sp.price_3year ELSE COALESCE(t.price_3year, 0) END AS price_3year,
            sp.is_active,
            t.id::text AS plan_terms_id
       FROM subscription_plans sp
       LEFT JOIN business_module_subscriptions bms
         ON bms.business_id = $2::uuid AND bms.plan_id = sp.id AND bms.plan_terms_id IS NOT NULL
       LEFT JOIN subscription_plan_terms t ON t.id = bms.plan_terms_id AND t.plan_id = sp.id
      WHERE sp.id = $1`,
    [planId, businessId ?? null],
  );
}

// --------------------------------------------------------------------------------------------
// Write side (inside the admin edit's transaction)
// --------------------------------------------------------------------------------------------

/** Copy the plan's live terms as they are now into one snapshot row; returns its id. */
export async function snapshotPlanTerms(
  client: Pick<PoolClient, 'query'>,
  planId: string,
  adminId: string | null,
  reason: 'features' | 'limits' | 'prices',
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO subscription_plan_terms
       (plan_id, features, limits, price_monthly, price_yearly, price_3year, created_by, reason)
     SELECT sp.id,
            COALESCE((SELECT jsonb_agg(spf.feature_id ORDER BY spf.feature_id)
                        FROM subscription_plan_features spf
                       WHERE spf.plan_id = sp.id AND spf.enabled = true), '[]'::jsonb),
            COALESCE((SELECT jsonb_object_agg(pl.limit_key, COALESCE(spl.limit_value, pl.default_value))
                        FROM platform_limits pl
                        LEFT JOIN subscription_plan_limits spl
                          ON spl.limit_key = pl.limit_key AND spl.plan_id = sp.id
                       WHERE pl.is_active = true), '{}'::jsonb),
            sp.price_monthly, sp.price_yearly, sp.price_3year, $2, $3
       FROM subscription_plans sp
      WHERE sp.id = $1
     RETURNING id::text AS id`,
    [planId, adminId, reason],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('Plan not found');
  return id;
}

/** Pin every business on the plan (active or trial) that is not already pinned. Returns how many were pinned. */
export async function pinBusinessesToTerms(
  client: Pick<PoolClient, 'query'>,
  planId: string,
  termsId: string,
): Promise<number> {
  const r = await client.query(
    `UPDATE business_module_subscriptions
        SET plan_terms_id = $2
      WHERE plan_id = $1 AND plan_terms_id IS NULL AND status = ANY($3::text[])`,
    [planId, termsId, [...PLAN_TERMS_STATUSES]],
  );
  return r.rowCount ?? 0;
}

/** "Apply to everyone now": carry a feature change into every snapshot of the plan. */
export async function applyFeatureChangeToSnapshots(
  client: Pick<PoolClient, 'query'>,
  planId: string,
  added: string[],
  removed: string[],
): Promise<void> {
  if (!added.length && !removed.length) return;
  await client.query(
    `UPDATE subscription_plan_terms
        SET features = COALESCE((
              SELECT jsonb_agg(s.f ORDER BY s.f) FROM (
                SELECT f FROM jsonb_array_elements_text(subscription_plan_terms.features) AS e(f)
                 WHERE f <> ALL($2::text[])
                UNION
                SELECT x FROM unnest($3::text[]) AS u(x)
              ) s(f)), '[]'::jsonb)
      WHERE plan_id = $1`,
    [planId, removed, added],
  );
}

/** "Apply to everyone now": carry changed limit values (only the keys that changed) into every snapshot. */
export async function applyLimitChangeToSnapshots(
  client: Pick<PoolClient, 'query'>,
  planId: string,
  after: Record<string, number>,
): Promise<void> {
  if (!Object.keys(after).length) return;
  await client.query(
    `UPDATE subscription_plan_terms SET limits = limits || $2::jsonb WHERE plan_id = $1`,
    [planId, JSON.stringify(after)],
  );
}

/** "Apply to everyone now": carry changed cycle prices (rupees; null = unchanged) into every snapshot. */
export async function applyPriceChangeToSnapshots(
  client: Pick<PoolClient, 'query'>,
  planId: string,
  rupees: { price_monthly: number | null; price_yearly: number | null; price_3year: number | null },
): Promise<void> {
  await client.query(
    `UPDATE subscription_plan_terms
        SET price_monthly = COALESCE($2::numeric, price_monthly),
            price_yearly = COALESCE($3::numeric, price_yearly),
            price_3year = COALESCE($4::numeric, price_3year)
      WHERE plan_id = $1`,
    [planId, rupees.price_monthly, rupees.price_yearly, rupees.price_3year],
  );
}

/** Businesses on the plan (active or trial) that are on older terms. */
export async function countBusinessesOnOlderTerms(
  planId: string,
  client?: Pick<PoolClient, 'query'>,
): Promise<number> {
  const sql = `SELECT COUNT(DISTINCT business_id)::int AS n
                 FROM business_module_subscriptions
                WHERE plan_id = $1 AND plan_terms_id IS NOT NULL AND status = ANY($2::text[])`;
  const params = [planId, [...PLAN_TERMS_STATUSES]];
  if (client) return (await client.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;
  return (await db.queryOne<{ n: number }>(sql, params))?.n ?? 0;
}
