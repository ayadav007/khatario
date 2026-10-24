export type StreamSession = { businessId: string; userId: string };

export const sessionKey = (s: StreamSession) => `${s.businessId}:${s.userId}`;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SEQ_RE = /^\d{1,18}$/;
export const isSeq = (v: unknown): v is string => typeof v === 'string' && SEQ_RE.test(v);

function cmpSeq(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Last processed stream cursor for one session (business + user), shared by the tabs of that
 * session through localStorage. Falls back to memory when storage is unavailable.
 */
export class CursorStore {
  private memory: string | null = null;
  readonly key: string;

  constructor(
    private readonly storage: KeyValueStorage | null,
    session: StreamSession
  ) {
    this.key = `khatario:notif-cursor:v1:${sessionKey(session)}`;
  }

  read(): string | null {
    let stored: string | null = null;
    try {
      stored = this.storage?.getItem(this.key) ?? null;
    } catch {
      stored = null;
    }
    const candidates = [stored, this.memory].filter(isSeq);
    if (candidates.length === 0) return null;
    return candidates.reduce((m, c) => (cmpSeq(c, m) > 0 ? c : m));
  }

  /** Moves forward only (another tab may already be further). Returns the stored value. */
  advance(seq: string): string | null {
    if (!isSeq(seq)) return this.read();
    const current = this.read();
    if (current && cmpSeq(seq, current) <= 0) return current;
    this.write(seq);
    return seq;
  }

  /** Server-directed reset (resync), which may move the cursor backwards. */
  set(seq: string): void {
    if (isSeq(seq)) this.write(seq);
  }

  private write(seq: string): void {
    this.memory = seq;
    try {
      this.storage?.setItem(this.key, seq);
    } catch {
      /* quota / private mode: memory copy still applies for this tab */
    }
  }
}

/** Insertion-ordered set that forgets its oldest entries beyond `max`. */
export class BoundedSet {
  private readonly items = new Set<string>();

  constructor(private readonly max: number) {}

  has(key: string): boolean {
    return this.items.has(key);
  }

  add(key: string): void {
    if (this.items.has(key)) this.items.delete(key);
    this.items.add(key);
    while (this.items.size > this.max) {
      const oldest = this.items.values().next().value as string;
      this.items.delete(oldest);
    }
  }

  delete(key: string): void {
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

/** Exponential backoff from 1s, capped at 60s, with ±20% jitter (still capped). */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 16));
  return Math.min(BACKOFF_MAX_MS, Math.round(base * (0.8 + 0.4 * random())));
}

/** `Retry-After` as delta-seconds or an HTTP date; null when absent or unparseable. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
