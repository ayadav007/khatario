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

export type OfflineBannerMode = 'default' | 'blocked';

export const OFFLINE_BANNER_DEFAULT = 'No Internet Connection Found';
export const OFFLINE_BANNER_BLOCKED =
  'This feature does not work offline';

export const OFFLINE_BLOCKED_EVENT = 'khatario-offline-blocked';

interface OfflineBannerContextValue {
  mode: OfflineBannerMode;
  message: string;
  flashBlockedFeature: () => void;
}

const OfflineBannerContext = createContext<OfflineBannerContextValue | undefined>(
  undefined
);

const BLOCKED_FLASH_MS = 2000;

export function OfflineBannerProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<OfflineBannerMode>('default');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flashBlockedFeature = useCallback(() => {
    clearTimer();
    setMode('blocked');
    timerRef.current = setTimeout(() => {
      setMode('default');
      timerRef.current = null;
    }, BLOCKED_FLASH_MS);
  }, [clearTimer]);

  useEffect(() => {
    const onBlocked = () => flashBlockedFeature();
    window.addEventListener(OFFLINE_BLOCKED_EVENT, onBlocked);
    return () => {
      window.removeEventListener(OFFLINE_BLOCKED_EVENT, onBlocked);
      clearTimer();
    };
  }, [flashBlockedFeature, clearTimer]);

  const message =
    mode === 'blocked' ? OFFLINE_BANNER_BLOCKED : OFFLINE_BANNER_DEFAULT;

  const value = useMemo(
    () => ({ mode, message, flashBlockedFeature }),
    [mode, message, flashBlockedFeature]
  );

  return (
    <OfflineBannerContext.Provider value={value}>
      {children}
    </OfflineBannerContext.Provider>
  );
}

export function useOfflineBanner(): OfflineBannerContextValue {
  const ctx = useContext(OfflineBannerContext);
  if (!ctx) {
    throw new Error('useOfflineBanner must be used within OfflineBannerProvider');
  }
  return ctx;
}

export function dispatchOfflineBlockedFlash(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OFFLINE_BLOCKED_EVENT));
}
