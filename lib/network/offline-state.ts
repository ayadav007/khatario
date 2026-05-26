/**
 * Module-level online flag updated by NetworkStatusProvider.
 * Used by non-React code paths (fetch helpers, toast guard) where hooks are unavailable.
 */
let appOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

export function setAppOnlineState(online: boolean): void {
  appOnline = online;
}

export function readBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

/** Best-effort offline check (Capacitor Network + browser events via provider). */
export function isAppOffline(): boolean {
  return !appOnline;
}

export function isAppOnline(): boolean {
  return appOnline;
}
