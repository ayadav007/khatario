'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOfflineSync, useSyncDiagnostics } from '@/contexts/OfflineSyncContext';
import { offlineActionQueue } from '@/lib/offline/queue/offline-action-queue';
import { listSyncLogs } from '@/lib/offline/observability/sync-log';
import { listPendingConflicts } from '@/lib/offline/sync/conflict-resolver';
import type {
  ConflictRecord,
  OfflineAction,
  OfflineActionStatus,
  SyncLogEntry,
} from '@/lib/offline/types';
import type { OfflineReplayLogRow } from '@/lib/offline-sync/types';
import { Button } from '@/components/ui/Button';
import { STACK_PAGE_CLASS } from '@/lib/page-layout';
import { formatLastSyncedLabel } from '@/lib/sync-timestamp';
import { safeJsonParse } from '@/lib/api-utils';
import { useCatalogSync } from '@/contexts/CatalogSyncContext';
import { getActiveCatalogBackend, getCatalogRepository } from '@/lib/offline/catalog/catalog-service';
import { isCapacitorNative } from '@/lib/capacitor/platform';

interface ServerReplayHistory {
  logs: OfflineReplayLogRow[];
  metrics: {
    completed: number;
    failed: number;
    manualReview: number;
    duplicatesPrevented: number;
    gst_conflicts?: number;
    invoice_number_mappings?: number;
  };
  invoice_number_mappings?: import('@/lib/offline-sync/invoice-number-map-repository').OfflineInvoiceNumberMapRow[];
}

const ACTIVE_QUEUE_STATUSES: OfflineActionStatus[] = [
  'pending',
  'syncing',
  'processing',
  'failed',
  'manual_review',
];

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-green-700';
    case 'manual_review':
      return 'text-amber-700';
    case 'failed':
      return 'text-red-700';
    case 'syncing':
    case 'processing':
      return 'text-blue-700';
    default:
      return 'text-text-secondary';
  }
}

export default function OfflineSyncDebugPage() {
  const { business, user } = useAuth();
  const { connectivity, pendingActionCount, triggerSync, isSyncing } =
    useOfflineSync();
  const {
    status: catalogStatus,
    isSyncing: isCatalogSyncing,
    progress: catalogProgress,
    lastError: catalogError,
    triggerFullSync,
    triggerDeltaSync,
  } = useCatalogSync();
  const { metrics } = useSyncDiagnostics();
  const [queue, setQueue] = useState<OfflineAction[]>([]);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [serverHistory, setServerHistory] = useState<ServerReplayHistory | null>(
    null
  );
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [catalogStorageBackend, setCatalogStorageBackend] = useState<
    'sqlite' | 'indexeddb' | null
  >(null);

  useEffect(() => {
    void getCatalogRepository().then(() => {
      setCatalogStorageBackend(getActiveCatalogBackend());
    });
  }, [catalogStatus?.itemCount, catalogStatus?.customerCount, isCatalogSyncing]);

  const refreshLocal = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    const scope = { businessId: business.id, userId: user.id };
    const all = await offlineActionQueue.list(scope);
    setQueue(all.filter((a) => ACTIVE_QUEUE_STATUSES.includes(a.status)));
    setLogs(await listSyncLogs(50));
    setConflicts(await listPendingConflicts());
  }, [business?.id, user?.id]);

  const refreshServerHistory = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setHistoryError(null);
    try {
      const response = await fetch(
        `/api/offline-sync/history?user_id=${encodeURIComponent(user.id)}&limit=50`,
        { credentials: 'include' }
      );
      const data = await safeJsonParse<ServerReplayHistory & { error?: string }>(
        response
      );
      if (!response.ok) {
        setHistoryError(data?.error ?? 'Failed to load server replay history');
        setServerHistory(null);
        return;
      }
      setServerHistory(data);
    } catch {
      setHistoryError('Failed to load server replay history');
      setServerHistory(null);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    void refreshLocal();
    void refreshServerHistory();
  }, [
    refreshLocal,
    refreshServerHistory,
    pendingActionCount,
    isSyncing,
  ]);

  const handleRetry = async (actionId: string) => {
    await offlineActionQueue.retryAction(actionId);
    await refreshLocal();
    void triggerSync();
  };

  const manualReviewQueue =
    queue.filter((a) => a.status === 'manual_review').length +
    (serverHistory?.metrics.manualReview ?? 0);

  const catalogStorageLabel =
    catalogStorageBackend === 'sqlite'
      ? 'SQLite (phone app)'
      : catalogStorageBackend === 'indexeddb' && isCapacitorNative()
        ? 'IndexedDB (SQLite unavailable — using browser storage)'
        : catalogStorageBackend === 'indexeddb'
          ? 'IndexedDB (web browser)'
          : 'Detecting…';

  return (
    <div className={STACK_PAGE_CLASS}>
      <h1 className="list-page-h1">Offline sync</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Download items and customers for offline billing, and view queue diagnostics.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold text-text-primary">Connectivity</h2>
          <p className="mt-2 text-sm">State: {connectivity.state}</p>
          <p className="text-sm">Pending: {pendingActionCount}</p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => void triggerSync()}
            disabled={isSyncing}
          >
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold text-text-primary">Offline catalog</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Local item and customer search for billing without network.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-text-secondary">
            <li>Storage: {catalogStorageLabel}</li>
            <li>Ready: {catalogStatus?.ready ? 'Yes' : 'No'}</li>
            <li>Items cached: {catalogStatus?.itemCount ?? 0}</li>
            <li>Customers cached: {catalogStatus?.customerCount ?? 0}</li>
            <li>
              Last full sync:{' '}
              {catalogStatus?.lastFullSyncAt
                ? formatLastSyncedLabel(catalogStatus.lastFullSyncAt)
                : '—'}
            </li>
            {catalogProgress?.message && (
              <li className="text-text-primary">{catalogProgress.message}</li>
            )}
            {catalogError && (
              <li className="text-red-600">
                {catalogError}
                {catalogError.includes('SQLite') && (
                  <span className="block mt-1 text-text-secondary">
                    Tap Full re-download again — the app will use IndexedDB instead.
                  </span>
                )}
              </li>
            )}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void triggerDeltaSync()}
              disabled={isCatalogSyncing}
            >
              {isCatalogSyncing ? 'Syncing catalog…' : 'Delta sync catalog'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void triggerFullSync()}
              disabled={isCatalogSyncing}
            >
              Full re-download
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold text-text-primary">Client sync metrics</h2>
          <ul className="mt-2 space-y-1 text-sm text-text-secondary">
            <li>Processed: {metrics.totalProcessed}</li>
            <li>Succeeded: {metrics.totalSucceeded}</li>
            <li>Failed: {metrics.totalFailed}</li>
            <li>Manual review: {metrics.totalManualReview}</li>
            <li>Duplicates prevented: {metrics.totalDuplicatesPrevented}</li>
            <li>Conflicts: {metrics.totalConflicts}</li>
            <li>
              Last run:{' '}
              {metrics.lastRunAt
                ? formatLastSyncedLabel(metrics.lastRunAt)
                : '—'}
            </li>
            {metrics.lastRunDurationMs != null && (
              <li>Last duration: {metrics.lastRunDurationMs}ms</li>
            )}
          </ul>
        </section>
      </div>

      {manualReviewQueue > 0 && (
        <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Manual review required</h2>
          <p className="mt-1 text-sm text-amber-800">
            {manualReviewQueue} action(s) need accountant review before books can
            be updated. GST conflicts are never auto-merged.
          </p>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold text-text-primary">Local action queue</h2>
        {queue.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">No pending actions.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {queue.map((a) => (
              <li
                key={a.id}
                className="rounded border border-border bg-background p-3 text-xs font-mono"
              >
                <div className={statusBadgeClass(a.status)}>
                  #{a.sequence} {a.type} — {a.status}
                </div>
                <div className="mt-1 text-text-muted break-all">
                  {a.idempotencyKey}
                </div>
                {a.lastError && (
                  <div className="mt-1 text-red-600">{a.lastError}</div>
                )}
                {(a.status === 'failed' || a.status === 'manual_review') && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => void handleRetry(a.id)}
                  >
                    Retry sync
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-text-primary">Server replay history</h2>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void refreshServerHistory()}
          >
            Refresh
          </Button>
        </div>
        {historyError && (
          <p className="mt-2 text-sm text-red-600">{historyError}</p>
        )}
        {serverHistory && (
          <>
            <ul className="mt-3 flex flex-wrap gap-3 text-sm text-text-secondary">
              <li>Completed: {serverHistory.metrics.completed}</li>
              <li>Failed: {serverHistory.metrics.failed}</li>
              <li>Manual review: {serverHistory.metrics.manualReview}</li>
              <li>
                Duplicates prevented: {serverHistory.metrics.duplicatesPrevented}
              </li>
              <li>
                Invoice mappings:{' '}
                {(serverHistory.metrics as { invoice_number_mappings?: number })
                  .invoice_number_mappings ?? 0}
              </li>
              <li>
                GST conflicts:{' '}
                {serverHistory.metrics.gst_conflicts ??
                  serverHistory.metrics.manualReview}
              </li>
            </ul>
            {serverHistory.logs.length === 0 ? (
              <p className="mt-2 text-sm text-text-secondary">
                No server replay records yet.
              </p>
            ) : (
              <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {serverHistory.logs.map((row) => (
                  <li
                    key={row.id}
                    className="rounded border border-border bg-background p-3 text-xs font-mono"
                  >
                    <div className={statusBadgeClass(row.status)}>
                      {row.action_type} — {row.status}
                    </div>
                    <div className="mt-1 break-all text-text-muted">
                      {row.idempotency_key}
                    </div>
                    <div className="mt-1 text-text-secondary">
                      Attempts: {row.replay_attempts}
                      {row.entity_id ? ` · entity ${row.entity_id}` : ''}
                    </div>
                    {row.error_message && (
                      <div className="mt-1 text-amber-700">{row.error_message}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(serverHistory.invoice_number_mappings?.length ?? 0) > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Offline → final invoice numbers
                </h3>
                <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                  {serverHistory.invoice_number_mappings!.map((m) => (
                    <li
                      key={m.id}
                      className="rounded border border-border bg-background p-2 text-xs font-mono"
                    >
                      <span className="text-text-muted">{m.offline_reference_number}</span>
                      <span className="mx-2 text-text-secondary">→</span>
                      <span className="font-semibold text-text-primary">
                        {m.final_invoice_number}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {conflicts.length > 0 && (
        <section className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-900">Pending conflicts</h2>
          <pre className="mt-2 overflow-auto text-xs">
            {JSON.stringify(conflicts, null, 2)}
          </pre>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold text-text-primary">Recent sync log</h2>
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs font-mono">
          {logs.map((l) => (
            <li key={l.id}>
              [{new Date(l.at).toISOString()}] {l.level} {l.event}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
