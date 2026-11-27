/**
 * Admin edits of a plan's features, limits and prices.
 *
 * The admin chooses, on every save that changes something, who gets it:
 *  - `everyone`       the change applies to the live plan and to every older-terms snapshot of the plan, so
 *                     businesses pinned to older terms get it too;
 *  - `new_customers`  the plan's terms as they are now are copied to one snapshot, every business on the plan that
 *                     is not already pinned is pinned to it, and then the live plan changes. Pinned businesses keep
 *                     their features, limits and renewal price while they stay on the plan (lib/subscription/plan-terms.ts).
 *
 * The admin must also confirm the number of businesses on the plan, and every change is written to
 * platform_admin_logs with before and after values and the choice made.
 */

import type { PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import {
  PLAN_TERMS_STATUSES,
  applyFeatureChangeToSnapshots,
  applyLimitChangeToSnapshots,
  applyPriceChangeToSnapshots,
  countBusinessesOnOlderTerms,
  isPlanChangeScope,
  pinBusinessesToTerms,
  snapshotPlanTerms,
  type PlanChangeScope,
} from '@/lib/subscription/plan-terms';

export type { PlanChangeScope } from '@/lib/subscription/plan-terms';

/** Statuses in which the plan's entitlements apply to a business today. */
const PLAN_APPLIES_STATUSES: string[] = [...PLAN_TERMS_STATUSES];

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
  | { ok: true; affected: number; changed: boolean; scope: PlanChangeScope; pinned: number; termsId: string | null }
  | { ok: false; reason: 'confirmation_required'; affected: number }
  | { ok: false; reason: 'scope_required'; affected: number }
  | { ok: false; reason: 'invalid_scope' }
  | { ok: false; reason: 'invalid_price'; message: string };

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

class PriceValidationError extends Error {}

/** What one kind of edit does, worked out inside the transaction before anything is written. */
type PlannedEdit = {
  changed: boolean;
  /** Writes the change to the live plan. Always runs (a save that changes nothing rewrites the same values, as before). */
  apply: () => Promise<void>;
  /** Carries the change into every older-terms snapshot of the plan ("apply to everyone now"). */
  applyToSnapshots: () => Promise<void>;
  /** Logged with the scope when `changed`. */
  log: Record<string, unknown>;
};

async function runPlanEdit(params: {
  planId: string;
  adminId: string;
  scope: unknown;
  confirmAffectedCount: unknown;
  reason: 'features' | 'limits' | 'prices';
  action: string;
  plan: (client: PoolClient) => Promise<PlannedEdit>;
}): Promise<PlanEditResult> {
  const { planId, adminId } = params;
  // A scope that is present must be one of the two; a missing one is only allowed when nobody is on the plan.
  const scopeGiven = params.scope !== undefined && params.scope !== null;
  if (scopeGiven && !isPlanChangeScope(params.scope)) return { ok: false, reason: 'invalid_scope' };

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
    if (!scopeGiven && affected > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'scope_required', affected };
    }
    const scope: PlanChangeScope = scopeGiven ? (params.scope as PlanChangeScope) : 'everyone';

    const planned = await params.plan(client);

    let termsId: string | null = null;
    let pinned = 0;
    if (planned.changed && scope === 'new_customers') {
      // Anyone on the plan who is not yet on a snapshot is pinned to the terms as they are right now, before
      // the live plan changes. Businesses already pinned to an older snapshot stay on it.
      const unpinned = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM business_module_subscriptions
          WHERE plan_id = $1 AND plan_terms_id IS NULL AND status = ANY($2::text[])`,
        [planId, PLAN_APPLIES_STATUSES],
      );
      if ((unpinned.rows[0]?.n ?? 0) > 0) {
        termsId = await snapshotPlanTerms(client, planId, adminId, params.reason);
        pinned = await pinBusinessesToTerms(client, planId, termsId);
      }
    }

    await planned.apply();
    if (planned.changed && scope === 'everyone') await planned.applyToSnapshots();

    if (planned.changed) {
      await writeLog(client, adminId, params.action, planId, {
        scope,
        affected_businesses: affected,
        businesses_pinned: pinned,
        terms_id: termsId,
        ...planned.log,
      });
    }
    await client.query('COMMIT');
    return { ok: true, affected, changed: planned.changed, scope, pinned, termsId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof PriceValidationError) return { ok: false, reason: 'invalid_price', message: error.message };
    throw error;
  } finally {
    client.release();
  }
}

/** Replace the set of enabled features of a plan. `features` is { featureId: boolean }. */
export async function applyPlanFeatureEdit(params: {
  planId: string;
  adminId: string;
  features: Record<string, unknown>;
  confirmAffectedCount: unknown;
  scope?: unknown;
}): Promise<PlanEditResult> {
  const { planId, features } = params;
  return runPlanEdit({
    planId,
    adminId: params.adminId,
    scope: params.scope,
    confirmAffectedCount: params.confirmAffectedCount,
    reason: 'features',
    action: 'update_plan_features',
    plan: async (client) => {
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
      const added = after.filter((x) => !before.includes(x));
      const removed = before.filter((x) => !after.includes(x));

      return {
        changed: added.length > 0 || removed.length > 0,
        apply: async () => {
          await client.query('DELETE FROM subscription_plan_features WHERE plan_id = $1', [planId]);
          for (const id of after) {
            await client.query(
              `INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
               VALUES ($1, $2, true)
               ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true`,
              [planId, id],
            );
          }
        },
        applyToSnapshots: () => applyFeatureChangeToSnapshots(client, planId, added, removed),
        log: {
          before: { enabled_features: before },
          after: { enabled_features: after },
          added,
          removed,
        },
      };
    },
  });
}

/** Upsert the limit values sent for a plan. `limits` is { limitKey: number }. */
export async function applyPlanLimitEdit(params: {
  planId: string;
  adminId: string;
  limits: Record<string, unknown>;
  confirmAffectedCount: unknown;
  scope?: unknown;
}): Promise<PlanEditResult> {
  const { planId, limits } = params;
  return runPlanEdit({
    planId,
    adminId: params.adminId,
    scope: params.scope,
    confirmAffectedCount: params.confirmAffectedCount,
    reason: 'limits',
    action: 'update_plan_limits',
    plan: async (client) => {
      const before: Record<string, number> = {};
      const after: Record<string, number> = {};
      const writes: Array<[string, number]> = [];
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
        writes.push([limitKey, value]);
      }
      return {
        changed: Object.keys(after).length > 0,
        apply: async () => {
          for (const [limitKey, value] of writes) {
            await client.query(
              `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
               VALUES ($1, $2, $3)
               ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = $3`,
              [planId, limitKey, value],
            );
          }
        },
        applyToSnapshots: () => applyLimitChangeToSnapshots(client, planId, after),
        log: { before, after },
      };
    },
  });
}

// --------------------------------------------------------------------------------------------
// Prices
// --------------------------------------------------------------------------------------------

/** The cycle prices an admin can edit, with the column each one is stored in (rupees, numeric(10,2)). */
export const PRICE_KEYS = ['price_monthly', 'price_yearly', 'price_3year'] as const;
export type PriceKey = (typeof PRICE_KEYS)[number];

/** A price is whole paise: 0 (not sold / free) or at least 100 (Rs 1, the gateway minimum), at most Rs 1 crore. */
export const MIN_PAID_PRICE_PAISE = 100;
export const MAX_PRICE_PAISE = 1_000_000_000;

/** Checks the shape of an edit before any database work. Returns the edit in paise, or the problem. */
export function parsePriceEdit(
  raw: unknown,
): { ok: true; paise: Partial<Record<PriceKey, number>> } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'prices must be an object of amounts in paise.' };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, message: 'Send at least one price to change.' };
  const paise: Partial<Record<PriceKey, number>> = {};
  for (const [key, value] of entries) {
    if (!(PRICE_KEYS as readonly string[]).includes(key)) {
      return { ok: false, message: `Unknown price "${key}". Use price_monthly, price_yearly or price_3year.` };
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return { ok: false, message: `${key} must be a whole number of paise.` };
    }
    if (value < 0) return { ok: false, message: `${key} cannot be negative.` };
    if (value !== 0 && value < MIN_PAID_PRICE_PAISE) {
      return { ok: false, message: `${key} must be 0 or at least 100 paise (Rs 1).` };
    }
    if (value > MAX_PRICE_PAISE) return { ok: false, message: `${key} is too large.` };
    paise[key as PriceKey] = value;
  }
  return { ok: true, paise };
}

const toPaise = (rupees: unknown) => Math.round(Number(rupees ?? 0) * 100);
const toRupees = (paise: number) => paise / 100;

export async function loadPlanPricesPaise(planId: string): Promise<Record<PriceKey, number> | null> {
  const row = await queryOne<{ price_monthly: string; price_yearly: string; price_3year: string }>(
    `SELECT price_monthly::text, price_yearly::text, price_3year::text FROM subscription_plans WHERE id = $1`,
    [planId],
  );
  if (!row) return null;
  return {
    price_monthly: toPaise(row.price_monthly),
    price_yearly: toPaise(row.price_yearly),
    price_3year: toPaise(row.price_3year),
  };
}

/** Change the monthly, yearly and / or three-year price of a plan. `prices` is { price_monthly: paise, ... }. */
export async function applyPlanPriceEdit(params: {
  planId: string;
  adminId: string;
  prices: unknown;
  confirmAffectedCount: unknown;
  scope?: unknown;
}): Promise<PlanEditResult> {
  const { planId } = params;
  const parsed = parsePriceEdit(params.prices);
  if (!parsed.ok) return { ok: false, reason: 'invalid_price', message: parsed.message };
  const wanted = parsed.paise;

  return runPlanEdit({
    planId,
    adminId: params.adminId,
    scope: params.scope,
    confirmAffectedCount: params.confirmAffectedCount,
    reason: 'prices',
    action: 'update_plan_prices',
    plan: async (client) => {
      const cur = (
        await client.query(
          `SELECT price_monthly::text, price_yearly::text, price_3year::text FROM subscription_plans WHERE id = $1 FOR UPDATE`,
          [planId],
        )
      ).rows[0];
      if (!cur) throw new PriceValidationError('Plan not found');
      const current: Record<PriceKey, number> = {
        price_monthly: toPaise(cur.price_monthly),
        price_yearly: toPaise(cur.price_yearly),
        price_3year: toPaise(cur.price_3year),
      };
      const next: Record<PriceKey, number> = { ...current, ...wanted };
      // Monthly is the base every plan sells. A plan with a yearly or three-year price and no monthly price
      // would be bought for nothing as a monthly plan; only a plan with no price at all is a free plan.
      if (next.price_monthly === 0 && (next.price_yearly > 0 || next.price_3year > 0)) {
        throw new PriceValidationError(
          'The monthly price cannot be 0 while the yearly or three-year price is set. Set a monthly price of at least Rs 1, or clear all prices for a free plan.',
        );
      }
      const before: Partial<Record<PriceKey, number>> = {};
      const after: Partial<Record<PriceKey, number>> = {};
      for (const key of PRICE_KEYS) {
        if (key in wanted && wanted[key] !== current[key]) {
          before[key] = current[key];
          after[key] = wanted[key];
        }
      }
      const changedKeys = Object.keys(after) as PriceKey[];
      return {
        changed: changedKeys.length > 0,
        apply: async () => {
          for (const key of changedKeys) {
            // Column names come from the fixed PRICE_KEYS list, never from the request.
            await client.query(`UPDATE subscription_plans SET ${key} = $2::numeric WHERE id = $1`, [
              planId,
              toRupees(after[key]!).toFixed(2),
            ]);
          }
        },
        applyToSnapshots: () =>
          applyPriceChangeToSnapshots(client, planId, {
            price_monthly: after.price_monthly === undefined ? null : toRupees(after.price_monthly),
            price_yearly: after.price_yearly === undefined ? null : toRupees(after.price_yearly),
            price_3year: after.price_3year === undefined ? null : toRupees(after.price_3year),
          }),
        log: { before, after },
      };
    },
  });
}

// --------------------------------------------------------------------------------------------
// Older terms
// --------------------------------------------------------------------------------------------

export type MoveToCurrentResult =
  | { ok: true; moved: number }
  | { ok: false; reason: 'confirmation_required'; onOlderTerms: number };

/**
 * Move every business that is on older terms of this plan to the plan's current terms (clears the pin).
 * The admin confirms the number; the move is logged. The snapshots stay as a record.
 */
export async function moveBusinessesToCurrentTerms(params: {
  planId: string;
  adminId: string;
  confirmOlderTermsCount: unknown;
}): Promise<MoveToCurrentResult> {
  const { planId, adminId } = params;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`plan_edit:${planId}`]);
    const onOlder = await countBusinessesOnOlderTerms(planId, client);
    if (!confirmationMatches(params.confirmOlderTermsCount, onOlder)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'confirmation_required', onOlderTerms: onOlder };
    }
    // Every pinned row of the plan moves (not only the active ones counted above): none may keep a pin the
    // admin was told is gone.
    const moved = await client.query(
      `UPDATE business_module_subscriptions SET plan_terms_id = NULL
        WHERE plan_id = $1 AND plan_terms_id IS NOT NULL`,
      [planId],
    );
    if ((moved.rowCount ?? 0) > 0) {
      await writeLog(client, adminId, 'move_plan_businesses_to_current_terms', planId, {
        moved_businesses: onOlder,
        moved_rows: moved.rowCount ?? 0,
      });
    }
    await client.query('COMMIT');
    return { ok: true, moved: onOlder };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------------------------------------
// Route helpers
// --------------------------------------------------------------------------------------------

/** The 409 the plan routes answer when the admin has not confirmed the current number of businesses. */
export function confirmationRequired(affected: number) {
  return NextResponse.json(
    {
      error: `This changes the plan for ${affected} ${affected === 1 ? 'business' : 'businesses'}. Confirm the number to save.`,
      code: 'CONFIRMATION_REQUIRED',
      affected_businesses: affected,
    },
    { status: 409 },
  );
}

/** The 409 answered when businesses are on the plan and the admin has not said who gets the change. */
export function scopeRequired(affected: number) {
  return NextResponse.json(
    {
      error: `Choose who gets this change: everyone now (${affected} ${affected === 1 ? 'business' : 'businesses'} get it today) or only new customers (the ${affected} on this plan keep what they have).`,
      code: 'SCOPE_REQUIRED',
      affected_businesses: affected,
    },
    { status: 409 },
  );
}

export function invalidScope() {
  return NextResponse.json(
    { error: 'scope must be "everyone" or "new_customers".', code: 'INVALID_SCOPE' },
    { status: 400 },
  );
}

export function invalidPrice(message: string) {
  return NextResponse.json({ error: message, code: 'INVALID_PRICE' }, { status: 400 });
}

/** Turns a failed edit into the route's response. */
export function planEditFailureResponse(result: Extract<PlanEditResult, { ok: false }>): NextResponse {
  switch (result.reason) {
    case 'confirmation_required':
      return confirmationRequired(result.affected);
    case 'scope_required':
      return scopeRequired(result.affected);
    case 'invalid_scope':
      return invalidScope();
    case 'invalid_price':
      return invalidPrice(result.message);
  }
}
