/**
 * Central Baileys connection lifecycle: one logical session per businessId, reconnect
 * with exponential backoff, presence heartbeat, and stale-activity health checks.
 * Intended to be used from a long-running worker; Next.js may import it for status only.
 */
import { DisconnectReason } from '@/lib/baileys-hybrid';

export type WhatsappConnectionApiStatus = 'connected' | 'reconnecting' | 'disconnected';

const LOG = '[wa-conn]';

const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000, 60_000];
const PRESENCE_INTERVAL_MS = 20_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = Math.max(
  15_000,
  Number(process.env.WHATSAPP_STALE_EVENT_MS || 120_000) || 120_000
);

type Entry = {
  businessId: string;
  lastEventAt: number;
  reconnectAttempt: number;
  apiStatus: WhatsappConnectionApiStatus;
  presenceInterval: ReturnType<typeof setInterval> | null;
  healthInterval: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

const g = globalThis as unknown as { __waConnManager?: Map<string, Entry> };
if (!g.__waConnManager) g.__waConnManager = new Map();
const byBusiness = g.__waConnManager;

function getOrCreate(businessId: string): Entry {
  let e = byBusiness.get(businessId);
  if (!e) {
    e = {
      businessId,
      lastEventAt: Date.now(),
      reconnectAttempt: 0,
      apiStatus: 'disconnected',
      presenceInterval: null,
      healthInterval: null,
      reconnectTimer: null
    };
    byBusiness.set(businessId, e);
  }
  return e;
}

function clearReconnectTimer(e: Entry) {
  if (e.reconnectTimer) {
    clearTimeout(e.reconnectTimer);
    e.reconnectTimer = null;
  }
}

function clearPresence(e: Entry) {
  if (e.presenceInterval) {
    clearInterval(e.presenceInterval);
    e.presenceInterval = null;
  }
}

function clearHealth(e: Entry) {
  if (e.healthInterval) {
    clearInterval(e.healthInterval);
    e.healthInterval = null;
  }
}

/** Track Baileys ev activity so "silent" Web sessions can be detected. */
const ACTIVITY_EVENTS: string[] = [
  'connection.update',
  'creds.update',
  'messages.upsert',
  'messages.update',
  'messages.delete',
  'messaging-history.set',
  'message-receipt.update',
  'chats.upsert',
  'chats.update',
  'chats.delete',
  'contacts.upsert',
  'contacts.set',
  'presence.update',
  'groups.upsert',
  'group-participants.update',
  'blocklist.set',
  'blocklist.update',
  'call'
];

export function registerBusiness(businessId: string) {
  getOrCreate(businessId);
}

export function bindActivityProbes(businessId: string, ev: { on: (n: string, fn: () => void) => void }) {
  const e = getOrCreate(businessId);
  const bump = () => {
    e.lastEventAt = Date.now();
  };
  for (const name of ACTIVITY_EVENTS) {
    try {
      ev.on(name, bump);
    } catch {
      /* event may not exist in this Baileys version */
    }
  }
  bump();
  console.log(`${LOG} activity probes bound for ${businessId} (${ACTIVITY_EVENTS.length} channels)`);
}

function logHeartbeat(businessId: string, detail: string) {
  console.log(`${LOG} heartbeat business=${businessId} ${detail}`);
}

export function onConnectionClosed(businessId: string, detail?: { reason?: unknown; message?: string }) {
  const e = byBusiness.get(businessId);
  if (detail) {
    console.log(
      `${LOG} connection close business=${businessId} reason=${String(detail.reason)} msg=${(detail.message || '').slice(0, 200)}`
    );
  }
  if (!e) return;
  clearPresence(e);
  clearHealth(e);
  /* reconnect timer: scheduleReconnect owns it; do not clear here (close handler may schedule next) */
}

export function onLoggedOut(businessId: string) {
  const e = getOrCreate(businessId);
  clearReconnectTimer(e);
  clearPresence(e);
  clearHealth(e);
  e.reconnectAttempt = 0;
  e.apiStatus = 'disconnected';
  console.log(`${LOG} session logged out, manager reset for ${businessId}`);
}

/**
 * When the socket is fully authenticated and marked connected in whatsapp.ts.
 * `reconnect` must tear down the dead socket in whatsapp + call getWhatsAppSocket (see caller).
 */
export function onConnectionOpen(
  businessId: string,
  options: {
    getSocket: () => any;
    isSocketValid: (s: any) => boolean;
    reconnect: () => Promise<unknown>;
  }
) {
  const e = getOrCreate(businessId);
  clearReconnectTimer(e);
  e.reconnectAttempt = 0;
  e.apiStatus = 'connected';
  e.lastEventAt = Date.now();
  clearPresence(e);
  clearHealth(e);

  console.log(`${LOG} connection open business=${businessId} (presence ${PRESENCE_INTERVAL_MS}ms, health ${HEALTH_CHECK_INTERVAL_MS}ms, stale ${STALE_AFTER_MS}ms)`);

  e.presenceInterval = setInterval(() => {
    const sock = options.getSocket();
    if (!sock || !options.isSocketValid(sock)) return;
    void (async () => {
      try {
        await sock.sendPresenceUpdate('available', sock.user?.id);
        logHeartbeat(businessId, 'presence=available');
      } catch (err) {
        console.warn(`${LOG} presence update failed for ${businessId}:`, (err as Error)?.message);
      }
    })();
  }, PRESENCE_INTERVAL_MS);

  e.healthInterval = setInterval(() => {
    const now = Date.now();
    const silentFor = now - e.lastEventAt;
    const sock = options.getSocket();
    const valid = Boolean(sock && options.isSocketValid(sock));

    if (silentFor > STALE_AFTER_MS) {
      console.warn(
        `${LOG} health: no Baileys events for ${Math.round(silentFor / 1000)}s (threshold ${STALE_AFTER_MS}ms) — forcing reconnect for ${businessId}`
      );
      e.apiStatus = 'reconnecting';
      void options.reconnect().catch((err) =>
        console.error(`${LOG} forced reconnect after stale events failed:`, err)
      );
      return;
    }
    if (!valid) {
      console.warn(`${LOG} health: socket invalid — forcing reconnect for ${businessId}`);
      e.apiStatus = 'reconnecting';
      void options.reconnect().catch((err) =>
        console.error(`${LOG} forced reconnect after invalid socket failed:`, err)
      );
      return;
    }
    logHeartbeat(businessId, `idle=${Math.round(silentFor / 1000)}s socket=ok`);
  }, HEALTH_CHECK_INTERVAL_MS);
}

export function scheduleReconnectWithBackoff(
  businessId: string,
  run: () => Promise<unknown>,
  ctx: { reason?: unknown; lastError?: string } = {}
) {
  const e = getOrCreate(businessId);
  clearReconnectTimer(e);

  const statusCode = ctx.reason;
  const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

  if (!shouldReconnect) {
    e.apiStatus = 'disconnected';
    e.reconnectAttempt = 0;
    console.log(`${LOG} not reconnecting (logout) for ${businessId}`);
    return;
  }

  const step = Math.min(e.reconnectAttempt, BACKOFF_MS.length - 1);
  const delay = BACKOFF_MS[step] ?? 60_000;
  e.reconnectAttempt += 1;
  e.apiStatus = 'reconnecting';

  console.log(
    `${LOG} reconnect scheduled business=${businessId} attempt=${e.reconnectAttempt} delayMs=${delay} code=${String(statusCode)}`
  );

  e.reconnectTimer = setTimeout(() => {
    e.reconnectTimer = null;
    void (async () => {
      try {
        await run();
        console.log(`${LOG} reconnect run completed for ${businessId}`);
      } catch (err) {
        console.error(`${LOG} reconnect run failed (next attempt on connection.close or health):`, err);
      }
    })();
  }, delay);
}

export function getConnectionApiStatus(businessId: string): WhatsappConnectionApiStatus {
  const e = byBusiness.get(businessId);
  if (!e) return 'disconnected';
  if (e.reconnectTimer) return 'reconnecting';
  if (e.apiStatus === 'reconnecting') return 'reconnecting';
  if (e.apiStatus === 'connected') return 'connected';
  return 'disconnected';
}

export function setApiStatusForTesting(businessId: string, s: WhatsappConnectionApiStatus) {
  const e = getOrCreate(businessId);
  e.apiStatus = s;
}

export function getBackoffMsForAttempt(attemptIndex: number): number {
  return BACKOFF_MS[Math.min(attemptIndex, BACKOFF_MS.length - 1)] ?? 60_000;
}
