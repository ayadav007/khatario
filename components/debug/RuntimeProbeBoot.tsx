'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useCatalogSyncEngine } from '@/contexts/CatalogSyncContext';
import {
  installRuntimeWakeupProbe,
  isRuntimeProbeEnabled,
  markRuntimeIdlePhase,
} from '@/lib/debug/runtime-isolation';

/** Dashboard idle phase starts after sync completes + settle delay. */
const IDLE_SETTLE_MS = 5_000;

/**
 * Installs wakeup counters and marks idle phase on Dashboard once catalog sync is done.
 */
export function RuntimeProbeBoot() {
  const pathname = usePathname();
  const { isSyncing } = useCatalogSyncEngine();

  useEffect(() => {
    installRuntimeWakeupProbe();
  }, []);

  useEffect(() => {
    if (!isRuntimeProbeEnabled()) return;
    const onDashboard = pathname === '/dashboard' || pathname?.startsWith('/dashboard/');
    if (!onDashboard || isSyncing) return;

    const timer = window.setTimeout(() => {
      markRuntimeIdlePhase();
    }, IDLE_SETTLE_MS);

    return () => window.clearTimeout(timer);
  }, [pathname, isSyncing]);

  return null;
}
