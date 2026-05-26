'use client';

import { WifiOff } from 'lucide-react';
import { clsx } from 'clsx';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useStaleDataStatus } from '@/components/system/StaleDataBanner';

/**
 * Sticky offline indicator — non-blocking, slides in when connectivity is lost.
 */
export function NetworkStatusBanner() {
  const { isOffline } = useNetworkStatus();
  const { isShowingStaleData, lastSyncedLabel } = useStaleDataStatus();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!isOffline}
      className={clsx(
        'sticky top-0 z-[60] overflow-hidden border-b border-amber-200 bg-amber-50 transition-[max-height,opacity,transform] duration-300 ease-out',
        isOffline
          ? 'max-h-28 translate-y-0 opacity-100'
          : 'pointer-events-none max-h-0 -translate-y-full opacity-0'
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 text-amber-900">
        <WifiOff className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">No internet connection</p>
          <p className="text-xs leading-snug text-amber-800/90">
            {isShowingStaleData && lastSyncedLabel
              ? `Showing last synced data · ${lastSyncedLabel}`
              : 'Some features may be unavailable'}
          </p>
        </div>
      </div>
    </div>
  );
}
