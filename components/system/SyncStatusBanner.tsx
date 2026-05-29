'use client';

import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { useOfflineSync } from '@/contexts/OfflineSyncContext';
import { connectivityLabel } from '@/lib/offline/connectivity/state-machine';

/**
 * Network-aware sync status strip (queue counts, sync progress, reconnect).
 */
export function SyncStatusBanner() {
  const {
    connectivity,
    pendingActionCount,
    failedActionCount,
    isSyncing,
    triggerSync,
  } = useOfflineSync();

  const isOffline = connectivity.state === 'offline';

  // Offline connectivity uses NetworkStatusBanner only — avoid duplicate strips.
  if (isOffline) return null;

  const showBanner =
    pendingActionCount > 0 || failedActionCount > 0;

  if (!showBanner) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'border-b px-4 py-2',
        failedActionCount > 0
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-blue-200 bg-blue-50 text-blue-900'
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {isSyncing ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : failedActionCount > 0 ? (
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="font-semibold leading-tight">
              {connectivityLabel(connectivity.state)}
            </p>
            <p className="text-xs leading-snug opacity-90">
              {pendingActionCount > 0
                ? `${pendingActionCount} action${pendingActionCount === 1 ? '' : 's'} queued`
                : `${failedActionCount} action${failedActionCount === 1 ? '' : 's'} need attention (failed or manual review)`}
            </p>
          </div>
        </div>
        {(pendingActionCount > 0 || failedActionCount > 0) && (
          <button
            type="button"
            onClick={() => void triggerSync()}
            disabled={isSyncing}
            className="shrink-0 rounded-lg border border-current px-3 py-1 text-xs font-semibold opacity-90 hover:opacity-100 disabled:opacity-50"
          >
            Sync now
          </button>
        )}
      </div>
    </div>
  );
}
