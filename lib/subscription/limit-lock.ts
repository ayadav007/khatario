/**
 * Limited creates (SUB-25): count and insert as one step per (business, limit).
 *
 * `withLimitedCreate` opens a transaction, takes `pg_advisory_xact_lock(hashtext('limit:<business>:<limit>'))`,
 * counts with the same rule `checkLimit` uses (`evaluateLimit`), and either refuses (throws
 * `LimitRefusedError`, nothing inserted) or runs `fn(client)` to insert, then commits. A second
 * request for the same business and limit waits on the lock, so it counts after the first one's
 * insert is committed: two creates at limit - 1 can never both succeed.
 *
 * Rules for callers:
 * - Keep `fn` short and do the insert(s) of the limited record in it. Do not take other long locks first.
 * - Several limits at once (employee + department + designation) lock in alphabetical order of the
 *   limit type, so two such creates cannot deadlock on each other.
 * - Inside an existing transaction pass `{ client }`: the lock is taken on that transaction and it is
 *   the caller's job to COMMIT / ROLLBACK. The lock is released when that transaction ends.
 * - Turn a refusal into the HTTP answer with `limitRefusedResponse(error)` (lib/subscription/limit-response.ts).
 */

import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import {
  ensureFreePlanForLimit,
  evaluateLimit,
  getBusinessSubscription,
  LIMIT_CHECK_RETRY_MESSAGE,
  type LimitCheckResult,
} from '@/lib/subscription';
import { resolveBusinessLimit, type ResolvedLimit } from '@/lib/subscription/resolve-limit';
import { LIMIT_KEY_BY_TYPE } from '@/lib/subscription/limit-registry';
import type { LimitCheckType } from '@/lib/subscription/limit-registry';

export class LimitRefusedError extends Error {
  constructor(
    public readonly limitType: LimitCheckType,
    public readonly check: LimitCheckResult,
  ) {
    super(check.message || 'Limit reached');
    this.name = 'LimitRefusedError';
  }
}

export type LimitSpec = {
  limitType: LimitCheckType;
  /**
   * How many records this create adds under this limit (default 1). A function is evaluated inside
   * the lock (for example "1 if this department name is new, else 0"); 0 skips the limit.
   */
  adding?: number | ((client: PoolClient) => Promise<number>);
};

/** Lock key text for one (business, limit): also used by tests and by anything that must queue behind creates. */
export function limitLockKey(businessId: string, limitType: LimitCheckType): string {
  return `limit:${businessId}:${limitType}`;
}

/** How long a create waits for another create's lock before it is refused with "try again". Tests lower it. */
export const limitLockTimeout = { ms: 5000 };

type PreparedLimit = { resolved: ResolvedLimit | Error; legacyLimits: Record<string, unknown> | null };

/**
 * Everything a limit check reads from the plan (free-plan safety net, the resolved cap, the legacy plan JSON),
 * read BEFORE any lock is taken: none of it is what the lock protects, and it must not need a pool connection
 * while the lock is held. A failure is kept and refuses that limit later (fails closed).
 */
export async function prepareLimitChecks(
  businessId: string,
  specs: LimitSpec[],
): Promise<Map<LimitCheckType, PreparedLimit>> {
  const prepared = new Map<LimitCheckType, PreparedLimit>();
  for (const spec of specs) {
    if (prepared.has(spec.limitType)) continue;
    await ensureFreePlanForLimit(businessId, spec.limitType).catch((e) =>
      console.error('[limit-lock] free plan safety net failed:', e),
    );
    let resolved: ResolvedLimit | Error;
    try {
      resolved = await resolveBusinessLimit(businessId, spec.limitType, LIMIT_KEY_BY_TYPE[spec.limitType]);
    } catch (e) {
      resolved = e instanceof Error ? e : new Error(String(e));
    }
    let legacyLimits: Record<string, unknown> | null = null;
    try {
      const sub = await getBusinessSubscription(businessId);
      legacyLimits = (sub?.features?.limits as Record<string, unknown> | undefined) ?? null;
    } catch {
      legacyLimits = null;
    }
    prepared.set(spec.limitType, { resolved, legacyLimits });
  }
  return prepared;
}

/**
 * Take the (business, limit) locks on `client`'s open transaction and check each limit.
 * Throws LimitRefusedError for the first limit that does not pass, or (unavailable, "try again") when a lock
 * is not free within `limitLockTimeout`. Pass `prepared` (from prepareLimitChecks, called before the
 * transaction) so no pool connection is needed while a lock is held.
 */
export async function lockAndCheckLimits(
  client: PoolClient,
  businessId: string,
  specs: LimitSpec[],
  prepared?: Map<LimitCheckType, PreparedLimit>,
): Promise<void> {
  const prep = prepared ?? (await prepareLimitChecks(businessId, specs));
  const ordered = [...specs].sort((a, b) => a.limitType.localeCompare(b.limitType));

  // Waiting for another create's lock is bounded; the setting is put back once the locks are held.
  const previous = (await client.query(`SELECT current_setting('lock_timeout') AS v`)).rows[0]?.v as string;
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [`${limitLockTimeout.ms}ms`]);

  // Take every lock before counting anything, in a fixed order.
  const locked: LimitSpec[] = [];
  for (const spec of ordered) {
    try {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [limitLockKey(businessId, spec.limitType)]);
    } catch (error) {
      if ((error as { code?: string })?.code === '55P03') {
        console.error(`[limit-lock] timed out waiting for the ${spec.limitType} lock of business ${businessId}`);
        throw new LimitRefusedError(spec.limitType, {
          allowed: false,
          current: 0,
          limit: 0,
          message: LIMIT_CHECK_RETRY_MESSAGE,
          unavailable: true,
        });
      }
      throw error;
    }
    locked.push(spec);
  }
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [previous ?? '0']);

  const txQueryOne = async (sql: string, params?: unknown[]) => {
    const result = await client.query(sql, (params ?? []) as unknown[]);
    return result.rows[0] ?? null;
  };

  for (const spec of locked) {
    const adding =
      typeof spec.adding === 'function' ? await spec.adding(client) : spec.adding ?? 1;
    if (adding <= 0) continue;

    const p = prep.get(spec.limitType)!;
    const check = await evaluateLimit(businessId, spec.limitType, txQueryOne, {
      adding,
      legacyLimits: p.legacyLimits,
      resolved: p.resolved,
    });
    if (!check.allowed) throw new LimitRefusedError(spec.limitType, check);
  }
}

/**
 * Run `fn` (which inserts the limited record) under the limit lock. See the file header.
 * Returns whatever `fn` returns. Throws LimitRefusedError when the plan limit is reached or could not be checked.
 */
export async function withLimitedCreate<T>(
  businessId: string,
  limit: LimitCheckType | LimitSpec[],
  fn: (client: PoolClient) => Promise<T>,
  opts: { client?: PoolClient } = {},
): Promise<T> {
  const specs: LimitSpec[] =
    typeof limit === 'string' ? [{ limitType: limit }] : limit;

  if (opts.client) {
    await lockAndCheckLimits(opts.client, businessId, specs);
    return fn(opts.client);
  }

  // Plan context first, on pool connections that are released before the transaction starts.
  const prepared = await prepareLimitChecks(businessId, specs);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    try {
      await lockAndCheckLimits(client, businessId, specs, prepared);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * `queryOne` for the INSERT of a limited record: the same statement, run under the limit lock after the
 * count (see withLimitedCreate). Returns the first row (RETURNING *) or null. Throws LimitRefusedError.
 */
export function limitedQueryOne<T = any>(
  businessId: string,
  limitType: LimitCheckType,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return withLimitedCreate(businessId, limitType, async (client) => {
    const result = await client.query(sql, params);
    return (result.rows[0] as T | undefined) ?? null;
  });
}

/**
 * Like limitedQueryOne for a statement that may add 0 or 1 record (an upsert): `adding` runs inside the lock
 * and returns how many records the statement is about to add; 0 skips the limit check.
 */
export function limitedUpsertCount<T = any>(
  businessId: string,
  limitType: LimitCheckType,
  adding: (client: PoolClient) => Promise<number>,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return withLimitedCreate(businessId, [{ limitType, adding }], async (client) => {
    const result = await client.query(sql, params);
    return (result.rows[0] as T | undefined) ?? null;
  });
}
