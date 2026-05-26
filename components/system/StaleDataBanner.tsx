'use client';

import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/contexts/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { loadCapabilitySnapshot } from '@/lib/capability-snapshot';
import { getLastAppSyncAt, formatLastSyncedLabel } from '@/lib/sync-timestamp';

export interface StaleDataStatus {
  isShowingStaleData: boolean;
  lastSyncedAt: number | null;
  lastSyncedLabel: string | null;
}

/**
 * Derives stale-data state from offline status + cached snapshots.
 */
export function useStaleDataStatus(): StaleDataStatus {
  const { isOffline } = useNetworkStatus();
  const { business, user } = useAuth();

  return useMemo(() => {
    if (!isOffline) {
      return {
        isShowingStaleData: false,
        lastSyncedAt: null,
        lastSyncedLabel: null,
      };
    }

    const globalSync = getLastAppSyncAt();
    const capability =
      business?.id && user?.id
        ? loadCapabilitySnapshot(business.id, user.id)
        : null;
    const capabilityTs = capability?.timestamp ?? null;

    const lastSyncedAt =
      globalSync && capabilityTs
        ? Math.max(globalSync, capabilityTs)
        : globalSync ?? capabilityTs;

    const hasCachedData = Boolean(lastSyncedAt);

    return {
      isShowingStaleData: hasCachedData,
      lastSyncedAt,
      lastSyncedLabel: formatLastSyncedLabel(lastSyncedAt),
    };
  }, [isOffline, business?.id, user?.id]);
}

/**
 * Shows when offline content is served from local cache.
 */
export function StaleDataBanner() {
  const { isOffline } = useNetworkStatus();
  const { isShowingStaleData, lastSyncedLabel } = useStaleDataStatus();

  if (!isOffline || !isShowingStaleData) return null;

  return (
    <div
      role="status"
      className={clsx(
        'border-b border-blue-200 bg-blue-50 px-4 py-2 text-blue-900',
        'mx-auto w-full max-w-7xl'
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <Clock className="h-4 w-4 shrink-0 text-blue-700" aria-hidden />
        <p>
          <span className="font-semibold">Showing last synced data</span>
          {lastSyncedLabel ? (
            <span className="text-blue-800/90"> · Last sync {lastSyncedLabel}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
