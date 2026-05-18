/**
 * Baileys in-memory store helpers: JID key resolution and chat-list timestamps
 * (shared by live conversation list, message fetch, and whatsapp.ts).
 */

const IGNORED_MSG_KEYS = new Set(['messageContextInfo', 'deviceSentMessage']);

function firstMeaningfulMessageKey(m: object): string {
  const keys = Object.keys(m).filter((k) => !IGNORED_MSG_KEYS.has(k));
  return keys[0] || 'empty';
}

/**
 * Unwrap Baileys / WhatsApp `proto.Message` trees so the real content (text, image, …)
 * is not hidden under ephemeral / view-once layers.
 * Iterates until no wrapper applies (max depth safe).
 */
export function normalizeMessage(message: any, context?: string): any {
  if (message == null || typeof message !== 'object') {
    return message;
  }
  let m: any = message;
  const ctx = context ? ` [${context}]` : '';
  const max = 20;
  for (let d = 0; d < max; d++) {
    let wrapper: string | null = null;
    let next: any;
    if (m.ephemeralMessage?.message) {
      wrapper = 'ephemeralMessage';
      next = m.ephemeralMessage.message;
    } else if (m.viewOnceMessage?.message) {
      wrapper = 'viewOnceMessage';
      next = m.viewOnceMessage.message;
    } else if (m.viewOnceMessageV2?.message) {
      wrapper = 'viewOnceMessageV2';
      next = m.viewOnceMessageV2.message;
    } else {
      break;
    }
    if (next == null) {
      break;
    }
    const innerType = firstMeaningfulMessageKey(next);
    console.log(`[WA] normalizeMessage:${ctx} unwrapped ${wrapper} →`, innerType);
    m = next;
  }
  return m;
}

/** Values >1e12 are treated as milliseconds (rare) and converted to seconds. */
function normalizeMaybeMillisToSec(n: number): number {
  if (n > 1_000_000_000_000) return Math.floor(n / 1000);
  return n;
}

/**
 * Extract Baileys `messageTimestamp` in **seconds** (WhatsApp / proto).
 * Use this for `created_at` — never use server `Date.now()` as a per-message time.
 * Handles protobufjs Long (toNumber), UInt64 `high`+`low`, and ms heuristics.
 */
export function extractWebMessageInfoTimestampSec(msg: { messageTimestamp?: unknown } | null | undefined): number {
  if (!msg) return 0;
  const t = (msg as { messageTimestamp?: unknown }).messageTimestamp;
  if (t == null) return 0;
  if (typeof t === 'object' && t !== null) {
    const any = t as { toNumber?: () => number; low?: number; high?: number };
    if (typeof any.toNumber === 'function') {
      try {
        const n = any.toNumber();
        if (n > 0) return normalizeMaybeMillisToSec(n);
      } catch {
        /* fall through */
      }
    }
    if ('low' in any) {
      const low = (any.low as number) >>> 0;
      const high = ((any.high as number) || 0) >>> 0;
      const combined = high * 0x100000000 + low;
      if (combined > 0) return normalizeMaybeMillisToSec(combined);
    }
  }
  if (typeof t === 'number' && t > 0) return normalizeMaybeMillisToSec(t);
  return 0;
}

/**
 * Single entry for Baileys IWebMessageInfo (or any object with `messageTimestamp`).
 * Returns Unix **seconds**. Uses full 64-bit Long handling via `extractWebMessageInfoTimestampSec`.
 * If missing/invalid, uses server time and logs a warning.
 */
export function getTimestamp(msg: { messageTimestamp?: unknown } | null | undefined): number {
  const raw =
    msg && typeof msg === 'object' ? (msg as { messageTimestamp?: unknown }).messageTimestamp : undefined;
  const sec = extractWebMessageInfoTimestampSec(msg);
  if (sec > 0) {
    return sec;
  }
  if (raw != null) {
    console.warn('[WA] getTimestamp: invalid timestamp detected (could not parse messageTimestamp)', { raw });
  }
  const fallback = Math.floor(Date.now() / 1000);
  console.warn('[WA] getTimestamp: invalid or missing messageTimestamp; using server time (fallback)', {
    raw,
    fallback,
  });
  return fallback;
}

/**
 * Returns WhatsApp `messageTimestamp` in seconds if the proto value was present and valid, else `null` (for `source_timestamp` column).
 * Use together with `getTimestamp()` for `created_at` (normalized, may be server fallback).
 */
export function getOriginalWaTimestampSecOrNull(
  msg: { messageTimestamp?: unknown } | null | undefined
): number | null {
  const sec = extractWebMessageInfoTimestampSec(msg);
  return sec > 0 ? sec : null;
}

export function protoMessageTimestampSec(
  m: { messageTimestamp?: number | { low?: number; high?: number } | null } | null | undefined
): number {
  return extractWebMessageInfoTimestampSec(m);
}

/** Normalize Long/number to seconds. */
export function toProtoTimestampSec(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'low' in (v as object)) {
    const low = (v as { low: number }).low;
    return typeof low === 'number' ? low : 0;
  }
  if (typeof v === 'number' && v > 0) return v;
  return 0;
}

/**
 * `store.messages` is keyed by JID; 1:1 threads may use a different key than `chat.id` (LID vs E.164).
 * Find a key that actually holds the message list for this thread.
 */
export function findStoreMessageJidKey(
  storeMessages: Record<string, unknown> | undefined,
  requestedJid: string
): string {
  if (!storeMessages || !requestedJid) return requestedJid;
  if (storeMessages[requestedJid]) return requestedJid;
  const digits = requestedJid.split('@')[0].replace(/\D/g, '');
  for (const k of Object.keys(storeMessages)) {
    if (k.endsWith('@g.us')) continue;
    const kd = k.split('@')[0].replace(/\D/g, '');
    if (
      kd &&
      digits &&
      (kd === digits || (kd.length >= 10 && digits.length >= 10 && kd.slice(-10) === digits.slice(-10)))
    ) {
      return k;
    }
  }
  return requestedJid;
}

/**
 * WhatsApp chat list ordering uses the latest of: last loaded message time and chat row metadata.
 * All values are in seconds.
 */
export function maxChatListActivityTimeSec(
  chat: { conversationTimestamp?: unknown; lastMsgTimestamp?: unknown; lastMessageRecvTimestamp?: unknown },
  lastLoadedMessageTimeSec: number
): number {
  return Math.max(
    lastLoadedMessageTimeSec,
    toProtoTimestampSec((chat as { conversationTimestamp?: unknown }).conversationTimestamp),
    toProtoTimestampSec((chat as { lastMsgTimestamp?: unknown }).lastMsgTimestamp),
    toProtoTimestampSec((chat as { lastMessageRecvTimestamp?: unknown }).lastMessageRecvTimestamp)
  );
}

/**
 * When some protos still have 0s after `extractWebMessageInfoTimestampSec`, keep chronological order
 * with monotonic 1s steps between neighbors, then a coarse fallback so bubbles are not all "the same time".
 */
export function orderResolveMessageTimestamps(
  protos: { messageTimestamp?: unknown }[],
  out: { created_at: string }[]
): void {
  if (!protos.length || protos.length !== out.length) return;
  const secs = protos.map((p) => extractWebMessageInfoTimestampSec(p));
  let anyZero = false;
  for (const s of secs) {
    if (s <= 0) anyZero = true;
  }
  if (!anyZero) return;

  for (let i = 0; i < secs.length; i++) {
    if (secs[i] > 0) continue;
    if (i > 0 && secs[i - 1] > 0) secs[i] = secs[i - 1]! + 1;
  }
  for (let i = secs.length - 1; i >= 0; i--) {
    if (secs[i]! > 0) continue;
    if (i + 1 < secs.length && secs[i + 1]! > 0) secs[i] = secs[i + 1]! - 1;
  }
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < secs.length; i++) {
    if (secs[i]! <= 0) secs[i] = now - (secs.length - 1 - i) * 300;
  }
  for (let i = 0; i < secs.length; i++) {
    out[i]!.created_at = new Date(secs[i]! * 1000).toISOString();
  }
}
