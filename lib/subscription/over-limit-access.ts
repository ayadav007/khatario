/**
 * Users and branches over the plan limit after a downgrade or lapse (SUB-24).
 *
 * Nothing is deleted. Who is paused is decided at REQUEST TIME from the current plan and the owner's stored
 * choice, so an upgrade restores access at once and no nightly job or plan-change hook has to run:
 *
 *  - Seats: the plan's seat allowance is the same `users` limit the user-create check uses (`max_users`,
 *    resolved by `resolveBusinessLimit`), and the people who hold a seat are exactly those counted by
 *    CONSOLE_SEAT_COUNT_SQL (lib/subscription/seat-counting.ts). When more people hold a seat than the plan
 *    allows, the ones beyond it are paused. Order that keeps access: the owner (primary admin, never paused),
 *    then people the owner chose (`users.over_limit_keep`), then the longest-standing (created_at).
 *  - Branches: when more active branches exist than `max_branches`, those beyond it are read-only (view
 *    works; creating or changing records under that branch is refused). Order: the default branch (never
 *    read-only), then the owner's choice (`branches.over_limit_keep`), then the oldest.
 *
 * Cost per request: the plan allowance is cached for 10 s and dropped by `clearSubscriptionCache` (every plan
 * change calls it), and an unlimited plan or a business with no limit answers from the cache alone. A limited
 * plan costs one indexed query on `users (business_id)` (or `branches (business_id)`), a handful of rows.
 * Failure policy: if the allowance or the list cannot be read the person is NOT paused (logged); this is an
 * access reconciliation, not the authorization boundary, and a read failure must not lock a whole team out.
 * Businesses with no resolvable plan (no active subscription, limit not defined) are not paused either; the
 * create-time limit checks still refuse new records there.
 */

import type { PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { LIMIT_KEY_BY_TYPE } from '@/lib/subscription/limit-registry';
import { resolveBusinessLimit } from '@/lib/subscription/resolve-limit';
import { CONSOLE_SEAT_USERS_SQL } from '@/lib/subscription/seat-counting';
import { getCachedAllowance, setCachedAllowance } from '@/lib/subscription/over-limit-cache';

export const SEAT_PAUSED_MESSAGE =
  "Your business's plan has fewer user seats than users. Ask the owner to choose who keeps access, or upgrade.";

export const BRANCH_READ_ONLY_MESSAGE =
  "This branch is over your plan's branch limit, so it is read-only: you can view its records but cannot add or change any. Ask the owner to choose which branches stay active, or upgrade.";

export class BranchReadOnlyError extends Error {
  readonly code = 'BRANCH_READ_ONLY';
  constructor(public readonly branchId: string) {
    super(BRANCH_READ_ONLY_MESSAGE);
    this.name = 'BranchReadOnlyError';
  }
}

export class OverLimitChoiceError extends Error {
  constructor(
    public readonly code: 'TOO_MANY' | 'NOT_FOUND' | 'NOT_OWNER',
    message: string,
  ) {
    super(message);
    this.name = 'OverLimitChoiceError';
  }
}

type Kind = 'users' | 'branches';

/**
 * How many seats / active branches the plan allows. null = no restriction applies (unlimited, or the plan
 * cannot be resolved). Cached briefly; errors are not cached and read as "no restriction".
 */
export async function planAllowance(businessId: string, kind: Kind): Promise<number | null> {
  const cached = getCachedAllowance(businessId, kind);
  if (cached.hit) return cached.value;
  try {
    const resolved = await resolveBusinessLimit(businessId, kind, LIMIT_KEY_BY_TYPE[kind]);
    let value: number | null;
    if (resolved.maxLimit === -1) value = null;
    else if (resolved.blockedReason || !resolved.fromRegistry) value = null;
    else value = Math.max(0, resolved.maxLimit);
    setCachedAllowance(businessId, kind, value);
    return value;
  } catch (error) {
    console.error(`[over-limit] could not resolve the ${kind} allowance for ${businessId}:`, error);
    return null;
  }
}

type Queryable = Pick<PoolClient, 'query'>;
const poolQuery: Queryable = { query: ((sql: string, params?: unknown[]) => db.getPool().query(sql, params)) as PoolClient['query'] };

// ---------------------------------------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------------------------------------

export type SeatHolder = { id: string; isPrimaryAdmin: boolean; keep: boolean; createdAt: string | null };
export type SeatAccess = { allowed: number | null; holders: SeatHolder[]; pausedIds: Set<string> };

/** Pure: given the seat holders in keep-order and the allowance, who is paused. The owner is never paused. */
export function pausedSeatIds(holders: SeatHolder[], allowed: number | null): Set<string> {
  const paused = new Set<string>();
  if (allowed === null) return paused;
  holders.forEach((h, index) => {
    if (index >= allowed && !h.isPrimaryAdmin) paused.add(h.id);
  });
  return paused;
}

export async function loadSeatHolders(businessId: string, q: Queryable = poolQuery): Promise<SeatHolder[]> {
  const res = await q.query(CONSOLE_SEAT_USERS_SQL, [businessId]);
  return res.rows.map((r: { id: string; is_primary_admin: boolean; over_limit_keep: boolean; created_at: Date | string | null }) => ({
    id: r.id,
    isPrimaryAdmin: r.is_primary_admin === true,
    keep: r.over_limit_keep === true,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));
}

export async function computeSeatAccess(businessId: string, q: Queryable = poolQuery): Promise<SeatAccess> {
  const allowed = await planAllowance(businessId, 'users');
  const holders = await loadSeatHolders(businessId, q);
  return { allowed, holders, pausedIds: pausedSeatIds(holders, allowed) };
}

/** True when this user holds a seat beyond the plan's allowance. Never true for the owner; false on any read failure. */
export async function isUserSeatPaused(userId: string, businessId: string | null | undefined): Promise<boolean> {
  if (!businessId) return false;
  try {
    const allowed = await planAllowance(businessId, 'users');
    if (allowed === null) return false; // unlimited or unknown: no query at all
    const holders = await loadSeatHolders(businessId);
    return pausedSeatIds(holders, allowed).has(userId);
  } catch (error) {
    console.error('[over-limit] seat check failed, not pausing:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------------------------------------

export type BranchRow = { id: string; name: string; isDefault: boolean; keep: boolean; createdAt: string | null };
export type BranchAccess = { allowed: number | null; branches: BranchRow[]; readOnlyIds: Set<string> };

export function readOnlyBranchIds(branches: BranchRow[], allowed: number | null): Set<string> {
  const ro = new Set<string>();
  if (allowed === null) return ro;
  branches.forEach((b, index) => {
    if (index >= allowed && !b.isDefault) ro.add(b.id);
  });
  return ro;
}

export async function loadActiveBranches(businessId: string, q: Queryable = poolQuery): Promise<BranchRow[]> {
  const res = await q.query(
    `SELECT id, name, COALESCE(is_default, false) AS is_default, COALESCE(over_limit_keep, false) AS over_limit_keep, created_at
       FROM branches
      WHERE business_id = $1 AND (is_active IS NULL OR is_active = true)
      ORDER BY COALESCE(is_default, false) DESC, COALESCE(over_limit_keep, false) DESC, created_at ASC NULLS LAST, id ASC`,
    [businessId],
  );
  return res.rows.map((r: { id: string; name: string; is_default: boolean; over_limit_keep: boolean; created_at: Date | string | null }) => ({
    id: r.id,
    name: r.name,
    isDefault: r.is_default === true,
    keep: r.over_limit_keep === true,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));
}

export async function computeBranchAccess(businessId: string, q: Queryable = poolQuery): Promise<BranchAccess> {
  const allowed = await planAllowance(businessId, 'branches');
  const branches = await loadActiveBranches(businessId, q);
  return { allowed, branches, readOnlyIds: readOnlyBranchIds(branches, allowed) };
}

/** True when the branch is active but beyond the plan's branch limit. False on any read failure. */
export async function isBranchReadOnly(businessId: string, branchId: string): Promise<boolean> {
  try {
    const allowed = await planAllowance(businessId, 'branches');
    if (allowed === null) return false;
    const branches = await loadActiveBranches(businessId);
    return readOnlyBranchIds(branches, allowed).has(branchId);
  } catch (error) {
    console.error('[over-limit] branch check failed, treating as writable:', error);
    return false;
  }
}

/** The shared write guard: throws BranchReadOnlyError for a record under a read-only branch. */
export async function assertBranchWritable(businessId: string, branchId: string | null | undefined): Promise<void> {
  if (!branchId) return;
  if (await isBranchReadOnly(businessId, branchId)) throw new BranchReadOnlyError(branchId);
}

// ---------------------------------------------------------------------------------------------------------
// Owner's choice
// ---------------------------------------------------------------------------------------------------------

export type OverLimitChoice = { keepUserIds?: string[]; keepBranchIds?: string[] };

/**
 * Save which users keep a seat and which branches stay writable. Owner only (checked here against the
 * session user), business from the session. The count is validated against the plan inside one transaction
 * that holds the same advisory locks as limited creates, so it cannot race a reactivation.
 */
export async function saveOverLimitChoice(businessId: string, actorUserId: string, choice: OverLimitChoice): Promise<void> {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    try {
      // Same lock keys as lib/subscription/limit-lock.ts (alphabetical: branches, users).
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`limit:${businessId}:branches`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`limit:${businessId}:users`]);

      const actor = await client.query(
        `SELECT 1 FROM users WHERE id = $1 AND business_id = $2 AND COALESCE(is_primary_admin, false) = true AND COALESCE(is_active, true) = true`,
        [actorUserId, businessId],
      );
      if (actor.rowCount === 0) throw new OverLimitChoiceError('NOT_OWNER', 'Only the business owner can choose who keeps access.');

      if (choice.keepUserIds) {
        const ids = [...new Set(choice.keepUserIds)];
        const holders = await loadSeatHolders(businessId, client);
        const byId = new Map(holders.map((h) => [h.id, h]));
        if (ids.some((id) => !byId.has(id))) {
          throw new OverLimitChoiceError('NOT_FOUND', 'One of the chosen users does not hold a seat in this business.');
        }
        const allowed = await planAllowance(businessId, 'users');
        const kept = new Set<string>(ids);
        holders.filter((h) => h.isPrimaryAdmin).forEach((h) => kept.add(h.id));
        if (allowed !== null && kept.size > allowed) {
          throw new OverLimitChoiceError(
            'TOO_MANY',
            `Your plan has ${allowed} user seat${allowed === 1 ? '' : 's'} (the owner counts as one). Choose at most ${allowed} including the owner, or upgrade.`,
          );
        }
        await client.query(
          `UPDATE users SET over_limit_keep = (id = ANY($2::uuid[]))
            WHERE business_id = $1 AND id = ANY($3::uuid[]) AND over_limit_keep IS DISTINCT FROM (id = ANY($2::uuid[]))`,
          [businessId, ids, holders.map((h) => h.id)],
        );
      }

      if (choice.keepBranchIds) {
        const ids = [...new Set(choice.keepBranchIds)];
        const branches = await loadActiveBranches(businessId, client);
        const byId = new Map(branches.map((b) => [b.id, b]));
        if (ids.some((id) => !byId.has(id))) {
          throw new OverLimitChoiceError('NOT_FOUND', 'One of the chosen branches is not an active branch of this business.');
        }
        const allowed = await planAllowance(businessId, 'branches');
        const kept = new Set<string>(ids);
        branches.filter((b) => b.isDefault).forEach((b) => kept.add(b.id));
        if (allowed !== null && kept.size > allowed) {
          throw new OverLimitChoiceError(
            'TOO_MANY',
            `Your plan allows ${allowed} active branch${allowed === 1 ? '' : 'es'} (the default branch counts as one). Choose at most ${allowed} including the default branch, or upgrade.`,
          );
        }
        await client.query(
          `UPDATE branches SET over_limit_keep = (id = ANY($2::uuid[]))
            WHERE business_id = $1 AND id = ANY($3::uuid[]) AND over_limit_keep IS DISTINCT FROM (id = ANY($2::uuid[]))`,
          [businessId, ids, branches.map((b) => b.id)],
        );
      }

      await client.query(
        `UPDATE businesses SET over_limit_choice_updated_at = NOW(), over_limit_choice_updated_by = $2 WHERE id = $1`,
        [businessId, actorUserId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

/** HTTP answer for a BranchReadOnlyError (403, plain message), or null for any other error. */
export function branchReadOnlyResponse(error: unknown): NextResponse | null {
  if (error instanceof BranchReadOnlyError) {
    return NextResponse.json({ error: error.message, code: error.code, branch_id: error.branchId }, { status: 403 });
  }
  return null;
}
