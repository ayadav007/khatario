'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker on the remote web origin (staging/PWA).
 * Skips Capacitor local errorPath pages (https://localhost/...).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const host = window.location.hostname;
    if (host === 'localhost' || window.location.protocol === 'capacitor:') {
      return;
    }

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (error) {
        console.warn('[SW] Registration failed:', error);
      }
    };

    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', () => void register(), { once: true });
    }
  }, []);

  return null;
}
