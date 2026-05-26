import type {
  OfflineAction,
  OfflineActionType,
  SyncEngineRunResult,
  TenantScope,
} from '@/lib/offline/types';
import { isAppOffline } from '@/lib/network/offline-state';
import { offlineActionQueue } from '@/lib/offline/queue/offline-action-queue';
import {
  computeRetryDelayMs,
  shouldRetry,
  sleep,
} from '@/lib/offline/sync/retry-policy';
import {
  persistConflict,
  resolveConflict,
} from '@/lib/offline/sync/conflict-resolver';
import { appendSyncLog } from '@/lib/offline/observability/sync-log';
import { recordSyncRun } from '@/lib/offline/observability/sync-metrics';
import {
  markSyncAttempt,
  markSyncSuccess,
  refreshSyncMetaCounts,
} from '@/lib/offline/repositories/sync-meta-repository';
import { compareOfflineActions } from '@/lib/offline/sync/action-order';

export interface ActionExecutorResult {
  ok: boolean;
  serverPayload?: unknown;
  serverVersion?: number | null;
  conflict?: boolean;
  error?: string;
  /** HTTP 409 etc. */
  statusCode?: number;
}

export type ActionExecutor = (
  action: OfflineAction
) => Promise<ActionExecutorResult>;

const executors = new Map<OfflineActionType, ActionExecutor>();

export function registerActionExecutor(
  type: OfflineActionType,
  executor: ActionExecutor
): void {
  executors.set(type, executor);
}

export function getRegisteredExecutors(): OfflineActionType[] {
  return Array.from(executors.keys());
}

let running = false;

export function isSyncEngineRunning(): boolean {
  return running;
}

/**
 * Processes pending offline actions in sequence order for a tenant.
 * Call on reconnect or manual "Sync now".
 */
export async function runSyncEngine(
  scope: TenantScope
): Promise<SyncEngineRunResult> {
  if (running) {
    await appendSyncLog('warn', 'sync.skipped_already_running', { scope });
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      conflicts: 0,
      durationMs: 0,
    };
  }

  if (isAppOffline()) {
    await appendSyncLog('info', 'sync.skipped_offline', { scope });
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      conflicts: 0,
      durationMs: 0,
    };
  }

  running = true;
  const started = Date.now();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let conflicts = 0;
  let manualReview = 0;
  let duplicatesPrevented = 0;

  try {
    await markSyncAttempt(scope);
    await appendSyncLog('info', 'sync.start', { scope });

    const pending = (
      await offlineActionQueue.list(scope, ['pending', 'failed'])
    ).sort(compareOfflineActions);

    for (const action of pending) {
      if (isAppOffline()) {
        await appendSyncLog('warn', 'sync.interrupted_offline', {
          actionId: action.id,
        });
        break;
      }

      const executor = executors.get(action.type);
      if (!executor) {
        await offlineActionQueue.updateStatus(action.id, 'failed', {
          lastError: `No executor registered for ${action.type}`,
        });
        failed += 1;
        processed += 1;
        continue;
      }

      await offlineActionQueue.markProcessing(action.id);
      processed += 1;

      let result: ActionExecutorResult;
      try {
        result = await executor(action);
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : 'Executor threw',
        };
      }

      if (result.ok) {
        const replayPayload = result.serverPayload as {
          replay_status?: string;
          diagnostics?: { duplicate_detected?: boolean };
        } | undefined;
        if (replayPayload?.diagnostics?.duplicate_detected) {
          duplicatesPrevented += 1;
        }
        await offlineActionQueue.updateStatus(action.id, 'completed');
        succeeded += 1;
        await appendSyncLog('info', 'sync.action.completed', {
          actionId: action.id,
          type: action.type,
          duplicate: replayPayload?.replay_status === 'duplicate',
        });
        continue;
      }

      if (result.conflict || result.statusCode === 409) {
        const replayPayload = result.serverPayload as { replay_status?: string } | undefined;
        if (replayPayload?.replay_status === 'manual_review') {
          await offlineActionQueue.updateStatus(action.id, 'manual_review', {
            lastError: result.error ?? 'GST conflict — manual review required',
          });
          conflicts += 1;
          manualReview += 1;
          await appendSyncLog('warn', 'sync.action.manual_review', {
            actionId: action.id,
            type: action.type,
          });
          continue;
        }

        const resolution = resolveConflict({
          action,
          serverPayload: result.serverPayload ?? null,
          clientPayload: action.payload,
          serverVersion: result.serverVersion ?? null,
          clientVersion: null,
        });

        if (resolution.outcome === 'manual_review') {
          await persistConflict(resolution.conflict);
          await offlineActionQueue.updateStatus(action.id, 'manual_review', {
            lastError: 'Conflict requires manual review',
          });
          conflicts += 1;
          manualReview += 1;
          await appendSyncLog('warn', 'sync.action.conflict', {
            actionId: action.id,
            type: action.type,
          });
          continue;
        }

        await offlineActionQueue.updateStatus(action.id, 'completed');
        succeeded += 1;
        continue;
      }

      const attempts = action.attempts + 1;
      if (shouldRetry(attempts)) {
        const delay = computeRetryDelayMs(attempts);
        await offlineActionQueue.updateStatus(action.id, 'failed', {
          attempts,
          lastError: result.error ?? 'Unknown error',
        });
        await appendSyncLog('warn', 'sync.action.retry_scheduled', {
          actionId: action.id,
          attempts,
          delayMs: delay,
        });
        await sleep(delay);
        failed += 1;
      } else {
        await offlineActionQueue.updateStatus(action.id, 'failed', {
          attempts,
          lastError: result.error ?? 'Max retries exceeded',
        });
        failed += 1;
        await appendSyncLog('error', 'sync.action.failed', {
          actionId: action.id,
          error: result.error,
        });
      }
    }

    if (succeeded > 0 && failed === 0 && conflicts === 0) {
      await markSyncSuccess(scope);
    } else {
      await refreshSyncMetaCounts(scope);
    }

    const durationMs = Date.now() - started;
    const summary: SyncEngineRunResult = {
      processed,
      succeeded,
      failed,
      conflicts,
      durationMs,
    };
    recordSyncRun({
      ...summary,
      duplicatesPrevented,
      manualReview,
    });
    await appendSyncLog('info', 'sync.complete', { ...summary, scope });
    return summary;
  } finally {
    running = false;
  }
}
