'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { NETWORK_RECONNECT_EVENT } from '@/lib/network/events';
import { getCatalogStatus } from '@/lib/offline/catalog/client-search';
import {
  runDeltaCatalogSync,
  runFullCatalogSync,
} from '@/lib/offline/catalog/sync/catalog-sync';
import type {
  CatalogStatus,
  CatalogSyncProgress,
} from '@/lib/offline/catalog/types';
import type { TenantScope } from '@/lib/offline/types';

interface CatalogSyncContextValue {
  status: CatalogStatus | null;
  isSyncing: boolean;
  progress: CatalogSyncProgress | null;
  lastError: string | null;
  triggerFullSync: () => Promise<void>;
  triggerDeltaSync: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const CatalogSyncContext = createContext<CatalogSyncContextValue | undefined>(
  undefined
);

/** Minimum gap between automatic background delta syncs (ms). */
const MIN_AUTO_DELTA_MS = 60_000;

export function CatalogSyncProvider({ children }: { children: React.ReactNode }) {
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const { isOnline } = useNetworkStatus();
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<CatalogSyncProgress | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const lastAutoSyncAtRef = useRef(0);
  const bootScopeKeyRef = useRef<string | null>(null);

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
      setStatus(await getCatalogStatus(scope));
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
      setProgress({ phase: 'idle', itemsSynced: 0, customersSynced: 0, invoicesSynced: 0 });

      try {
        const syncOptions = {
          scope,
          userId: user.id,
          stockScope,
          onProgress: setProgress,
        };
        if (mode === 'full') {
          await runFullCatalogSync(syncOptions);
        } else {
          await runDeltaCatalogSync(syncOptions);
        }
        await refreshStatus();
        setProgress(null);
        if (!options?.manual) {
          lastAutoSyncAtRef.current = Date.now();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Catalog sync failed';
        setLastError(message);
        setProgress((p) =>
          p
            ? { ...p, phase: 'error', message }
            : { phase: 'error', itemsSynced: 0, customersSynced: 0, invoicesSynced: 0, message }
        );
      } finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [scope, user?.id, isOnline, stockScope, refreshStatus]
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

  /** One automatic sync per tenant when coming online — not on every render. */
  useEffect(() => {
    if (!scope || !isOnline || !user?.id) return;
    const bootKey = `${scope.businessId}:${scope.userId}`;
    if (bootScopeKeyRef.current === bootKey) return;
    bootScopeKeyRef.current = bootKey;

    void (async () => {
      const current = await getCatalogStatus(scope);
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

  const value = useMemo(
    () => ({
      status,
      isSyncing,
      progress,
      lastError,
      triggerFullSync,
      triggerDeltaSync,
      refreshStatus,
    }),
    [
      status,
      isSyncing,
      progress,
      lastError,
      triggerFullSync,
      triggerDeltaSync,
      refreshStatus,
    ]
  );

  return (
    <CatalogSyncContext.Provider value={value}>{children}</CatalogSyncContext.Provider>
  );
}

export function useCatalogSync(): CatalogSyncContextValue {
  const ctx = useContext(CatalogSyncContext);
  if (!ctx) {
    throw new Error('useCatalogSync must be used within CatalogSyncProvider');
  }
  return ctx;
}
