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
 * Warning period: enforcement starts only OVER_LIMIT_GRACE_DAYS (7) after a business was first seen over its limit
 * (`businesses.over_limit_seats_since` / `over_limit_branches_since`, migration 484). The same refresh that caches the
 * allowance (at most once per 10 s per business per process) sets the timestamp when the business goes over, clears it
 * when it is back within the limit, and sends the owner one email when it is first set. Writes happen only on a
 * change. During the warning nobody is paused and no branch is read-only; the owner sees a banner.
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
import { getCachedState, setCachedState, type OverLimitState } from '@/lib/subscription/over-limit-cache';

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

export const OVER_LIMIT_GRACE_DAYS = 7;

const SINCE_COLUMN: Record<Kind, string> = {
  users: 'over_limit_seats_since',
  branches: 'over_limit_branches_since',
};

async function clearSince(businessId: string, kind: Kind): Promise<void> {
  const col = SINCE_COLUMN[kind];
  await db.query(`UPDATE businesses SET ${col} = NULL WHERE id = $1 AND ${col} IS NOT NULL`, [businessId]);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One email to the owner when a business is first seen over its limit: who / which branches, the date, the links. */
async function notifyOwnerOverLimit(businessId: string, kind: Kind, allowed: number, enforceAtIso: string): Promise<void> {
  try {
    const { getBusinessPlatformRecipient, sendPlatformEmail } = await import('@/lib/platform-email');
    const recipient = await getBusinessPlatformRecipient(businessId);
    if (!recipient?.email) return;
    let names: string[];
    if (kind === 'users') {
      const holders = await loadSeatHolders(businessId);
      const ids = [...pausedSeatIds(holders, allowed)];
      const rows = await db.queryRows<{ name: string | null }>(`SELECT name FROM users WHERE business_id = $1 AND id = ANY($2::uuid[])`, [businessId, ids]);
      names = rows.map((r) => r.name || 'A user');
    } else {
      const branches = await loadActiveBranches(businessId);
      const ids = readOnlyBranchIds(branches, allowed);
      names = branches.filter((b) => ids.has(b.id)).map((b) => b.name);
    }
    const date = new Date(enforceAtIso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://khatario.com').replace(/\/$/, '');
    const what =
      kind === 'users'
        ? `Your plan has ${allowed} user seat${allowed === 1 ? '' : 's'}, and more people use one. On ${date} these people will be paused (they cannot sign in until you upgrade or choose who keeps access): ${names.join(', ')}.`
        : `Your plan allows ${allowed} active branch${allowed === 1 ? '' : 'es'}, and you have more. On ${date} these branches will become read-only (you can still view their records, but cannot add or change any): ${names.join(', ')}.`;
    const text = `${what} Nothing is deleted. Choose who keeps access: ${origin}/settings/over-limit-access . Or upgrade your plan to keep everyone: ${origin}/settings/subscription .`;
    await sendPlatformEmail({
      to: recipient.email,
      subject: kind === 'users' ? 'Some of your team will be paused on ' + date : 'Some of your branches will become read-only on ' + date,
      html: `<p>${escapeHtml(what)}</p><p>Nothing is deleted.</p><p><a href="${origin}/settings/over-limit-access">Choose who keeps access</a> &nbsp;|&nbsp; <a href="${origin}/settings/subscription">Upgrade your plan</a></p>`,
      text,
      templateKey: 'subscription_lifecycle',
      businessId,
      metadata: { over_limit: kind },
    });
  } catch (error) {
    console.error('[over-limit] owner notice failed:', error);
  }
}

/**
 * Resolve the plan allowance and the warning state, and keep `over_limit_*_since` in step (write only on change).
 * Cached 10 s per business; plan changes clear it. Errors are not cached and mean "not enforced".
 */
async function overLimitState(businessId: string, kind: Kind): Promise<OverLimitState> {
  const cached = getCachedState(businessId, kind);
  if (cached) return cached;
  const unknown: OverLimitState = { known: false, allowed: null, enforce: false, enforceAt: null };
  let allowed: number | null;
  try {
    const resolved = await resolveBusinessLimit(businessId, kind, LIMIT_KEY_BY_TYPE[kind]);
    if (resolved.maxLimit === -1) allowed = null;
    else if (resolved.blockedReason || !resolved.fromRegistry) {
      setCachedState(businessId, kind, unknown);
      return unknown;
    } else allowed = Math.max(0, resolved.maxLimit);
  } catch (error) {
    console.error(`[over-limit] could not resolve the ${kind} allowance for ${businessId}:`, error);
    return unknown;
  }

  try {
    let state: OverLimitState = { known: true, allowed, enforce: false, enforceAt: null };
    if (allowed === null) {
      await clearSince(businessId, kind);
    } else {
      const over =
        kind === 'users'
          ? pausedSeatIds(await loadSeatHolders(businessId), allowed).size > 0
          : readOnlyBranchIds(await loadActiveBranches(businessId), allowed).size > 0;
      if (!over) {
        await clearSince(businessId, kind);
      } else {
        const col = SINCE_COLUMN[kind];
        const row = await db.queryOne<{ since: string | null; due: boolean; at: string | null }>(
          `SELECT ${col} AS since, (${col} <= NOW() - interval '${OVER_LIMIT_GRACE_DAYS} days') AS due,
                  (${col} + interval '${OVER_LIMIT_GRACE_DAYS} days') AS at FROM businesses WHERE id = $1`,
          [businessId],
        );
        if (row?.since) {
          state = { known: true, allowed, enforce: row.due === true, enforceAt: row.at ? new Date(row.at).toISOString() : null };
        } else {
          const first = await db.queryOne<{ at: string }>(
            `UPDATE businesses SET ${col} = NOW() WHERE id = $1 AND ${col} IS NULL
             RETURNING (${col} + interval '${OVER_LIMIT_GRACE_DAYS} days') AS at`,
            [businessId],
          );
          if (first) {
            const at = new Date(first.at).toISOString();
            state = { known: true, allowed, enforce: false, enforceAt: at };
            void notifyOwnerOverLimit(businessId, kind, allowed, at);
          }
        }
      }
    }
    setCachedState(businessId, kind, state);
    return state;
  } catch (error) {
    console.error(`[over-limit] could not update the ${kind} warning state for ${businessId}, not enforcing:`, error);
    return { known: true, allowed, enforce: false, enforceAt: null };
  }
}

/** How many seats / active branches the plan allows. null = no restriction (unlimited, or the plan cannot be resolved). */
export async function planAllowance(businessId: string, kind: Kind): Promise<number | null> {
  return (await overLimitState(businessId, kind)).allowed;
}

type Queryable = Pick<PoolClient, 'query'>;
const poolQuery: Queryable = { query: ((sql: string, params?: unknown[]) => db.getPool().query(sql, params)) as PoolClient['query'] };

// ---------------------------------------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------------------------------------

export type SeatHolder = { id: string; isPrimaryAdmin: boolean; keep: boolean; createdAt: string | null };
export type SeatAccess = {
  allowed: number | null;
  holders: SeatHolder[];
  /** Paused right now (empty during the 7-day warning). */
  pausedIds: Set<string>;
  /** Over the plan's seats: paused once the warning runs out. */
  candidateIds: Set<string>;
  enforced: boolean;
  enforceAt: string | null;
};

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
  const state = await overLimitState(businessId, 'users');
  const holders = await loadSeatHolders(businessId, q);
  const candidateIds = pausedSeatIds(holders, state.allowed);
  return {
    allowed: state.allowed,
    holders,
    candidateIds,
    pausedIds: state.enforce ? candidateIds : new Set<string>(),
    enforced: state.enforce,
    enforceAt: state.enforceAt,
  };
}

/** True when this user holds a seat beyond the plan's allowance. Never true for the owner; false on any read failure. */
export async function isUserSeatPaused(userId: string, businessId: string | null | undefined): Promise<boolean> {
  if (!businessId) return false;
  try {
    const state = await overLimitState(businessId, 'users');
    if (state.allowed === null || !state.enforce) return false; // unlimited, unknown or still in the warning: no query
    const holders = await loadSeatHolders(businessId);
    return pausedSeatIds(holders, state.allowed).has(userId);
  } catch (error) {
    console.error('[over-limit] seat check failed, not pausing:', error);
    return false;
  }
}

/**
 * Whether this user would be paused if they worked in `businessId` (used before switching into it and at sign-in).
 * A pause applies only to the business it was decided for: a person paused in one business can still use another
 * business where a seat is free. When the user already holds a seat there the real answer is used; otherwise
 * they are placed among that business's seat holders by the same order. False on any read failure.
 */
export async function wouldBeSeatPausedIn(userId: string, businessId: string): Promise<boolean> {
  try {
    const state = await overLimitState(businessId, 'users');
    const allowed = state.allowed;
    if (allowed === null || !state.enforce) return false;
    const holders = await loadSeatHolders(businessId);
    if (!holders.some((h) => h.id === userId)) {
      const row = await db.queryOne<{ is_primary_admin: boolean | null; created_at: Date | string | null; seat_type: string | null }>(
        `SELECT is_primary_admin, created_at, seat_type FROM users WHERE id = $1`,
        [userId],
      );
      if (!row || (row.seat_type ?? 'billing') === 'connect') return false;
      holders.push({
        id: userId,
        isPrimaryAdmin: row.is_primary_admin === true,
        keep: false,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      });
      holders.sort((a, b) =>
        Number(b.isPrimaryAdmin) - Number(a.isPrimaryAdmin) ||
        Number(b.keep) - Number(a.keep) ||
        (a.createdAt ?? '9999').localeCompare(b.createdAt ?? '9999') ||
        a.id.localeCompare(b.id),
      );
    }
    return pausedSeatIds(holders, allowed).has(userId);
  } catch (error) {
    console.error('[over-limit] seat check for the target business failed, not pausing:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------------------------------------

export type BranchRow = { id: string; name: string; isDefault: boolean; keep: boolean; createdAt: string | null };
export type BranchAccess = {
  allowed: number | null;
  branches: BranchRow[];
  readOnlyIds: Set<string>;
  candidateIds: Set<string>;
  enforced: boolean;
  enforceAt: string | null;
};

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
  const state = await overLimitState(businessId, 'branches');
  const branches = await loadActiveBranches(businessId, q);
  const candidateIds = readOnlyBranchIds(branches, state.allowed);
  return {
    allowed: state.allowed,
    branches,
    candidateIds,
    readOnlyIds: state.enforce ? candidateIds : new Set<string>(),
    enforced: state.enforce,
    enforceAt: state.enforceAt,
  };
}

/** True when the branch is active but beyond the plan's branch limit. False on any read failure. */
export async function isBranchReadOnly(businessId: string, branchId: string): Promise<boolean> {
  try {
    const state = await overLimitState(businessId, 'branches');
    if (state.allowed === null || !state.enforce) return false;
    const branches = await loadActiveBranches(businessId);
    return readOnlyBranchIds(branches, state.allowed).has(branchId);
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
