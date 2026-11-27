/**
 * Admin edits of a plan's features and limits. A plan edit applies to every business on the plan
 * right away (there is no plan versioning), so the admin must confirm the number of businesses it
 * changes, and every change is written to platform_admin_logs with before and after values.
 */

import type { PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';

/** Statuses in which the plan's entitlements apply to a business today. */
const PLAN_APPLIES_STATUSES = ['active', 'trial'];

export async function countBusinessesOnPlan(planId: string): Promise<number> {
  const r = await queryOne<{ n: number }>(
    `SELECT COUNT(DISTINCT business_id)::int AS n
     FROM business_module_subscriptions
     WHERE plan_id = $1 AND status = ANY($2::text[])`,
    [planId, PLAN_APPLIES_STATUSES],
  );
  return r?.n ?? 0;
}

export type PlanEditResult =
  | { ok: true; affected: number; changed: boolean }
  | { ok: false; reason: 'confirmation_required'; affected: number };

/** True when the client's confirmation is the exact current count (a whole number, not a string). */
export function confirmationMatches(confirm: unknown, affected: number): boolean {
  return typeof confirm === 'number' && Number.isInteger(confirm) && confirm === affected;
}

async function writeLog(
  client: PoolClient,
  adminId: string,
  action: string,
  planId: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO platform_admin_logs (admin_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'subscription_plan', NULL, $3::jsonb)`,
    [adminId, action, JSON.stringify({ plan_id: planId, ...details })],
  );
}

/** Replace the set of enabled features of a plan. `features` is { featureId: boolean }. */
export async function applyPlanFeatureEdit(params: {
  planId: string;
  adminId: string;
  features: Record<string, unknown>;
  confirmAffectedCount: unknown;
}): Promise<PlanEditResult> {
  const { planId, adminId, features } = params;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Serialise edits of one plan so the confirmed count and the audit "before" are the values we change.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`plan_edit:${planId}`]);
    const counted = await client.query(
      `SELECT COUNT(DISTINCT business_id)::int AS n FROM business_module_subscriptions
       WHERE plan_id = $1 AND status = ANY($2::text[])`,
      [planId, PLAN_APPLIES_STATUSES],
    );
    const affected: number = counted.rows[0]?.n ?? 0;
    if (!confirmationMatches(params.confirmAffectedCount, affected)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'confirmation_required', affected };
    }

    const before = (
      await client.query(
        `SELECT feature_id AS id FROM subscription_plan_features WHERE plan_id = $1 AND enabled = true ORDER BY 1`,
        [planId],
      )
    ).rows.map((r) => r.id as string);

    const wanted = Object.entries(features).filter(([, v]) => v === true).map(([k]) => k);
    const valid = wanted.length
      ? (
          await client.query(
            `SELECT id FROM platform_features WHERE is_active = true AND id = ANY($1::text[])`,
            [wanted],
          )
        ).rows.map((r) => r.id as string)
      : [];
    const after = [...valid].sort();

    await client.query('DELETE FROM subscription_plan_features WHERE plan_id = $1', [planId]);
    for (const id of after) {
      await client.query(
        `INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true`,
        [planId, id],
      );
    }
    const added = after.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !after.includes(x));
    const changed = added.length > 0 || removed.length > 0;
    if (changed) {
      await writeLog(client, adminId, 'update_plan_features', planId, {
        affected_businesses: affected,
        before: { enabled_features: before },
        after: { enabled_features: after },
        added,
        removed,
      });
    }
    await client.query('COMMIT');
    return { ok: true, affected, changed };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Upsert the limit values sent for a plan. `limits` is { limitKey: number }. */
export async function applyPlanLimitEdit(params: {
  planId: string;
  adminId: string;
  limits: Record<string, unknown>;
  confirmAffectedCount: unknown;
}): Promise<PlanEditResult> {
  const { planId, adminId, limits } = params;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`plan_edit:${planId}`]);
    const counted = await client.query(
      `SELECT COUNT(DISTINCT business_id)::int AS n FROM business_module_subscriptions
       WHERE plan_id = $1 AND status = ANY($2::text[])`,
      [planId, PLAN_APPLIES_STATUSES],
    );
    const affected: number = counted.rows[0]?.n ?? 0;
    if (!confirmationMatches(params.confirmAffectedCount, affected)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'confirmation_required', affected };
    }

    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    for (const [limitKey, limitValue] of Object.entries(limits)) {
      const value = typeof limitValue === 'number' ? limitValue : parseInt(String(limitValue), 10);
      if (!Number.isFinite(value)) continue;
      const exists = await client.query(
        `SELECT default_value FROM platform_limits WHERE limit_key = $1 AND is_active = true`,
        [limitKey],
      );
      if (!exists.rows.length) continue;
      const prev = await client.query(
        `SELECT limit_value FROM subscription_plan_limits WHERE plan_id = $1 AND limit_key = $2`,
        [planId, limitKey],
      );
      // With no row of its own the plan uses the platform default; that is the "before" value.
      const prevValue = prev.rows.length ? Number(prev.rows[0].limit_value) : Number(exists.rows[0].default_value);
      if (prevValue !== value) {
        before[limitKey] = prevValue;
        after[limitKey] = value;
      }
      await client.query(
        `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = $3`,
        [planId, limitKey, value],
      );
    }
    const changed = Object.keys(after).length > 0;
    if (changed) {
      await writeLog(client, adminId, 'update_plan_limits', planId, {
        affected_businesses: affected,
        before,
        after,
      });
    }
    await client.query('COMMIT');
    return { ok: true, affected, changed };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** The 409 the plan routes answer when the admin has not confirmed the current number of businesses. */
export function confirmationRequired(affected: number) {
  return NextResponse.json(
    {
      error: `This changes the plan for ${affected} ${affected === 1 ? 'business' : 'businesses'} right away. Confirm the number to save.`,
      code: 'CONFIRMATION_REQUIRED',
      affected_businesses: affected,
    },
    { status: 409 },
  );
}
