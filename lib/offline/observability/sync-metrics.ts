import type { SyncMetricsSnapshot } from '@/lib/offline/types';

let metrics: SyncMetricsSnapshot = {
  totalProcessed: 0,
  totalSucceeded: 0,
  totalFailed: 0,
  totalConflicts: 0,
  totalDuplicatesPrevented: 0,
  totalManualReview: 0,
  lastRunDurationMs: null,
  lastRunAt: null,
};

export function recordSyncRun(result: {
  processed: number;
  succeeded: number;
  failed: number;
  conflicts: number;
  durationMs: number;
  duplicatesPrevented?: number;
  manualReview?: number;
}): void {
  metrics = {
    totalProcessed: metrics.totalProcessed + result.processed,
    totalSucceeded: metrics.totalSucceeded + result.succeeded,
    totalFailed: metrics.totalFailed + result.failed,
    totalConflicts: metrics.totalConflicts + result.conflicts,
    totalDuplicatesPrevented:
      metrics.totalDuplicatesPrevented + (result.duplicatesPrevented ?? 0),
    totalManualReview: metrics.totalManualReview + (result.manualReview ?? 0),
    lastRunDurationMs: result.durationMs,
    lastRunAt: Date.now(),
  };
}

export function recordDuplicatePrevented(): void {
  metrics = {
    ...metrics,
    totalDuplicatesPrevented: metrics.totalDuplicatesPrevented + 1,
  };
}

export function getSyncMetrics(): SyncMetricsSnapshot {
  return { ...metrics };
}

export function resetSyncMetricsForTests(): void {
  metrics = {
    totalProcessed: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalConflicts: 0,
    totalDuplicatesPrevented: 0,
    totalManualReview: 0,
    lastRunDurationMs: null,
    lastRunAt: null,
  };
}
