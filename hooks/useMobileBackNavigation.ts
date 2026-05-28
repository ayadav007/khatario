'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor/platform';
import {
  getMobileBackFallback,
  isAppExitRoot,
  isBottomNavTab,
  isNonHomeBottomNavTab,
} from '@/lib/navigation/mobile-back-fallback';
import { runMobileBackInterceptors } from '@/lib/navigation/mobile-back-registry';

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 1023px)').matches;
}

function shouldHandleMobileBack(): boolean {
  return isCapacitorNative() || isMobileViewport();
}

/**
 * True when the current browser history entry is one of our sentinel pushState
 * entries (`{ khatarioMobileBack: true }`).
 *
 * These sentinels are pushed on every non-root route so that a browser
 * swipe-back gesture (popstate) triggers our custom handler instead of
 * immediately popping the real page entry.
 *
 * On Capacitor we detect them to skip -2 in a single hardware back press.
 */
function currentStateIsSentinel(): boolean {
  try {
    return window.history.state?.khatarioMobileBack === true;
  } catch {
    return false;
  }
}

/** Module-level flag to block re-entrant back navigation. */
let mobileBackInFlight = false;

/**
 * Navigate back in-app: interceptors → history.back() → fallback route.
 *
 * Used by the browser/web popstate path (swipe-back).
 * The Capacitor hardware-back path is handled inline in useMobileBackNavigation
 * with sentinel-skip logic.
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
 * Android hardware back / browser swipe-back: keeps navigation inside the app.
 *
 * Sentinel mechanism recap
 * ─────────────────────────
 * On every non-root route, we push a duplicate `{ khatarioMobileBack: true }`
 * state on top of the real Next.js history entry.  For browser users, a swipe-back
 * pops the sentinel (URL unchanged), fires popstate, and our handler then calls
 * performMobileBack → router.back() to actually navigate.
 *
 * On Capacitor, we detect the sentinel state and call window.history.go(-2) so
 * a single hardware back press skips both the sentinel and the real entry, landing
 * on the previous page in one press.
 */
export function useMobileBackNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const historySeedRef = useRef<string | null>(null);
  const ignorePopstateUntilRef = useRef(0);

  // ── Push sentinel on route change ──────────────────────────────────────────
  useEffect(() => {
    if (!shouldHandleMobileBack()) return;
    if (isBottomNavTab(pathname)) {
      historySeedRef.current = null;
      return;
    }

    const seedKey = pathname ?? '';
    if (historySeedRef.current === seedKey) return; // already seeded for this route
    historySeedRef.current = seedKey;
    ignorePopstateUntilRef.current = Date.now() + 600;

    try {
      window.history.pushState({ khatarioMobileBack: true }, '', window.location.href);
    } catch {
      // ignore quota / security errors
    }
  }, [pathname]);

  // ── Browser popstate (swipe-back, desktop back button) ─────────────────────
  useEffect(() => {
    if (!shouldHandleMobileBack()) return;

    const onPopState = () => {
      if (Date.now() < ignorePopstateUntilRef.current) return;
      const path = pathnameRef.current;
      if (isAppExitRoot(path)) {
        try {
          window.history.pushState({ khatarioMobileBack: true }, '', window.location.href);
        } catch {
          /* ignore */
        }
        return;
      }
      if (isNonHomeBottomNavTab(path)) {
        router.replace('/dashboard');
        return;
      }
      performMobileBack(router, path);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [router]);

  // ── Capacitor hardware back button ─────────────────────────────────────────
  useEffect(() => {
    if (!isCapacitorNative()) return;

    let removed = false;
    let removeListener: (() => void) | undefined;

    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', () => {
          const path = pathnameRef.current;

          // ── Debug log (temporary — remove before release) ────────────────
          if (process.env.NODE_ENV !== 'production') {
            console.debug('[BackNav]', {
              path,
              historyLength: window.history.length,
              historyState: window.history.state,
              isSentinel: currentStateIsSentinel(),
              isExitRoot: isAppExitRoot(path),
            });
          }

          // ── Home only → minimize app ─────────────────────────────────────
          if (isAppExitRoot(path)) {
            void App.minimizeApp().catch(() => {
              void App.exitApp();
            });
            return;
          }

          // ── Other bottom tabs (Invoices, Items, …) → Home ────────────────
          if (isNonHomeBottomNavTab(path)) {
            router.replace('/dashboard');
            return;
          }

          // ── Interceptors (e.g. unsaved-draft dialog on invoice page) ─────
          if (runMobileBackInterceptors()) return;

          // ── Sentinel-skip ─────────────────────────────────────────────────
          // The current history entry is a sentinel → skip past both the
          // sentinel AND the underlying page entry with a single go(-2) call
          // so back navigation requires exactly one press per screen.
          if (currentStateIsSentinel()) {
            mobileBackInFlight = true;
            window.setTimeout(() => {
              mobileBackInFlight = false;
            }, 500);
            window.history.go(-2);
            return;
          }

          // ── Normal back ───────────────────────────────────────────────────
          if (window.history.length > 1) {
            router.back();
          } else {
            const fallback = getMobileBackFallback(path);
            if (fallback) router.push(fallback);
          }
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
