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
  type LimitCheckResult,
} from '@/lib/subscription';
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

/**
 * Take the (business, limit) locks on `client`'s open transaction and check each limit.
 * Throws LimitRefusedError for the first limit that does not pass.
 */
export async function lockAndCheckLimits(
  client: PoolClient,
  businessId: string,
  specs: LimitSpec[],
): Promise<void> {
  // The free-plan safety net of checkLimit (an enabled product with no row) runs on its own connection first.
  for (const spec of specs) {
    await ensureFreePlanForLimit(businessId, spec.limitType).catch((e) =>
      console.error('[limit-lock] free plan safety net failed:', e),
    );
  }

  const ordered = [...specs].sort((a, b) => a.limitType.localeCompare(b.limitType));

  // Take every lock before counting anything, in a fixed order.
  const locked: LimitSpec[] = [];
  for (const spec of ordered) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [limitLockKey(businessId, spec.limitType)]);
    locked.push(spec);
  }

  const txQueryOne = async (sql: string, params?: unknown[]) => {
    const result = await client.query(sql, (params ?? []) as unknown[]);
    return result.rows[0] ?? null;
  };

  for (const spec of locked) {
    const adding =
      typeof spec.adding === 'function' ? await spec.adding(client) : spec.adding ?? 1;
    if (adding <= 0) continue;

    // Same plan row JSON the advisory check reads, for limit keys that have no registry entry.
    let legacyLimits: Record<string, unknown> | null = null;
    try {
      const sub = await getBusinessSubscription(businessId);
      legacyLimits = (sub?.features?.limits as Record<string, unknown> | undefined) ?? null;
    } catch {
      legacyLimits = null;
    }

    const check = await evaluateLimit(businessId, spec.limitType, txQueryOne, { adding, legacyLimits });
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

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    try {
      await lockAndCheckLimits(client, businessId, specs);
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
