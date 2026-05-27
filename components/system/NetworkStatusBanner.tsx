'use client';

import { WifiOff, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';

type BannerContext = 'dashboard' | 'billing' | 'other';

function getContext(pathname: string | null): BannerContext {
  if (!pathname) return 'other';
  if (pathname === '/dashboard') return 'dashboard';
  if (pathname === '/invoices/new' || pathname === '/purchases/new') return 'billing';
  return 'other';
}

function getMessage(context: BannerContext) {
  switch (context) {
    case 'dashboard':
      return {
        title: 'You\'re offline',
        subtitle: 'Showing your last synced dashboard data',
      };
    case 'billing':
      return {
        title: 'You\'re offline',
        subtitle: 'Your invoice will be saved and synced when reconnected',
      };
    case 'other':
      return {
        title: 'No internet connection',
        subtitle: 'Please check your connection to access this page',
      };
  }
}

/**
 * Sticky offline notification — slides in when connectivity is lost,
 * with a message that adapts to the current page.
 */
export function NetworkStatusBanner() {
  const { isOffline } = useNetworkStatus();
  const pathname = usePathname();
  const [checking, setChecking] = useState(false);

  const context = getContext(pathname);
  const { title, subtitle } = getMessage(context);

  const handleRetry = useCallback(async () => {
    setChecking(true);
    // Small delay to show the spinner, then reload to re-check connectivity
    await new Promise((r) => setTimeout(r, 600));
    window.location.reload();
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!isOffline}
      className={clsx(
        'sticky top-0 z-[60] overflow-hidden transition-[max-height,opacity] duration-300 ease-out',
        isOffline
          ? 'max-h-20 opacity-100'
          : 'pointer-events-none max-h-0 opacity-0'
      )}
    >
      <div className="bg-gray-900 px-4 py-2.5 shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          {/* Icon + message */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative shrink-0">
              <WifiOff className="h-4 w-4 text-gray-300" aria-hidden />
              {/* Pulsing dot */}
              <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight text-white">{title}</p>
              <p className="truncate text-xs leading-snug text-gray-400">{subtitle}</p>
            </div>
          </div>

          {/* Retry button */}
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={checking}
            className={clsx(
              'shrink-0 rounded-md border border-gray-700 px-3 py-1 text-xs font-medium text-gray-300 transition-colors',
              'hover:border-gray-500 hover:text-white disabled:opacity-50'
            )}
          >
            {checking ? (
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              'Retry'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
