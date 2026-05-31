'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker on the remote web origin (staging/PWA).
 * Skips Capacitor local errorPath pages (https://localhost/...).
 *
 * After each deploy a new sw.js activates (skipWaiting). We reload once so the
 * tab loads fresh HTML/JS instead of mixing old cached pages with new API routes.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const host = window.location.hostname;
    if (host === 'localhost' || window.location.protocol === 'capacitor:') {
      return;
    }

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const onFocus = () => {
      void navigator.serviceWorker.ready.then((reg) => reg.update());
    };
    window.addEventListener('focus', onFocus);

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await reg.update();

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
    };
  }, []);

  return null;
}
