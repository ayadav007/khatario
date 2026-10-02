const encoder = new TextEncoder();

export function encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/**
 * Notification events are sent as `event: message` so EventSource clients that only listen
 * with `onmessage` keep receiving them.
 */
export function formatEvent(event: string, data: unknown, id?: string, retryMs?: number): string {
  let out = '';
  if (retryMs != null) out += `retry: ${Math.max(0, Math.round(retryMs))}\n`;
  if (id != null) out += `id: ${id}\n`;
  out += `event: ${event}\n`;
  out += `data: ${JSON.stringify(data)}\n\n`;
  return out;
}

export function formatComment(text: string): string {
  return `: ${text}\n\n`;
}

const SEQ_RE = /^\d{1,18}$/;

/**
 * Cursor from the `Last-Event-ID` header (sent by EventSource on reconnect) or `after_seq`.
 * Anything that is not a plain non-negative integer is ignored (the stream starts live).
 */
export function parseCursor(lastEventId: string | null, afterSeq: string | null): bigint | null {
  for (const raw of [lastEventId, afterSeq]) {
    const v = raw?.trim();
    if (v && SEQ_RE.test(v)) return BigInt(v);
  }
  return null;
}
