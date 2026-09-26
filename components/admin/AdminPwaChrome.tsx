'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Download, Smartphone } from 'lucide-react';

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

export function AdminPwaChrome() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [envLabel, setEnvLabel] = useState('');

  useEffect(() => {
    const host = window.location.hostname;
    setEnvLabel(host.includes('staging') ? 'Staging' : host.includes('localhost') ? 'Local' : 'Production');

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin/' }).catch((err) => {
        console.warn('[admin-sw]', err);
      });
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const install = async () => {
    if (!installEvent) {
      setHint(
        'On iPhone: Share → Add to Home Screen. On Android Chrome: menu → Install app. Open this same URL (staging or production) after install.',
      );
      return;
    }
    await installEvent.prompt();
    setInstallEvent(null);
  };

  const enablePush = useCallback(async () => {
    setBusy(true);
    setHint(null);
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        throw new Error('This browser does not support Web Push');
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notification permission was not granted');
      const vapidRes = await fetch('/api/admin/push/vapid', { credentials: 'include' });
      const vapid = await vapidRes.json();
      if (!vapidRes.ok) throw new Error(vapid.error || 'Could not load push keys');
      const reg = await navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin/' });
      await reg.update();
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
}
