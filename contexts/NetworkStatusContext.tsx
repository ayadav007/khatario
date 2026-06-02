'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';

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
import { probeNetworkReconnectDispatched } from '@/lib/debug/dashboard-refresh-probe';
import {
  markCapacitorNetworkReady,
} from '@/lib/auth/should-trust-cached-session';

/** Debounce reconnect side-effects — avoids flap → full-app refresh storms on mobile. */
const RECONNECT_DISPATCH_DEBOUNCE_MS = 5_000;

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
  useRenderLoopProbe('NetworkStatusProvider');
  const [isOnline, setIsOnline] = useState(resolveInitialOnline);
  const [networkReady, setNetworkReady] = useState(!isCapacitorNative());
  const [lastChangedAt, setLastChangedAt] = useState<number | undefined>();
  const isOnlineRef = useRef(isOnline);
  const reconnectDispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReconnectDispatch = useCallback((source: string) => {
    if (reconnectDispatchTimerRef.current) {
      clearTimeout(reconnectDispatchTimerRef.current);
    }
    reconnectDispatchTimerRef.current = setTimeout(() => {
      reconnectDispatchTimerRef.current = null;
      if (!isOnlineRef.current) return;
      console.info('[NetworkStatus] Reconnected (%s)', source);
      probeNetworkReconnectDispatched(source);
      dispatchNetworkReconnect();
    }, RECONNECT_DISPATCH_DEBOUNCE_MS);
  }, []);

  const applyOnlineState = useCallback((online: boolean, source: string) => {
    if (isOnlineRef.current === online) return;

    const wasOffline = !isOnlineRef.current;
    isOnlineRef.current = online;
    setAppOnlineState(online);
    setIsOnline(online);
    setLastChangedAt(Date.now());

    if (online && wasOffline) {
      console.info('[NetworkStatus] Online transition (%s), debouncing reconnect handlers', source);
      scheduleReconnectDispatch(source);
    } else if (!online) {
      if (reconnectDispatchTimerRef.current) {
        clearTimeout(reconnectDispatchTimerRef.current);
        reconnectDispatchTimerRef.current = null;
      }
      console.info('[NetworkStatus] Offline (%s)', source);
    }
  }, [scheduleReconnectDispatch]);

  const applyOnlineStateRef = useRef(applyOnlineState);
  applyOnlineStateRef.current = applyOnlineState;

  useEffect(() => {
    setAppOnlineState(isOnlineRef.current);

    const handleBrowserOnline = () => applyOnlineStateRef.current(true, 'browser-online');
    const handleBrowserOffline = () => applyOnlineStateRef.current(false, 'browser-offline');

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
          applyOnlineStateRef.current(online, 'capacitor-initial');
          if (!online) {
            await confirmOnlineWithProbe((o, s) => applyOnlineStateRef.current(o, s));
          }
        })
        .catch((error) => {
          console.warn('[NetworkStatus] Capacitor Network.getStatus failed:', error);
          markCapacitorNetworkReady();
          setNetworkReady(true);
          applyOnlineStateRef.current(readBrowserOnline(), 'capacitor-error-fallback');
          void confirmOnlineWithProbe((o, s) => applyOnlineStateRef.current(o, s));
        });

      void import('@capacitor/network')
        .then(({ Network }) =>
          Network.addListener('networkStatusChange', (status) => {
            const online = reconcileNativeOnline(status.connected);
            applyOnlineStateRef.current(online, 'capacitor-change');
            if (!online) {
              void confirmOnlineWithProbe((o, s) => applyOnlineStateRef.current(o, s));
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
      if (reconnectDispatchTimerRef.current) {
        clearTimeout(reconnectDispatchTimerRef.current);
        reconnectDispatchTimerRef.current = null;
      }
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
      removeNativeListener?.();
    };
  }, []);

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
