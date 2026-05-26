'use client';

import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { STACK_PAGE_CLASS } from '@/lib/page-layout';

/**
 * Next.js offline fallback route — used by the service worker when navigation fails.
 */
export default function OfflinePage() {
  return (
    <div className={`${STACK_PAGE_CLASS} min-h-screen bg-background`}>
      <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50">
          <WifiOff className="h-7 w-7 text-amber-700" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">No internet connection</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Reconnect to continue syncing. If you opened Khatario before, cached pages may
          still be available.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <Button type="button" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            Open dashboard (cached)
          </Link>
        </div>
      </div>
    </div>
  );
}
