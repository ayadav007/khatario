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
import { isCapacitorNative } from '@/lib/capacitor/platform';
import { dispatchNetworkReconnect } from '@/lib/network/events';
import {
  readBrowserOnline,
  setAppOnlineState,
} from '@/lib/network/offline-state';
import { probeServerReachable } from '@/lib/network/connectivity-probe';
import {
  markCapacitorNetworkReady,
} from '@/lib/auth/should-trust-cached-session';

export interface NetworkStatusContextValue {
  isOnline: boolean;
  isOffline: boolean;
  /** False on native until Capacitor Network reports status (avoids auth race). */
  networkReady: boolean;
  lastChangedAt?: number;
}

const NetworkStatusContext = createContext<NetworkStatusContextValue | undefined>(
  undefined
);

function resolveInitialOnline(): boolean {
  const hint = readBrowserOnline();
  setAppOnlineState(hint);
  return hint;
}

/** Capacitor Network plugin can report offline while the WebView still has internet. */
function reconcileNativeOnline(capacitorConnected: boolean): boolean {
  if (capacitorConnected) return true;
  return readBrowserOnline();
}

async function confirmOnlineWithProbe(
  applyOnlineState: (online: boolean, source: string) => void
): Promise<void> {
  const reachable = await probeServerReachable();
  if (reachable) {
    applyOnlineState(true, 'server-probe');
  }
}

export function NetworkStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOnline, setIsOnline] = useState(resolveInitialOnline);
  const [networkReady, setNetworkReady] = useState(!isCapacitorNative());
  const [lastChangedAt, setLastChangedAt] = useState<number | undefined>();
  const isOnlineRef = useRef(isOnline);

  const applyOnlineState = useCallback((online: boolean, source: string) => {
    if (isOnlineRef.current === online) return;

    const wasOffline = !isOnlineRef.current;
    isOnlineRef.current = online;
    setAppOnlineState(online);
    setIsOnline(online);
    setLastChangedAt(Date.now());

    if (online && wasOffline) {
      console.info('[NetworkStatus] Reconnected (%s)', source);
      dispatchNetworkReconnect();
    } else if (!online) {
      console.info('[NetworkStatus] Offline (%s)', source);
    }
  }, []);

  useEffect(() => {
    setAppOnlineState(isOnlineRef.current);

    const handleBrowserOnline = () => applyOnlineState(true, 'browser-online');
    const handleBrowserOffline = () => applyOnlineState(false, 'browser-offline');

    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);

    let cancelled = false;
    let removeNativeListener: (() => void) | undefined;

    if (isCapacitorNative()) {
      void import('@capacitor/network')
        .then(({ Network }) => Network.getStatus())
        .then(async (status) => {
          if (cancelled) return;
          markCapacitorNetworkReady();
          setNetworkReady(true);
          const online = reconcileNativeOnline(status.connected);
          applyOnlineState(online, 'capacitor-initial');
          if (!online) {
            await confirmOnlineWithProbe(applyOnlineState);
          }
        })
        .catch((error) => {
          console.warn('[NetworkStatus] Capacitor Network.getStatus failed:', error);
          markCapacitorNetworkReady();
          setNetworkReady(true);
          applyOnlineState(readBrowserOnline(), 'capacitor-error-fallback');
          void confirmOnlineWithProbe(applyOnlineState);
        });

      void import('@capacitor/network')
        .then(({ Network }) =>
          Network.addListener('networkStatusChange', (status) => {
            const online = reconcileNativeOnline(status.connected);
            applyOnlineState(online, 'capacitor-change');
            if (!online) {
              void confirmOnlineWithProbe(applyOnlineState);
            }
          })
        )
        .then((handle) => {
          if (cancelled) {
            void handle.remove();
            return;
          }
          removeNativeListener = () => {
            void handle.remove();
          };
        })
        .catch((error) => {
          console.warn('[NetworkStatus] Capacitor Network listener failed:', error);
        });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
      removeNativeListener?.();
    };
  }, [applyOnlineState]);

  const value = useMemo<NetworkStatusContextValue>(
    () => ({
      isOnline,
      isOffline: !isOnline,
      networkReady,
      lastChangedAt,
    }),
    [isOnline, networkReady, lastChangedAt]
  );

  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

export function useNetworkStatusContext(): NetworkStatusContextValue {
  const context = useContext(NetworkStatusContext);
  if (!context) {
    throw new Error('useNetworkStatus must be used within NetworkStatusProvider');
  }
  return context;
}
