'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Download, Smartphone } from 'lucide-react';

const ADMIN_SW = '/admin/sw.js';
const APP_LABEL = () =>
  typeof window !== 'undefined' && window.location.hostname.includes('staging')
    ? 'Khatario STG'
    : 'Khatario Admin';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function waitForActiveWorker(reg: ServiceWorkerRegistration) {
  if (reg.active) return;
  const pending = reg.installing || reg.waiting;
  if (!pending) return;
  await new Promise<void>((resolve) => {
    pending.addEventListener('statechange', () => {
      if (pending.state === 'activated' || pending.state === 'redundant') resolve();
    });
  });
}

export function AdminPwaChrome() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [envLabel, setEnvLabel] = useState('');
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const host = window.location.hostname;
    setEnvLabel(host.includes('staging') ? 'Staging' : host.includes('localhost') ? 'Local' : 'Production');
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setInstalled(standalone);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setInstalled(true);
      setHint(`Installed. Open “${APP_LABEL()}” from your app list or home screen — not from Chrome tabs.`);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) {
          const script = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
          if (script.includes('/admin-sw.js')) {
            void reg.unregister();
          }
        }
      });
      void navigator.serviceWorker.register(ADMIN_SW, { scope: '/admin' }).catch((err) => {
        console.warn('[admin-sw]', err);
      });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installEvent) {
      setHint(
        installed
          ? `This phone already has the app. Find “${APP_LABEL()}” in the app drawer (pull down search).`
          : 'On Android Chrome use the menu (⋮) → Install app / Add to Home screen. On iPhone: Share → Add to Home Screen. Then open that icon, not the browser tab.',
      );
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === 'accepted') {
      setHint(`Installing… look for “${APP_LABEL()}” on the home screen or in the app drawer.`);
    } else {
      setHint('Install was cancelled.');
    }
  };

  const enablePush = useCallback(async () => {
    setBusy(true);
    setHint(null);
    try {
      if (!window.isSecureContext) {
        throw new Error('Open this page over HTTPS in Chrome, then try again.');
      }
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Use Chrome or Edge on Android. In-app browsers (WhatsApp, Gmail) cannot enable alerts.');
      }

      if (Notification.permission === 'denied') {
        throw new Error(
          `Notifications are blocked for this site. In Chrome tap the lock icon → Permissions → Notifications → Allow. Or Android Settings → Apps → ${APP_LABEL()} → Notifications. Then tap Enable alerts again.`,
        );
      }

      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          throw new Error(
            'Android did not allow notifications. Tap Allow on the system prompt. If no prompt appeared, Chrome already blocked this site — reset it under lock icon → Site settings.',
          );
        }
      }

      const vapidRes = await fetch('/api/admin/push/vapid', { credentials: 'include' });
      const vapid = await vapidRes.json();
      if (!vapidRes.ok) throw new Error(vapid.error || 'Could not load push keys');

      const reg = await navigator.serviceWorker.register(ADMIN_SW, { scope: '/admin' });
      await waitForActiveWorker(reg);
      if (!reg.active) {
        throw new Error('Admin app worker is not ready yet. Refresh this page in Chrome and tap Enable alerts again.');
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
      });
      const json = sub.toJSON();
      const save = await fetch('/api/admin/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      const saveData = await save.json();
      if (!save.ok) throw new Error(saveData.error || 'Could not save subscription');
      setHint('This phone will get signup and incident alerts.');
    } catch (err) {
      setHint(err instanceof Error ? err.message : 'Could not enable notifications');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {envLabel ? (
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800">
          {envLabel}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700"
      >
        <Download className="h-3.5 w-3.5" />
        Install app
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void enablePush()}
        className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
      >
        <Bell className="h-3.5 w-3.5" />
        {busy ? 'Enabling…' : 'Enable alerts'}
      </button>
      {hint ? (
        <p className="w-full text-[11px] text-amber-200 sm:w-auto sm:text-gray-300">{hint}</p>
      ) : (
        <span className="hidden items-center gap-1 text-[11px] text-gray-400 sm:inline-flex">
          <Smartphone className="h-3 w-3" />
          Install staging and production separately
        </span>
      )}
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
