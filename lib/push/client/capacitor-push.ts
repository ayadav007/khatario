import { isCapacitorNative } from '@/lib/capacitor/platform';
import { localNotificationId, planPushTap, type PushTapData, type PushTapPlan } from './tap-route';

/**
 * Push inside the Capacitor shell (com.khatario.app). Web browsers and the Flutter app never
 * reach this file: `isCapacitorNative()` gates everything.
 *
 * Flow: sign-in → request POST_NOTIFICATIONS → FCM registration → POST the token to the
 * audience's route → listen for foreground messages (shown as a local notification on the
 * `khatario_alerts` channel, since Android never shows a push while the app is open) and for taps
 * (system or local) → `onTap` with the server's data. Sign-out → DELETE the stored token.
 *
 * Which route a token goes to is decided by the signed-in surface: the business app registers
 * against /api/push/devices (session user), the store account against the store's route (store
 * customer cookie). The server derives the audience from that identity, never from this code.
 */

export const PUSH_APP_ID = 'com.khatario.app';
export const PUSH_CHANNEL_ALERTS = 'khatario_alerts';
const TOKEN_KEY = 'khatario.push.token.v1';

export type PushAudienceTarget = { kind: 'business' } | { kind: 'customer'; subdomain: string };
export type PushPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

type ListenerHandle = { remove: () => Promise<void> | void };

type PushPlugin = {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: 'registration', fn: (t: { value: string }) => void): Promise<ListenerHandle>;
  addListener(event: 'registrationError', fn: (e: { error: string }) => void): Promise<ListenerHandle>;
  addListener(
    event: 'pushNotificationReceived',
    fn: (n: { id?: string; title?: string; body?: string; data?: PushTapData }) => void,
  ): Promise<ListenerHandle>;
  addListener(
    event: 'pushNotificationActionPerformed',
    fn: (a: { actionId: string; notification: { data?: PushTapData } }) => void,
  ): Promise<ListenerHandle>;
  removeAllListeners(): Promise<void>;
};

type LocalPlugin = {
  requestPermissions(): Promise<{ display: string }>;
  schedule(opts: { notifications: unknown[] }): Promise<unknown>;
  addListener(
    event: 'localNotificationActionPerformed',
    fn: (a: { actionId: string; notification: { extra?: PushTapData } }) => void,
  ): Promise<ListenerHandle>;
  removeAllListeners(): Promise<void>;
};

async function plugins(): Promise<{ push: PushPlugin; local: LocalPlugin } | null> {
  if (!isCapacitorNative()) return null;
  try {
    const [{ PushNotifications }, { LocalNotifications }] = await Promise.all([
      import('@capacitor/push-notifications'),
      import('@capacitor/local-notifications'),
    ]);
    return { push: PushNotifications as unknown as PushPlugin, local: LocalNotifications as unknown as LocalPlugin };
  } catch {
    return null;
  }
}

function devicePath(target: PushAudienceTarget): string {
  return target.kind === 'business' ? '/api/push/devices' : `/api/public/store/${encodeURIComponent(target.subdomain)}/push/devices`;
}

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function postToken(target: PushAudienceTarget, token: string): Promise<boolean> {
  try {
    const res = await fetch(devicePath(target), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, app_id: PUSH_APP_ID, platform: 'android', device_label: navigator.userAgent.slice(0, 120) }),
    });
    if (!res.ok) console.warn('[push] device registration failed:', res.status);
    return res.ok;
  } catch (err) {
    console.warn('[push] device registration failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Current OS permission for this app, without prompting. */
export async function checkPushPermission(): Promise<PushPermissionState> {
  const p = await plugins();
  if (!p) return 'unsupported';
  try {
    const r = await p.push.checkPermissions();
    return r.receive === 'granted' ? 'granted' : r.receive === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unsupported';
  }
}

export type StartPushOptions = {
  target: PushAudienceTarget;
  /** Business the session is on; used to detect a tap for another business. */
  currentBusinessId?: string | null;
  onTap: (plan: PushTapPlan, data: PushTapData) => void;
  onPermission?: (state: PushPermissionState) => void;
};

/**
 * Registers this device for the signed-in identity and wires message and tap listeners.
 * Returns a cleanup that removes the listeners (it does not revoke the token; sign-out does).
 */
export async function startCapacitorPush(options: StartPushOptions): Promise<() => Promise<void>> {
  const p = await plugins();
  if (!p) return async () => undefined;
  const handles: ListenerHandle[] = [];
  const audience = options.target.kind;

  const route = (data: PushTapData) => {
    try {
      options.onTap(planPushTap(data, { audience, currentBusinessId: options.currentBusinessId }), data);
    } catch (err) {
      console.warn('[push] tap routing failed:', err instanceof Error ? err.message : err);
    }
  };

  handles.push(
    await p.push.addListener('registration', (t) => {
      storeToken(t.value);
      void postToken(options.target, t.value);
    }),
    await p.push.addListener('registrationError', (e) => {
      // Without google-services.json (or offline) FCM cannot mint a token; the bell still works.
      console.warn('[push] registration error:', e?.error);
    }),
    await p.push.addListener('pushNotificationReceived', (n) => {
      // Foreground: Android does not show the push itself. Show it on our channel, with the
      // same tag-like id so a repeat of the same notification replaces the earlier card.
      const data = n.data ?? {};
      const title = (typeof data.title === 'string' && data.title) || n.title || 'Khatario';
      const body = (typeof data.body === 'string' && data.body) || n.body || '';
      void p.local
        .schedule({
          notifications: [
            {
              id: localNotificationId(data),
              title,
              body,
              channelId: PUSH_CHANNEL_ALERTS,
              smallIcon: 'ic_stat_khatario',
              iconColor: '#0F2E24',
              extra: data,
              autoCancel: true,
            },
          ],
        })
        .catch((err: unknown) => console.warn('[push] foreground display failed:', err instanceof Error ? err.message : err));
    }),
    await p.push.addListener('pushNotificationActionPerformed', (a) => route(a.notification?.data)),
    await p.local.addListener('localNotificationActionPerformed', (a) => route(a.notification?.extra)),
  );

  try {
    let perm = await p.push.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await p.push.requestPermissions();
    }
    const state: PushPermissionState = perm.receive === 'granted' ? 'granted' : perm.receive === 'denied' ? 'denied' : 'prompt';
    options.onPermission?.(state);
    if (state === 'granted') {
      await p.local.requestPermissions().catch(() => undefined);
      await p.push.register();
    }
  } catch (err) {
    console.warn('[push] could not start:', err instanceof Error ? err.message : err);
  }

  return async () => {
    for (const h of handles) {
      try {
        await h.remove();
      } catch {
        /* already removed */
      }
    }
  };
}

/**
 * Sign-out: tells the server this device no longer belongs to the identity. Must run while the
 * session cookie is still valid, so callers await it before POST /api/auth/logout (or the store
 * logout). The token stays on the phone and is re-registered by the next sign-in.
 */
export async function unregisterCapacitorPush(target: PushAudienceTarget): Promise<void> {
  if (!isCapacitorNative()) return;
  const token = readStoredToken();
  if (!token) return;
  try {
    await fetch(devicePath(target), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      keepalive: true,
    });
  } catch {
    // The server also drops the device once the session version changes (dispatcher check).
  }
}
