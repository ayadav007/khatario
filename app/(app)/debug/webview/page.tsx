'use client';

import { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';

type DebugSnapshot = {
  platform: string;
  isNative: boolean;
  href: string;
  origin: string;
  userAgent: string;
  capacitorServerUrl: string | null;
  webviewDebugFlag: string | null;
  timestamp: string;
};

declare global {
  interface Window {
    __KHATARIO_WEBVIEW_DEBUG__?: DebugSnapshot;
  }
}

function readMeta(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
}

export default function WebViewDebugPage() {
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);

  const lines = useMemo(() => {
    if (!snapshot) return [];
    return Object.entries(snapshot).map(([key, value]) => `${key}: ${value ?? '(null)'}`);
  }, [snapshot]);

  useEffect(() => {
    const next: DebugSnapshot = {
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform(),
      href: window.location.href,
      origin: window.location.origin,
      userAgent: navigator.userAgent,
      capacitorServerUrl: readMeta('capacitor-server-url'),
      webviewDebugFlag: readMeta('khatario-webview-debug'),
      timestamp: new Date().toISOString(),
    };
    window.__KHATARIO_WEBVIEW_DEBUG__ = next;
    setSnapshot(next);
    console.info('[KhatarioWebView]', next);
  }, []);

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold text-text-primary">WebView debug probe</h1>
      <p className="text-sm text-text-secondary">
        Open this page inside the Capacitor APK, then attach DevTools from{' '}
        <code className="text-text-primary">chrome://inspect</code>. If this page loads here, the
        app is using the in-app Android WebView (not external Chrome).
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border bg-gray-50 p-4 text-xs text-text-primary">
        {lines.length ? lines.join('\n') : 'Collecting…'}
      </pre>
      <p className="text-xs text-text-muted">
        Native log tag: <code>KhatarioWebView</code> — filter with{' '}
        <code>adb logcat -s KhatarioWebView</code>
      </p>
    </div>
  );
}
