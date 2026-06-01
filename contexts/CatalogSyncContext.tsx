'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { NETWORK_RECONNECT_EVENT } from '@/lib/network/events';
import { getCatalogStatus } from '@/lib/offline/catalog/client-search';
import { withSqliteLabel } from '@/lib/debug/sqlite-probe';
import {
  getCatalogSyncProgressSnapshot,
  setCatalogSyncProgress,
  subscribeCatalogSyncProgress,
} from '@/lib/offline/catalog/catalog-sync-progress-store';
import {
  runDeltaCatalogSync,
  runFullCatalogSync,
} from '@/lib/offline/catalog/sync/catalog-sync';
import type {
  CatalogStatus,
  CatalogSyncProgress,
} from '@/lib/offline/catalog/types';
import type { TenantScope } from '@/lib/offline/types';

/** Stable engine API — no high-frequency progress in this context. */
export interface CatalogSyncEngineContextValue {
  status: CatalogStatus | null;
  isSyncing: boolean;
  lastError: string | null;
  triggerFullSync: () => Promise<void>;
  triggerDeltaSync: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

/** Full API including progress (settings / debug UI). */
export interface CatalogSyncContextValue extends CatalogSyncEngineContextValue {
  progress: CatalogSyncProgress | null;
}

const CatalogSyncEngineContext = createContext<CatalogSyncEngineContextValue | undefined>(
  undefined
);

/** Minimum gap between automatic background delta syncs (ms). */
const MIN_AUTO_DELTA_MS = 60_000;
/** Throttle progress store writes within the same phase. */
const PROGRESS_THROTTLE_MS = 750;
const PROGRESS_SAME_PHASE_MS = 3_000;

export function CatalogSyncProvider({ children }: { children: React.ReactNode }) {
  useRenderLoopProbe('CatalogSyncProvider');
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const { isOnline } = useNetworkStatus();
  const [status, setStatus] = React.useState<CatalogStatus | null>(null);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const syncingRef = useRef(false);
  const lastAutoSyncAtRef = useRef(0);
  const bootScopeKeyRef = useRef<string | null>(null);
  const progressThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgressRef = useRef<CatalogSyncProgress | null>(null);
  const lastProgressEmitRef = useRef(0);
  const lastProgressPhaseRef = useRef<CatalogSyncProgress['phase']>('idle');

  const publishProgress = useCallback((next: CatalogSyncProgress | null) => {
    setCatalogSyncProgress(next);
  }, []);

  const setProgressThrottled = useCallback((next: CatalogSyncProgress) => {
    pendingProgressRef.current = next;
    const phaseChanged = next.phase !== lastProgressPhaseRef.current;
    const terminal = next.phase === 'done' || next.phase === 'error';
    const now = Date.now();
    const dueSamePhase = now - lastProgressEmitRef.current >= PROGRESS_SAME_PHASE_MS;

    const flush = () => {
      const pending = pendingProgressRef.current;
      if (!pending) return;
      lastProgressPhaseRef.current = pending.phase;
      lastProgressEmitRef.current = Date.now();
      publishProgress(pending);
      pendingProgressRef.current = null;
    };

    if (phaseChanged || terminal || dueSamePhase) {
      if (progressThrottleRef.current) {
        clearTimeout(progressThrottleRef.current);
        progressThrottleRef.current = null;
      }
      flush();
      return;
    }

    if (progressThrottleRef.current) return;
    progressThrottleRef.current = setTimeout(() => {
      progressThrottleRef.current = null;
      flush();
    }, PROGRESS_THROTTLE_MS);
  }, [publishProgress]);

  const scope: TenantScope | null = useMemo(
    () =>
      business?.id && user?.id
        ? { businessId: business.id, userId: user.id }
        : null,
    [business?.id, user?.id]
  );

  const stockScope = useMemo(
    () => ({
      branchId: currentBranchId !== 'ALL' ? currentBranchId : null,
    }),
    [currentBranchId]
  );

  const refreshStatus = useCallback(async () => {
    if (!scope) {
      setStatus(null);
      return;
    }
    try {
      setStatus(await withSqliteLabel('catalog-sync/status', () => getCatalogStatus(scope)));
    } catch {
      setStatus(null);
    }
  }, [scope]);

  const runSync = useCallback(
    async (mode: 'full' | 'delta', options?: { manual?: boolean }) => {
      if (!scope || !user?.id || !isOnline || syncingRef.current) return;

      const now = Date.now();
      if (
        !options?.manual &&
        mode === 'delta' &&
        now - lastAutoSyncAtRef.current < MIN_AUTO_DELTA_MS
      ) {
        return;
      }

      syncingRef.current = true;
      setIsSyncing(true);
      setLastError(null);
      publishProgress({
        phase: 'idle',
        itemsSynced: 0,
        customersSynced: 0,
        invoicesSynced: 0,
      });

      try {
        const syncOptions = {
          scope,
          userId: user.id,
          stockScope,
          onProgress: setProgressThrottled,
        };
        if (mode === 'full') {
          await runFullCatalogSync(syncOptions);
        } else {
          await runDeltaCatalogSync(syncOptions);
        }
        await refreshStatus();
        publishProgress(null);
        if (!options?.manual) {
          lastAutoSyncAtRef.current = Date.now();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Catalog sync failed';
        setLastError(message);
        publishProgress({
          phase: 'error',
          itemsSynced: pendingProgressRef.current?.itemsSynced ?? 0,
          customersSynced: pendingProgressRef.current?.customersSynced ?? 0,
          invoicesSynced: pendingProgressRef.current?.invoicesSynced ?? 0,
          message,
        });
      } finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [scope, user?.id, isOnline, stockScope, refreshStatus, setProgressThrottled, publishProgress]
  );

  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;

  const triggerFullSync = useCallback(async () => {
    await runSync('full', { manual: true });
  }, [runSync]);

  const triggerDeltaSync = useCallback(async () => {
    await runSync('delta', { manual: true });
  }, [runSync]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!scope || !isOnline || !user?.id) return;
    const bootKey = `${scope.businessId}:${scope.userId}`;
    if (bootScopeKeyRef.current === bootKey) return;
    bootScopeKeyRef.current = bootKey;

    void (async () => {
      const current = await withSqliteLabel('catalog-sync/boot', () => getCatalogStatus(scope));
      await runSyncRef.current(current.ready ? 'delta' : 'full');
    })();
  }, [scope?.businessId, scope?.userId, user?.id, isOnline]);

  useEffect(() => {
    if (!scope) {
      bootScopeKeyRef.current = null;
    }
  }, [scope?.businessId, scope?.userId]);

  useEffect(() => {
    if (!scope || !isOnline) return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const onReconnect = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        void runSyncRef.current('delta');
      }, 2000);
    };
    window.addEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
    };
  }, [scope?.businessId, scope?.userId, isOnline]);

  const engineValue = useMemo<CatalogSyncEngineContextValue>(
    () => ({
      status,
      isSyncing,
      lastError,
      triggerFullSync,
      triggerDeltaSync,
      refreshStatus,
    }),
    [status, isSyncing, lastError, triggerFullSync, triggerDeltaSync, refreshStatus]
  );

  return (
    <CatalogSyncEngineContext.Provider value={engineValue}>
      {children}
    </CatalogSyncEngineContext.Provider>
  );
}

/** Progress only — use on settings/debug sync UI. Does not touch engine provider. */
export function useCatalogSyncProgress(): CatalogSyncProgress | null {
  return useSyncExternalStore(
    subscribeCatalogSyncProgress,
    getCatalogSyncProgressSnapshot,
    () => null
  );
}

/** Stable engine surface (no progress subscription). */
export function useCatalogSyncEngine(): CatalogSyncEngineContextValue {
  const ctx = useContext(CatalogSyncEngineContext);
  if (!ctx) {
    throw new Error('useCatalogSyncEngine must be used within CatalogSyncProvider');
  }
  return ctx;
}

/** Backward-compatible hook for settings / debug pages. */
export function useCatalogSync(): CatalogSyncContextValue {
  const engine = useCatalogSyncEngine();
  const progress = useCatalogSyncProgress();
  return useMemo(
    () => ({
      ...engine,
      progress,
    }),
    [engine, progress]
  );
}
