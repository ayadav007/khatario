import type { PoolClient } from 'pg';
import { queryRows, queryOne } from '@/lib/db';
import type {
  OfflineReplayLogRow,
  ReplayLogStatus,
} from '@/lib/offline-sync/types';
import { PROCESSING_STALE_MS } from '@/lib/offline-sync/types';

export interface InsertReplayLogInput {
  businessId: string;
  idempotencyKey: string;
  actionType: string;
  requestHash: string;
  requestPayload: Record<string, unknown>;
  userId: string;
  deviceId?: string | null;
}

export async function findReplayLog(
  businessId: string,
  idempotencyKey: string,
  client?: PoolClient
): Promise<OfflineReplayLogRow | null> {
  const sql = `SELECT * FROM offline_replay_log WHERE business_id = $1 AND idempotency_key = $2 LIMIT 1`;
  const params = [businessId, idempotencyKey];
  if (client) {
    const res = await client.query<OfflineReplayLogRow>(sql, params);
    return res.rows[0] ?? null;
  }
  return queryOne<OfflineReplayLogRow>(sql, params);
}

export async function insertReplayLogPending(
  client: PoolClient,
  input: InsertReplayLogInput
): Promise<OfflineReplayLogRow | null> {
  const res = await client.query<OfflineReplayLogRow>(
    `
    INSERT INTO offline_replay_log (
      business_id, idempotency_key, action_type, request_hash, request_payload,
      status, created_by_user_id, device_id, replay_attempts, last_attempt_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, 0, NOW())
    ON CONFLICT (business_id, idempotency_key) DO NOTHING
    RETURNING *
    `,
    [
      input.businessId,
      input.idempotencyKey,
      input.actionType,
      input.requestHash,
      JSON.stringify(input.requestPayload),
      input.userId,
      input.deviceId ?? null,
    ]
  );
  return res.rows[0] ?? null;
}

export async function lockReplayLogRow(
  client: PoolClient,
  businessId: string,
  idempotencyKey: string
): Promise<OfflineReplayLogRow | null> {
  const res = await client.query<OfflineReplayLogRow>(
    `
    SELECT * FROM offline_replay_log
    WHERE business_id = $1 AND idempotency_key = $2
    FOR UPDATE
    `,
    [businessId, idempotencyKey]
  );
  return res.rows[0] ?? null;
}

export async function markReplayProcessing(
  client: PoolClient,
  id: string
): Promise<void> {
  await client.query(
    `
    UPDATE offline_replay_log
    SET status = 'processing',
        replay_attempts = replay_attempts + 1,
        last_attempt_at = NOW()
    WHERE id = $1
    `,
    [id]
  );
}

export async function incrementDuplicatePrevented(
  client: PoolClient,
  id: string
): Promise<void> {
  await client.query(
    `
    UPDATE offline_replay_log
    SET duplicate_prevented_count = duplicate_prevented_count + 1,
        last_attempt_at = NOW()
    WHERE id = $1
    `,
    [id]
  );
}

export async function markReplayCompleted(
  client: PoolClient,
  id: string,
  response: Record<string, unknown>,
  entity?: { type: string; id?: string }
): Promise<void> {
  await client.query(
    `
    UPDATE offline_replay_log
    SET status = 'completed',
        response_payload = $2::jsonb,
        entity_type = $3,
        entity_id = $4,
        completed_at = NOW(),
        last_attempt_at = NOW(),
        error_message = NULL
    WHERE id = $1
    `,
    [
      id,
      JSON.stringify(response),
      entity?.type ?? null,
      entity?.id ?? null,
    ]
  );
}

export async function markReplayFailed(
  client: PoolClient,
  id: string,
  errorMessage: string,
  permanent: boolean
): Promise<void> {
  await client.query(
    `
    UPDATE offline_replay_log
    SET status = 'failed',
        error_message = $2,
        last_attempt_at = NOW(),
        completed_at = CASE WHEN $3 THEN NOW() ELSE completed_at END
    WHERE id = $1
    `,
    [id, errorMessage, permanent]
  );
}

export async function markReplayManualReview(
  client: PoolClient,
  id: string,
  errorMessage: string,
  response?: Record<string, unknown>
): Promise<void> {
  await client.query(
    `
    UPDATE offline_replay_log
    SET status = 'manual_review',
        error_message = $2,
        response_payload = COALESCE($3::jsonb, response_payload),
        last_attempt_at = NOW()
    WHERE id = $1
    `,
    [id, errorMessage, response ? JSON.stringify(response) : null]
  );
}

export function isProcessingStale(row: OfflineReplayLogRow): boolean {
  if (row.status !== 'processing') return false;
  const ref = row.last_attempt_at ?? row.first_seen_at;
  return Date.now() - new Date(ref).getTime() > PROCESSING_STALE_MS;
}

export function canRetryFailed(row: OfflineReplayLogRow): boolean {
  return row.replay_attempts < 8;
}

export async function listReplayLogsForBusiness(
  businessId: string,
  limit = 50
): Promise<OfflineReplayLogRow[]> {
  return queryRows<OfflineReplayLogRow>(
    `
    SELECT * FROM offline_replay_log
    WHERE business_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [businessId, limit]
  );
}

export async function countReplayMetrics(businessId: string): Promise<{
  duplicatesPrevented: number;
  manualReview: number;
  failed: number;
  completed: number;
}> {
  const rows = await queryRows<{ status: ReplayLogStatus; count: string }>(
    `
    SELECT status, COUNT(*)::text AS count
    FROM offline_replay_log
    WHERE business_id = $1
    GROUP BY status
    `,
    [businessId]
  );
  const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  const dupRow = await queryOne<{ total: string }>(
    `
    SELECT COALESCE(SUM(duplicate_prevented_count), 0)::text AS total
    FROM offline_replay_log
    WHERE business_id = $1
    `,
    [businessId]
  );
  return {
    duplicatesPrevented: Number(dupRow?.total ?? 0),
    manualReview: map.manual_review ?? 0,
    failed: map.failed ?? 0,
    completed: map.completed ?? 0,
  };
}
