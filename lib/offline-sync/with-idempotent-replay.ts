import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import type { StandardReplayResponse } from '@/lib/offline-sync/types';
import {
  hashReplayPayload,
  POISON_QUEUE_ATTEMPTS,
} from '@/lib/offline-sync/types';
import {
  findReplayLog,
  insertReplayLogPending,
  lockReplayLogRow,
  markReplayCompleted,
  markReplayFailed,
  markReplayManualReview,
  markReplayProcessing,
  incrementDuplicatePrevented,
  canRetryFailed,
  isProcessingStale,
} from '@/lib/offline-sync/replay-log-repository';

export interface IdempotentReplayContext {
  businessId: string;
  userId: string;
  idempotencyKey: string;
  actionType: string;
  requestPayload: Record<string, unknown>;
  deviceId?: string | null;
}

export type ReplayExecutorResult =
  | {
      ok: true;
      response: Record<string, unknown>;
      entityType?: string;
      entityId?: string;
    }
  | {
      ok: false;
      kind: 'failed';
      message: string;
      permanent: boolean;
    }
  | {
      ok: false;
      kind: 'manual_review';
      message: string;
      details?: Record<string, unknown>;
    };

export type ReplayExecutor = (
  client: PoolClient,
  ctx: IdempotentReplayContext
) => Promise<ReplayExecutorResult>;

function toStandardResponse(
  ctx: IdempotentReplayContext,
  input: {
    replay_status: StandardReplayResponse['replay_status'];
    success: boolean;
    entityType?: string;
    entityId?: string;
    result?: Record<string, unknown>;
    error?: string;
    diagnostics?: StandardReplayResponse['diagnostics'];
  }
): StandardReplayResponse {
  return {
    success: input.success,
    replay_status: input.replay_status,
    entity_type: input.entityType,
    entity_id: input.entityId,
    idempotency_key: ctx.idempotencyKey,
    server_timestamp: new Date().toISOString(),
    diagnostics: input.diagnostics,
    result: input.result,
    error: input.error,
  };
}

/**
 * Transaction-safe, race-safe idempotent replay guard.
 * Uses INSERT … ON CONFLICT + SELECT FOR UPDATE for concurrent requests.
 */
export async function withIdempotentReplay(
  ctx: IdempotentReplayContext,
  executor: ReplayExecutor
): Promise<StandardReplayResponse> {
  const pool = getPool();
  const client = await pool.connect();
  const started = Date.now();
  const requestHash = hashReplayPayload(ctx.requestPayload);

  try {
    await client.query('BEGIN');

    let row =
      (await insertReplayLogPending(client, {
        businessId: ctx.businessId,
        idempotencyKey: ctx.idempotencyKey,
        actionType: ctx.actionType,
        requestHash,
        requestPayload: ctx.requestPayload,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
      })) ??
      (await lockReplayLogRow(client, ctx.businessId, ctx.idempotencyKey));

    if (!row) {
      await client.query('ROLLBACK');
      return toStandardResponse(ctx, {
        success: false,
        replay_status: 'failed',
        error: 'Could not acquire replay log row',
      });
    }

    if (row.request_hash !== requestHash) {
      await markReplayManualReview(
        client,
        row.id,
        'Idempotency key reused with different payload hash'
      );
      await client.query('COMMIT');
      return toStandardResponse(ctx, {
        success: false,
        replay_status: 'manual_review',
        error: 'Idempotency key conflict: payload mismatch',
        diagnostics: { replay_attempts: row.replay_attempts, gst_conflict: true },
      });
    }

    if (row.status === 'completed' && row.response_payload) {
      await incrementDuplicatePrevented(client, row.id);
      await client.query('COMMIT');
      return toStandardResponse(ctx, {
        success: true,
        replay_status: 'duplicate',
        entityType: row.entity_type ?? undefined,
        entityId: row.entity_id ?? undefined,
        result: row.response_payload,
        diagnostics: {
          replay_attempts: row.replay_attempts,
          duplicate_detected: true,
          duration_ms: Date.now() - started,
        },
      });
    }

    if (row.status === 'manual_review') {
      await client.query('COMMIT');
      return toStandardResponse(ctx, {
        success: false,
        replay_status: 'manual_review',
        error: row.error_message ?? 'Requires manual review',
        diagnostics: { replay_attempts: row.replay_attempts },
      });
    }

    if (row.status === 'processing' && !isProcessingStale(row)) {
      await client.query('COMMIT');
      return toStandardResponse(ctx, {
        success: false,
        replay_status: 'failed',
        error: 'Replay already in progress',
        diagnostics: { replay_attempts: row.replay_attempts },
      });
    }

    if (row.status === 'failed' && !canRetryFailed(row)) {
      await client.query('COMMIT');
      return toStandardResponse(ctx, {
        success: false,
        replay_status: 'failed',
        error: row.error_message ?? 'Max replay attempts exceeded',
        diagnostics: { replay_attempts: row.replay_attempts },
      });
    }

    await markReplayProcessing(client, row.id);
    row = (await lockReplayLogRow(client, ctx.businessId, ctx.idempotencyKey))!;

    const execResult = await executor(client, ctx);

    if (execResult.ok) {
      await markReplayCompleted(client, row.id, execResult.response, {
        type: execResult.entityType ?? 'unknown',
        id:
          execResult.entityId && execResult.entityId.length > 0
            ? execResult.entityId
            : undefined,
      });
      await client.query('COMMIT');
      return toStandardResponse(ctx, {
        success: true,
        replay_status: 'completed',
        entityType: execResult.entityType,
        entityId: execResult.entityId,
        result: execResult.response,
        diagnostics: {
          replay_attempts: row.replay_attempts + 1,
          duration_ms: Date.now() - started,
        },
      });
    }

    if (execResult.kind === 'manual_review') {
      await markReplayManualReview(
        client,
        row.id,
        execResult.message,
        execResult.details
      );
      await client.query('COMMIT');
      return toStandardResponse(ctx, {
        success: false,
        replay_status: 'manual_review',
        error: execResult.message,
        result: execResult.details,
        diagnostics: {
          replay_attempts: row.replay_attempts + 1,
          gst_conflict: true,
          duration_ms: Date.now() - started,
        },
      });
    }

    const permanent =
      execResult.permanent || row.replay_attempts + 1 >= POISON_QUEUE_ATTEMPTS;
    await markReplayFailed(client, row.id, execResult.message, permanent);
    await client.query('COMMIT');
    return toStandardResponse(ctx, {
      success: false,
      replay_status: 'failed',
      error: execResult.message,
      diagnostics: {
        replay_attempts: row.replay_attempts + 1,
        duration_ms: Date.now() - started,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
