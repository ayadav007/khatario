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

export function CatalogSyncProvider({ children }: { children: React.ReactNode }) {
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const { isOnline } = useNetworkStatus();
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<CatalogSyncProgress | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const bootSyncKeyRef = useRef<string | null>(null);

  const scope: TenantScope | null =
    business?.id && user?.id ? { businessId: business.id, userId: user.id } : null;

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
  }, [scope?.businessId, scope?.userId]);

  const runSync = useCallback(
    async (mode: 'full' | 'delta') => {
      if (!scope || !user?.id || !isOnline || syncingRef.current) return;
      syncingRef.current = true;
      setIsSyncing(true);
      setLastError(null);
      setProgress({ phase: 'idle', itemsSynced: 0, customersSynced: 0 });
      try {
        const options = {
          scope,
          userId: user.id,
          stockScope,
          onProgress: setProgress,
        };
        if (mode === 'full') {
          await runFullCatalogSync(options);
        } else {
          await runDeltaCatalogSync(options);
        }
        await refreshStatus();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Catalog sync failed';
        setLastError(message);
        setProgress((p) =>
          p ? { ...p, phase: 'error', message } : { phase: 'error', itemsSynced: 0, customersSynced: 0, message }
        );
      } finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [scope, user?.id, isOnline, stockScope, refreshStatus]
  );

  const triggerFullSync = useCallback(async () => {
    await runSync('full');
  }, [runSync]);

  const triggerDeltaSync = useCallback(async () => {
    await runSync('delta');
  }, [runSync]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!scope || !isOnline || !user?.id) return;
    const bootKey = `${scope.businessId}:${scope.userId}`;
    if (bootSyncKeyRef.current === bootKey) return;
    bootSyncKeyRef.current = bootKey;
    void (async () => {
      const current = await getCatalogStatus(scope);
      await runSync(current.ready ? 'delta' : 'full');
    })();
  }, [scope?.businessId, scope?.userId, user?.id, isOnline, runSync]);

  useEffect(() => {
    if (!scope || !isOnline) return;
    const onReconnect = () => {
      void runSync('delta');
    };
    window.addEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
    return () => window.removeEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
  }, [scope?.businessId, scope?.userId, isOnline, runSync]);

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
