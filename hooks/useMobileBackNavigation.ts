'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor/platform';
import {
  getMobileBackFallback,
  isMobileBackRoot,
} from '@/lib/navigation/mobile-back-fallback';
import { runMobileBackInterceptors } from '@/lib/navigation/mobile-back-registry';

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 1023px)').matches;
}

function shouldHandleMobileBack(): boolean {
  return isCapacitorNative() || isMobileViewport();
}

let mobileBackInFlight = false;

/**
 * Navigate back in-app: interceptors first, then history.back(), then fallback route.
 */
export function performMobileBack(
  router: ReturnType<typeof useRouter>,
  pathname: string | null
): void {
  if (mobileBackInFlight) return;
  mobileBackInFlight = true;
  window.setTimeout(() => {
    mobileBackInFlight = false;
  }, 400);

  if (runMobileBackInterceptors()) return;

  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back();
    return;
  }

  const fallback = getMobileBackFallback(pathname);
  if (fallback) {
    router.push(fallback);
  }
}

/**
 * Android hardware back / swipe-back: keep users inside the app on mobile WebView.
 */
export function useMobileBackNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const historySeedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldHandleMobileBack()) return;
    if (isMobileBackRoot(pathname)) {
      historySeedRef.current = null;
      return;
    }

    const seedKey = pathname ?? '';
    if (historySeedRef.current === seedKey) return;
    historySeedRef.current = seedKey;

    try {
      window.history.pushState({ khatarioMobileBack: true }, '', window.location.href);
    } catch {
      // ignore quota / security errors
    }
  }, [pathname]);

  useEffect(() => {
    if (!shouldHandleMobileBack()) return;

    const onPopState = () => {
      performMobileBack(router, pathnameRef.current);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [router]);

  useEffect(() => {
    if (!isCapacitorNative()) return;

    let removed = false;
    let removeListener: (() => void) | undefined;

    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', () => {
          performMobileBack(router, pathnameRef.current);
        })
      )
      .then((handle) => {
        if (removed) {
          void handle.remove();
          return;
        }
        removeListener = () => {
          void handle.remove();
        };
      })
      .catch(() => {
        // @capacitor/app unavailable — popstate handler still applies
      });

    return () => {
      removed = true;
      removeListener?.();
    };
  }, [router]);
}
