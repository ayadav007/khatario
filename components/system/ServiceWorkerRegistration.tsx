'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw, X } from 'lucide-react';
import { isStaleChunkError, recoverFromStaleShell } from '@/lib/shell-recovery';
import { decideOnControllerChange, shouldReloadOnNavigation } from '@/lib/sw-update-policy';

/** Avoid stacking `updatefound` / `statechange` listeners when the shell remounts in dev/StrictMode. */
let swRegistrationHooksAttached = false;

/**
 * Registers the app-shell service worker on the remote web origin (staging/PWA).
 * Skips Capacitor local errorPath pages (https://localhost/...).
 *
 * After each deploy a new sw.js activates (skipWaiting). The page is never
 * reloaded underneath the user: a banner offers a refresh, and otherwise the
 * new build is picked up with a full load on the next page navigation.
 */
export function ServiceWorkerRegistration() {
  const pathname = usePathname();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const updatePendingRef = useRef(false);
  const previousPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const host = window.location.hostname;
    if (host === 'localhost' || window.location.protocol === 'capacitor:') {
      return;
    }
    if (window.location.pathname.startsWith('/admin')) {
      return;
    }

    const hadControllerAtLoad = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      const action = decideOnControllerChange({
        hadControllerAtLoad,
        pathname: window.location.pathname,
      });
      if (action === 'update-available') {
        updatePendingRef.current = true;
        setUpdateAvailable(true);
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const onFocus = () => {
      void navigator.serviceWorker.ready.then((reg) => reg.update());
    };
    window.addEventListener('focus', onFocus);

    const onError = (event: ErrorEvent) => {
      if (isStaleChunkError(event.message ?? '')) {
        void recoverFromStaleShell();
      }
    };
    window.addEventListener('error', onError);

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await reg.update();

        if (!swRegistrationHooksAttached) {
          swRegistrationHooksAttached = true;
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (
                installing.state === 'installed' &&
                navigator.serviceWorker.controller &&
                reg.waiting
              ) {
                reg.waiting.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        }

        if (reg.waiting && navigator.serviceWorker.controller) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      } catch (error) {
        console.warn('[SW] Registration failed:', error);
      }
    };

    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', () => void register(), { once: true });
    }

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (
      shouldReloadOnNavigation({
        updatePending: updatePendingRef.current,
        previousPathname,
        pathname: pathname ?? '',
      })
    ) {
      window.location.reload();
    }
  }, [pathname]);

  if (!updateAvailable || bannerDismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-20 z-[80] flex justify-center px-4 md:bottom-4"
    >
      <div className="flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
        <span>A new version of Khatario is available.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1 font-medium hover:bg-primary-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setBannerDismissed(true)}
          aria-label="Dismiss"
          className="rounded p-1 text-gray-300 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
