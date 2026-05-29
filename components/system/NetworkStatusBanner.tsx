'use client';

import { WifiOff } from 'lucide-react';
import { clsx } from 'clsx';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineBanner } from '@/contexts/OfflineBannerContext';

/**
 * Single sticky offline bar — light red, no retry, optional 2s blocked flash.
 */
export function NetworkStatusBanner() {
  const { isOffline } = useNetworkStatus();
  const { message } = useOfflineBanner();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!isOffline}
      className={clsx(
        'sticky top-0 z-[60] overflow-hidden transition-[max-height,opacity] duration-300 ease-out',
        isOffline
          ? 'max-h-14 opacity-100'
          : 'pointer-events-none max-h-0 opacity-0'
      )}
    >
      <div className="bg-red-400 px-4 py-2.5 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2.5">
          <WifiOff className="h-4 w-4 shrink-0 text-white" aria-hidden />
          <p className="text-center text-sm font-medium text-white">{message}</p>
        </div>
      </div>
    </div>
  );
}
