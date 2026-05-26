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
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { NETWORK_RECONNECT_EVENT } from '@/lib/network/events';
import type { ConnectivityState, TenantScope } from '@/lib/offline/types';
import {
  buildConnectivitySnapshot,
  deriveConnectivityState,
  type ConnectivitySnapshot,
} from '@/lib/offline/connectivity/state-machine';
import { migrateLocalStorageToIndexedDb } from '@/lib/offline/migration/migrate-local-storage';
import { registerDefaultOfflineExecutors } from '@/lib/offline/sync/register-default-executors';
import {
  refreshSyncMetaCounts,
} from '@/lib/offline/repositories/sync-meta-repository';
import {
  isSyncEngineRunning,
  runSyncEngine,
} from '@/lib/offline/sync/sync-engine';
import { getSyncMetrics } from '@/lib/offline/observability/sync-metrics';
import { saveAuthSessionHint } from '@/lib/offline/storage/preferences-store';

interface OfflineSyncContextValue {
  connectivity: ConnectivitySnapshot;
  pendingActionCount: number;
  failedActionCount: number;
  lastSuccessfulSyncAt: number | null;
  isSyncing: boolean;
  triggerSync: () => Promise<void>;
  refreshCounts: () => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncContextValue | undefined>(
  undefined
);

export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const { business, user } = useAuth();
  const { isOnline, isOffline, lastChangedAt } = useNetworkStatus();
  const [connectivityState, setConnectivityState] =
    useState<ConnectivityState>('online');
  const [pendingActionCount, setPendingActionCount] = useState(0);
  const [failedActionCount, setFailedActionCount] = useState(0);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<number | null>(
    null
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [stateChangedAt, setStateChangedAt] = useState<number | null>(null);
  const migratedRef = useRef(false);

  const scope: TenantScope | null =
    business?.id && user?.id
      ? { businessId: business.id, userId: user.id }
      : null;

  const refreshCounts = useCallback(async () => {
    if (!scope) return;
    try {
      const meta = await refreshSyncMetaCounts(scope);
      setPendingActionCount(meta.pendingActionCount);
      setFailedActionCount(meta.failedActionCount);
      setLastSuccessfulSyncAt(meta.lastSuccessfulSyncAt);
    } catch {
      /* IDB may be unavailable in SSR/tests */
    }
  }, [scope?.businessId, scope?.userId]);

  const applyConnectivity = useCallback(
    (syncing: boolean) => {
      const next = deriveConnectivityState({
        browserOnline: isOnline,
        pendingActions: pendingActionCount,
        isSyncing: syncing,
      });
      setConnectivityState((prev) => {
        if (prev !== next) setStateChangedAt(Date.now());
        return next;
      });
    },
    [isOnline, pendingActionCount]
  );

  const triggerSync = useCallback(async () => {
    if (!scope || isOffline || isSyncEngineRunning()) return;
    setIsSyncing(true);
    applyConnectivity(true);
    try {
      setConnectivityState('syncing');
      await runSyncEngine(scope);
      await refreshCounts();
    } finally {
      setIsSyncing(false);
      applyConnectivity(false);
    }
  }, [scope, isOffline, applyConnectivity, refreshCounts]);

  useEffect(() => {
    applyConnectivity(isSyncing);
  }, [isOnline, pendingActionCount, isSyncing, applyConnectivity]);

  useEffect(() => {
    registerDefaultOfflineExecutors();
  }, []);

  useEffect(() => {
    if (!scope || migratedRef.current) return;
    migratedRef.current = true;
    void migrateLocalStorageToIndexedDb(scope).then(() => refreshCounts());
    void saveAuthSessionHint({
      businessId: scope.businessId,
      userId: scope.userId,
      lastRoute:
        typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }, [scope, refreshCounts]);

  useEffect(() => {
    if (!scope) return;
    void refreshCounts();
  }, [scope, refreshCounts]);

  useEffect(() => {
    if (!scope || isOffline) return;

    const onReconnect = () => {
      setConnectivityState('reconnecting');
      setStateChangedAt(Date.now());
      void triggerSync();
    };

    window.addEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
    return () => window.removeEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
  }, [scope, isOffline, triggerSync]);

  useEffect(() => {
    if (!scope || isOffline) return;
    const interval = setInterval(() => {
      if (pendingActionCount > 0 && !isSyncEngineRunning()) {
        void triggerSync();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [scope, isOffline, pendingActionCount, triggerSync]);

  const connectivity = useMemo(
    () =>
      buildConnectivitySnapshot(
        connectivityState,
        stateChangedAt ?? lastChangedAt ?? null
      ),
    [connectivityState, stateChangedAt, lastChangedAt]
  );

  const value = useMemo<OfflineSyncContextValue>(
    () => ({
      connectivity,
      pendingActionCount,
      failedActionCount,
      lastSuccessfulSyncAt,
      isSyncing,
      triggerSync,
      refreshCounts,
    }),
    [
      connectivity,
      pendingActionCount,
      failedActionCount,
      lastSuccessfulSyncAt,
      isSyncing,
      triggerSync,
      refreshCounts,
    ]
  );

  return (
    <OfflineSyncContext.Provider value={value}>
      {children}
    </OfflineSyncContext.Provider>
  );
}

export function useOfflineSync(): OfflineSyncContextValue {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) {
    throw new Error('useOfflineSync must be used within OfflineSyncProvider');
  }
  return ctx;
}

export function useConnectivityState(): ConnectivitySnapshot {
  return useOfflineSync().connectivity;
}

/** For debug/settings pages. */
export function useSyncDiagnostics() {
  return {
    metrics: getSyncMetrics(),
  };
}
