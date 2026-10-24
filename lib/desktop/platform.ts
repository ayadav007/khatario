/**
 * Khatario for Windows (desktop/, a Tauri shell) marks every page it loads with
 * `window.__KHATARIO_DESKTOP__` and a `khatario_client=desktop-<version>` cookie.
 */

export type KhatarioDesktopInfo = { platform: 'windows'; version: string };

export const DESKTOP_CLIENT_COOKIE = 'khatario_client';

export function getKhatarioDesktop(): KhatarioDesktopInfo | null {
  if (typeof window === 'undefined') return null;
  const info = (window as unknown as { __KHATARIO_DESKTOP__?: KhatarioDesktopInfo }).__KHATARIO_DESKTOP__;
  return info && typeof info.version === 'string' ? info : null;
}

export function isKhatarioDesktop(): boolean {
  return getKhatarioDesktop() !== null;
}

/** Server side: desktop app version from the request cookie value, or null for a browser. */
export function desktopVersionFromCookie(value: string | undefined | null): string | null {
  const match = /^desktop-([0-9A-Za-z.+-]{1,32})$/.exec(value ?? '');
  return match ? match[1] : null;
}

/** Screen size (page zoom) limits in the desktop app; the default is 80%. Mirrors desktop/src-tauri/src/zoom.rs. */
export const DESKTOP_ZOOM = { min: 0.7, max: 1.3, step: 0.1, default: 0.8 } as const;

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The desktop app's command bridge, or null in a browser. Only the Khatario site may call it. */
export function tauriInvoke(): TauriInvoke | null {
  if (!isKhatarioDesktop()) return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function' ? internals.invoke : null;
}

/** Current screen size in the desktop app, or null in a browser. */
export async function getDesktopZoom(): Promise<number | null> {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  const value = await invoke('desktop_get_zoom');
  return typeof value === 'number' ? value : null;
}

/** Sets and saves the screen size; returns the value the app applied (clamped to 70–130%). */
export async function setDesktopZoom(zoom: number): Promise<number | null> {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  const value = await invoke('desktop_set_zoom', { zoom });
  return typeof value === 'number' ? value : null;
}

/** Next screen size for Ctrl +, Ctrl − and Ctrl 0, in steps of 10%. */
export function nextDesktopZoom(current: number, action: 'in' | 'out' | 'reset'): number {
  if (action === 'reset') return DESKTOP_ZOOM.default;
  const next = Math.round((current + (action === 'in' ? DESKTOP_ZOOM.step : -DESKTOP_ZOOM.step)) * 100) / 100;
  return Math.min(DESKTOP_ZOOM.max, Math.max(DESKTOP_ZOOM.min, next));
}
