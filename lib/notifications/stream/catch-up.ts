import { queryOne, queryRows } from '@/lib/db';
import { OVERLAP_WINDOW_MS } from './config';

export type StreamScope = { businessId: string; userId: string };

export type StreamRow = {
  branch: 'own' | 'broadcast';
  id: string;
  seq: string;
  type: string;
  title: string;
  message: string;
  reference_type: string | null;
  reference_id: string | null;
  user_id: string | null;
  /** created_at falls inside the overlap window (late-commit candidates). */
  recent: boolean;
};

/** Database access used by stream connections; injectable for unit tests. */
export interface StreamSource {
  latestSeq(scope: StreamScope): Promise<bigint>;
  fetchAfter(scope: StreamScope, afterSeq: bigint, limit: number): Promise<StreamRow[]>;
  fetchRecentAtOrBelow(scope: StreamScope, atOrBelow: bigint, limit: number): Promise<StreamRow[]>;
  fetchByIds(scope: StreamScope, ids: string[]): Promise<StreamRow[]>;
}

/** `windowParam` is the placeholder holding the overlap window in seconds. */
const cols = (windowParam: string) => `id, seq::text AS seq, type, title, message, reference_type,
  reference_id::text AS reference_id, user_id::text AS user_id,
  (created_at IS NOT NULL AND created_at > LOCALTIMESTAMP - make_interval(secs => ${windowParam})) AS recent`;
const COLS = cols('$5');

const WINDOW_S = OVERLAP_WINDOW_MS / 1000;

/**
 * Own rows and business-wide broadcast rows as two ordered branches, so each uses
 * idx_notifications_business_user_seq; `user_id = X OR user_id IS NULL` cannot.
 */
const AFTER_SQL = `
  (SELECT 'own' AS branch, ${COLS} FROM notifications
    WHERE business_id = $1 AND user_id = $2 AND seq > $3::bigint ORDER BY seq LIMIT $4)
  UNION ALL
  (SELECT 'broadcast' AS branch, ${COLS} FROM notifications
    WHERE business_id = $1 AND user_id IS NULL AND seq > $3::bigint ORDER BY seq LIMIT $4)`;

const RECENT_AT_OR_BELOW_SQL = `
  (SELECT 'own' AS branch, ${COLS} FROM notifications
    WHERE business_id = $1 AND user_id = $2 AND seq <= $3::bigint ORDER BY seq DESC LIMIT $4)
  UNION ALL
  (SELECT 'broadcast' AS branch, ${COLS} FROM notifications
    WHERE business_id = $1 AND user_id IS NULL AND seq <= $3::bigint ORDER BY seq DESC LIMIT $4)`;

const BY_IDS_SQL = `
  SELECT CASE WHEN user_id IS NULL THEN 'broadcast' ELSE 'own' END AS branch, ${cols('$4')}
    FROM notifications
   WHERE id = ANY($3::uuid[]) AND business_id = $1 AND (user_id = $2 OR user_id IS NULL)`;

const LATEST_SQL = `
  SELECT GREATEST(
    (SELECT seq FROM notifications WHERE business_id = $1 AND user_id = $2 ORDER BY seq DESC LIMIT 1),
    (SELECT seq FROM notifications WHERE business_id = $1 AND user_id IS NULL ORDER BY seq DESC LIMIT 1)
  )::text AS seq`;

export const dbStreamSource: StreamSource = {
  async latestSeq(scope) {
    const row = await queryOne<{ seq: string | null }>(LATEST_SQL, [scope.businessId, scope.userId]);
    return row?.seq ? BigInt(row.seq) : 0n;
  },
  fetchAfter(scope, afterSeq, limit) {
    return queryRows<StreamRow>(AFTER_SQL, [scope.businessId, scope.userId, afterSeq.toString(), limit, WINDOW_S]);
  },
  fetchRecentAtOrBelow(scope, atOrBelow, limit) {
    return queryRows<StreamRow>(RECENT_AT_OR_BELOW_SQL, [
      scope.businessId,
      scope.userId,
      atOrBelow.toString(),
      limit,
      WINDOW_S,
    ]);
  },
  fetchByIds(scope, ids) {
    if (ids.length === 0) return Promise.resolve([]);
    return queryRows<StreamRow>(BY_IDS_SQL, [scope.businessId, scope.userId, ids, WINDOW_S]);
  },
};

export const STREAM_SQL = { AFTER_SQL, RECENT_AT_OR_BELOW_SQL, BY_IDS_SQL, LATEST_SQL };
