import { browserLifecycle, type LifecycleSignal, type LifecycleSource } from './lifecycle';
import {
  backoffDelay,
  BoundedSet,
  CursorStore,
  isSeq,
  parseRetryAfter,
  sessionKey,
  type KeyValueStorage,
  type StreamSession,
} from './primitives';
import { SseParser, type SseMessage } from './sse-parser';

/** Payload of a stream `message` event (fields kept from the pre-Release-3 Redis payload). */
export type StreamNotificationPayload = {
  type?: string;
  businessId?: string;
  userId?: string;
  notificationId?: string;
  title?: string;
  message?: string;
  reference_id?: string | null;
  reference_type?: string | null;
  timestamp?: number;
  seq?: string;
};

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'backoff' | 'offline' | 'unauthorized' | 'forbidden';

export type ReconcileReason = 'bootstrap' | 'resync' | 'poll' | 'wake';

export interface StreamConsumer {
  session: StreamSession;
  /** Reject to keep the cursor where it is; the client reconnects and the server replays. */
  onNotification(payload: StreamNotificationPayload, meta: { seq: string | null; source: 'stream' | 'relay' }): void | Promise<void>;
  /**
   * Re-read GET /api/notifications into state. Resolves with the response's stream_cursor (the
   * latest seq visible to the session, '0' when there is none), or null when the server has no
   * seq support. Only used to start a session without a stored cursor. Rejects on failure.
   */
  reconcile(reason: ReconcileReason): Promise<string | null>;
  onRemoteDismiss?(keys: string[]): void;
  onUnauthorized?(): void;
  onForbidden?(): void;
  onStatus?(status: StreamStatus): void;
}

export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type StreamClientDeps = {
  url: string;
  fetch: typeof fetch;
  storage: KeyValueStorage | null;
  random: () => number;
  now: () => number;
  lifecycle: LifecycleSource;
  createChannel: (name: string) => ChannelLike | null;
  /** One explicit refresh-token rotation after a 401. */
  refreshSession: () => Promise<boolean>;
  pollMs: number;
  watchdogMs: number;
  stableMs: number;
  dedupMax: number;
};

export const STREAM_CLIENT_DEFAULTS = {
  url: '/api/notifications/stream',
  pollMs: 5 * 60_000,
  /** Server pings every 25s; two missed pings and a margin. */
  watchdogMs: 60_000,
  stableMs: 30_000,
  dedupMax: 1000,
};

const CHANNEL_NAME = 'khatario-notifications-v1';

type ChannelMessage =
  | { v: 1; session: string; kind: 'event'; seq: string; payload: StreamNotificationPayload }
  | { v: 1; session: string; kind: 'dismiss'; keys: string[] };

/**
 * One notification stream per tab, shared by every subscriber (fetch-based SSE so HTTP status
 * and Retry-After are visible). The cursor only moves after an event was handled by all
 * consumers; seq de-duplication covers replays, polling and events relayed from other tabs.
 */
export class NotificationStreamClient {
  private readonly deps: StreamClientDeps;
  private readonly consumers = new Set<StreamConsumer>();
  private readonly seen: BoundedSet;
  private session: StreamSession | null = null;
  private cursor: CursorStore | null = null;
  private status: StreamStatus = 'idle';
  private generation = 0;
  private abort: AbortController | null = null;
  private attempt = 0;
  private sessionRefreshTried = false;
  private lastByteAt = 0;
  private chain: Promise<void> = Promise.resolve();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopLifecycle: (() => void) | null = null;
  private channel: ChannelLike | null = null;

  constructor(deps: StreamClientDeps) {
    this.deps = deps;
    this.seen = new BoundedSet(deps.dedupMax);
  }

  get currentStatus(): StreamStatus {
    return this.status;
  }

  get consumerCount(): number {
    return this.consumers.size;
  }

  get dedupSize(): number {
    return this.seen.size;
  }

  get currentCursor(): string | null {
    return this.cursor?.read() ?? null;
  }

  subscribe(consumer: StreamConsumer): () => void {
    this.consumers.add(consumer);
    if (this.consumers.size === 1) this.startShared();
    if (!this.session || sessionKey(this.session) !== sessionKey(consumer.session)) {
      this.switchSession(consumer.session);
    } else {
      consumer.onStatus?.(this.status);
    }
    return () => {
      if (!this.consumers.delete(consumer)) return;
      if (this.consumers.size === 0) this.stopAll();
    };
  }

  /** Tell other tabs of this session that popups were dismissed here. */
  broadcastDismiss(keys: string[]): void {
    if (!this.session || keys.length === 0) return;
    this.post({ v: 1, session: sessionKey(this.session), kind: 'dismiss', keys });
  }

  private startShared(): void {
    this.stopLifecycle = this.deps.lifecycle.subscribe((s) => this.onSignal(s));
    try {
      this.channel = this.deps.createChannel(CHANNEL_NAME);
    } catch {
      this.channel = null;
    }
    if (this.channel) this.channel.onmessage = (ev) => this.onChannelMessage(ev.data);
    this.pollTimer = setInterval(() => this.poll(), this.deps.pollMs);
  }

  private stopAll(): void {
    this.kill();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.stopLifecycle?.();
    this.stopLifecycle = null;
    if (this.channel) {
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch {
        /* already closed */
      }
    }
    this.channel = null;
    this.session = null;
    this.cursor = null;
    this.seen.clear();
    this.status = 'idle';
  }

  private switchSession(session: StreamSession): void {
    this.session = session;
    this.cursor = new CursorStore(this.deps.storage, session);
    this.seen.clear();
    this.attempt = 0;
    this.sessionRefreshTried = false;
    this.start();
  }

  private sessionConsumers(): StreamConsumer[] {
    const key = this.session ? sessionKey(this.session) : '';
    return [...this.consumers].filter((c) => sessionKey(c.session) === key);
  }

  private setStatus(status: StreamStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const c of this.sessionConsumers()) c.onStatus?.(status);
  }

  /** Invalidates the running connection (reader, timers, queued events) and returns the new generation. */
  private kill(): number {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    for (const t of [this.retryTimer, this.watchdogTimer, this.stableTimer]) if (t) clearTimeout(t);
    this.retryTimer = this.watchdogTimer = this.stableTimer = null;
    return this.generation;
  }

  private start(): void {
    const gen = this.kill();
    if (!this.session) return;
    if (!this.deps.lifecycle.isOnline()) {
      this.setStatus('offline');
      return;
    }
    void this.run(gen);
  }

  private scheduleStart(delayMs: number): void {
    this.kill();
    this.setStatus('backoff');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start();
    }, Math.max(0, delayMs));
  }

  private backoff(): void {
    const delay = backoffDelay(this.attempt, this.deps.random);
    this.attempt += 1;
    this.scheduleStart(delay);
  }

  private async run(gen: number): Promise<void> {
    const cursorStore = this.cursor!;
    this.setStatus('connecting');

    if (!cursorStore.read()) {
      // No cursor yet: take it from the list first, so rows created between this GET and the
      // stream opening are replayed instead of lost (a cursor-less stream starts at "now").
      try {
        const max = await this.reconcileAll('bootstrap');
        if (gen !== this.generation) return;
        if (max) cursorStore.advance(max);
      } catch {
        if (gen !== this.generation) return;
      }
    }

    const cursor = cursorStore.read();
    const controller = new AbortController();
    this.abort = controller;
    const headers: Record<string, string> = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
    if (cursor) headers['Last-Event-ID'] = cursor;
    const url = cursor ? `${this.deps.url}?after_seq=${cursor}` : this.deps.url;

    let res: Response;
    try {
      res = await this.deps.fetch(url, { headers, credentials: 'include', cache: 'no-store', signal: controller.signal });
    } catch {
      if (gen === this.generation) this.backoff();
      return;
    }
    if (gen !== this.generation) {
      void res.body?.cancel().catch(() => {});
      return;
    }

    const type = res.headers.get('content-type') || '';
    if (res.status === 200 && res.body && type.includes('text/event-stream')) {
      await this.read(res.body, gen);
      return;
    }
    void res.body?.cancel().catch(() => {});

    if (res.status === 401) return this.onUnauthorized(gen);
    if (res.status === 403) return this.onForbidden(gen);
    if (res.status === 429 || res.status === 503) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'), this.deps.now());
      if (retryAfter != null) {
        this.attempt += 1;
        this.scheduleStart(retryAfter + Math.round(this.deps.random() * 1000));
        return;
      }
    }
    this.backoff();
  }

  private async read(body: ReadableStream<Uint8Array>, gen: number): Promise<void> {
    this.sessionRefreshTried = false;
    this.setStatus('open');
    this.lastByteAt = this.deps.now();
    this.armWatchdog(gen);
    this.stableTimer = setTimeout(() => {
      if (gen === this.generation) this.attempt = 0;
    }, this.deps.stableMs);

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (gen !== this.generation || done) break;
        this.lastByteAt = this.deps.now();
        this.armWatchdog(gen);
        for (const item of parser.feed(decoder.decode(value, { stream: true }))) {
          if (item.kind === 'event') this.enqueue(item, gen);
        }
      }
    } catch {
      /* aborted or connection lost */
    }
    void reader.cancel().catch(() => {});
    if (gen === this.generation) this.backoff();
  }

  private armWatchdog(gen: number): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      if (gen === this.generation) this.backoff();
    }, this.deps.watchdogMs);
  }

  private enqueue(item: SseMessage, gen: number): void {
    this.chain = this.chain
      .then(() => (gen === this.generation ? this.handle(item, gen) : undefined))
      .catch(() => {});
  }

  private async handle(item: SseMessage, gen: number): Promise<void> {
    switch (item.event) {
      case 'message':
        return this.handleNotification(item, gen);
      case 'resync':
        return this.handleResync(item, gen);
      case 'reconnect': {
        const data = safeJson(item.data) as { delay_ms?: unknown } | null;
        const delay =
          item.retry ?? (typeof data?.delay_ms === 'number' ? data.delay_ms : backoffDelay(this.attempt, this.deps.random));
        this.scheduleStart(delay);
        return;
      }
      case 'auth': {
        const data = safeJson(item.data) as { reason?: unknown } | null;
        return data?.reason === 'forbidden' ? this.onForbidden(gen) : this.onUnauthorized(gen);
      }
      default:
        return;
    }
  }

  private async handleNotification(item: SseMessage, gen: number): Promise<void> {
    const payload = safeJson(item.data) as StreamNotificationPayload | null;
    if (!payload || typeof payload !== 'object') return; // malformed: skipped, cursor unchanged
    const seq = isSeq(payload.seq) ? payload.seq : null;
    const cursor = this.cursor;
    const session = this.session;
    if (!cursor || !session) return;

    if (seq && this.seen.has(seq)) {
      if (item.id) cursor.advance(item.id);
      return;
    }
    try {
      await this.dispatch(payload, seq, 'stream');
    } catch {
      if (gen === this.generation) this.backoff();
      return;
    }
    // Handled: record it even if the connection was replaced meanwhile.
    if (seq) {
      this.seen.add(seq);
      this.post({ v: 1, session: sessionKey(session), kind: 'event', seq, payload });
    }
    if (item.id) cursor.advance(item.id);
  }

  private async handleResync(item: SseMessage, gen: number): Promise<void> {
    const data = safeJson(item.data) as { latest_seq?: unknown } | null;
    const target = item.id ?? (typeof data?.latest_seq === 'string' ? data.latest_seq : undefined);
    try {
      await this.reconcileAll('resync');
    } catch {
      if (gen === this.generation) this.backoff();
      return;
    }
    if (gen !== this.generation) return;
    if (target && isSeq(target)) this.cursor?.set(target);
  }

  private async dispatch(payload: StreamNotificationPayload, seq: string | null, source: 'stream' | 'relay'): Promise<void> {
    for (const c of this.sessionConsumers()) await c.onNotification(payload, { seq, source });
  }

  private async reconcileAll(reason: ReconcileReason): Promise<string | null> {
    let max: string | null = null;
    for (const c of this.sessionConsumers()) {
      const seq = await c.reconcile(reason);
      if (isSeq(seq) && (max == null || BigInt(seq) > BigInt(max))) max = seq;
    }
    return max;
  }

  private async onUnauthorized(gen: number): Promise<void> {
    if (gen !== this.generation) return;
    const g = this.kill();
    if (!this.sessionRefreshTried) {
      this.sessionRefreshTried = true;
      let ok = false;
      try {
        ok = await this.deps.refreshSession();
      } catch {
        ok = false;
      }
      if (g !== this.generation) return;
      if (ok) {
        this.start();
        return;
      }
    }
    this.setStatus('unauthorized');
    for (const c of this.sessionConsumers()) c.onUnauthorized?.();
  }

  private onForbidden(gen: number): void {
    if (gen !== this.generation) return;
    this.kill();
    this.setStatus('forbidden');
    // The consumer refreshes the auth context; a different business re-subscribes with a new
    // session. The same session stays stopped until a user-driven wake (no retry loop).
    for (const c of this.sessionConsumers()) c.onForbidden?.();
  }

  private onSignal(signal: LifecycleSignal): void {
    if (!this.session) return;
    switch (signal) {
      case 'offline':
        this.kill();
        this.setStatus('offline');
        return;
      case 'hidden':
        return;
      case 'visible':
        if (this.status === 'connecting') return;
        if (this.status === 'open' && this.deps.now() - this.lastByteAt < this.deps.watchdogMs) return;
        this.wake();
        return;
      case 'online':
      case 'resume':
        this.wake();
        return;
    }
  }

  /** Reconnect now (fresh backoff) and catch up the list. */
  private wake(): void {
    this.attempt = 0;
    if (this.cursor?.read()) void this.reconcileAll('wake').catch(() => {});
    this.start();
  }

  private poll(): void {
    if (!this.session || this.status === 'open') return;
    if (!this.deps.lifecycle.isVisible() || !this.deps.lifecycle.isOnline()) return;
    void this.reconcileAll('poll').catch(() => {});
  }

  private post(message: ChannelMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      /* channel closed */
    }
  }

  private onChannelMessage(data: unknown): void {
    const msg = data as ChannelMessage | null;
    if (!msg || msg.v !== 1 || !this.session || msg.session !== sessionKey(this.session)) return;
    if (msg.kind === 'dismiss' && Array.isArray(msg.keys)) {
      const keys = msg.keys.filter((k) => typeof k === 'string');
      for (const c of this.sessionConsumers()) c.onRemoteDismiss?.(keys);
      return;
    }
    if (msg.kind === 'event' && isSeq(msg.seq) && msg.payload && typeof msg.payload === 'object') {
      this.chain = this.chain
        .then(async () => {
          if (this.seen.has(msg.seq) || !this.session || msg.session !== sessionKey(this.session)) return;
          await this.dispatch(msg.payload, msg.seq, 'relay');
          this.seen.add(msg.seq);
        })
        .catch(() => {});
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function createBrowserStreamClient(overrides: Partial<StreamClientDeps> = {}): NotificationStreamClient {
  return new NotificationStreamClient({
    ...STREAM_CLIENT_DEFAULTS,
    fetch: (...args) => fetch(...args),
    storage: browserStorage(),
    random: Math.random,
    now: Date.now,
    lifecycle: browserLifecycle(),
    createChannel: (name) =>
      typeof BroadcastChannel !== 'undefined' ? (new BroadcastChannel(name) as unknown as ChannelLike) : null,
    refreshSession: async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', cache: 'no-store' });
        return res.ok;
      } catch {
        return false;
      }
    },
    ...overrides,
  });
}

const globalForClient = globalThis as unknown as { __khatarioNotificationStreamClient?: NotificationStreamClient };

/** The tab's single stream client (kept on globalThis so hot reload does not open a second one). */
export function getNotificationStreamClient(): NotificationStreamClient {
  if (!globalForClient.__khatarioNotificationStreamClient) {
    globalForClient.__khatarioNotificationStreamClient = createBrowserStreamClient();
  }
  return globalForClient.__khatarioNotificationStreamClient;
}
