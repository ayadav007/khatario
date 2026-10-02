import Redis from 'ioredis';
import { getRedisConnection } from '@/lib/queue/redis';
import { isUuid } from '@/lib/notifications/notification-session';
import { dbStreamSource, type StreamScope, type StreamSource } from './catch-up';
import {
  MAX_STREAMS_PER_PROCESS,
  MAX_STREAMS_PER_USER,
  REDIS_RESYNC_JITTER_MS,
  RETRY_AFTER_PROCESS_LIMIT_S,
  RETRY_AFTER_SHUTDOWN_S,
  RETRY_AFTER_USER_LIMIT_S,
  SHUTDOWN_RECONNECT_MAX_MS,
  SHUTDOWN_RECONNECT_MIN_MS,
  STREAM_CHANNEL,
  subscriberRetryDelay,
} from './config';
import { StreamConnection, type AuthCheck, type ConnectionHost } from './connection';

/** The parts of an ioredis client the hub uses (lets tests drive connect/disconnect). */
export interface SubscriberLike {
  status: string;
  on(event: 'ready' | 'close' | 'end', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

export type HubDeps = {
  source: StreamSource;
  createSubscriber: () => SubscriberLike | null;
  publisherReady: () => boolean;
  random: () => number;
  installSignalHandlers: boolean;
  limits: { perUser: number; perProcess: number };
  maxQueuedChunks?: number;
};

export type OpenResult =
  | { ok: true; connection: StreamConnection }
  | { ok: false; status: 429 | 503; retryAfterS: number; code: 'STREAM_LIMIT' | 'SHUTTING_DOWN' };

function defaultSubscriber(): SubscriberLike | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // Separate from the shared publisher/BullMQ client (which never retries): a subscriber
  // connection cannot run other commands, and this one must come back after Redis restarts.
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    connectTimeout: 5000,
    retryStrategy: (times) => subscriberRetryDelay(times),
  });
}

function defaultPublisherReady(): boolean {
  return getRedisConnection()?.status === 'ready';
}

/**
 * Process-wide registry of notification streams with one Redis subscriber for all of them.
 * Hints are fanned out by business/user; each connection then reads its own rows from
 * PostgreSQL, so a mis-routed hint can never leak data.
 */
export class NotificationStreamHub implements ConnectionHost {
  private readonly deps: HubDeps;
  private readonly connections = new Set<StreamConnection>();
  private readonly byUser = new Map<string, Set<StreamConnection>>();
  private readonly byBusiness = new Map<string, Set<StreamConnection>>();
  private nextId = 1;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private subscriber: SubscriberLike | null = null;
  private subscriberStarted = false;
  private subscriberReady = false;
  private subscriberWasReady = false;
  private signalsInstalled = false;

  constructor(deps: HubDeps) {
    this.deps = deps;
  }

  get size(): number {
    return this.connections.size;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  get subscriberCount(): number {
    return this.subscriber ? 1 : 0;
  }

  countForUser(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  random(): number {
    return this.deps.random();
  }

  hintsHealthy(): boolean {
    return this.subscriberReady && this.deps.publisherReady();
  }

  /**
   * Checks limits and registers synchronously (no await between check and insert), so
   * concurrent requests cannot both pass the last free slot.
   */
  open(params: { scope: StreamScope; initialCursor: bigint | null; authorize: () => Promise<AuthCheck> }): OpenResult {
    if (this.shuttingDown) {
      return { ok: false, status: 503, retryAfterS: RETRY_AFTER_SHUTDOWN_S, code: 'SHUTTING_DOWN' };
    }
    if (this.countForUser(params.scope.userId) >= this.deps.limits.perUser) {
      return { ok: false, status: 429, retryAfterS: RETRY_AFTER_USER_LIMIT_S, code: 'STREAM_LIMIT' };
    }
    if (this.connections.size >= this.deps.limits.perProcess) {
      return { ok: false, status: 429, retryAfterS: RETRY_AFTER_PROCESS_LIMIT_S, code: 'STREAM_LIMIT' };
    }

    const connection = new StreamConnection({
      id: this.nextId++,
      scope: params.scope,
      initialCursor: params.initialCursor,
      source: this.deps.source,
      authorize: params.authorize,
      host: this,
      maxQueuedChunks: this.deps.maxQueuedChunks,
    });
    this.connections.add(connection);
    addTo(this.byUser, params.scope.userId, connection);
    addTo(this.byBusiness, params.scope.businessId, connection);
    this.ensureSubscriber();
    this.ensureSignalHandlers();
    return { ok: true, connection };
  }

  unregister(conn: StreamConnection): void {
    this.connections.delete(conn);
    removeFrom(this.byUser, conn.scope.userId, conn);
    removeFrom(this.byBusiness, conn.scope.businessId, conn);
  }

  /** Routes a Redis message to the matching local connections as a pull hint. */
  handleMessage(message: string): void {
    let hint: { businessId?: unknown; userId?: unknown; notificationId?: unknown };
    try {
      hint = JSON.parse(message);
    } catch {
      return;
    }
    if (!hint || typeof hint !== 'object' || !isUuid(hint.businessId as string)) return;
    const businessId = hint.businessId as string;
    const notificationId = isUuid(hint.notificationId as string) ? (hint.notificationId as string) : null;

    const targets = isUuid(hint.userId as string)
      ? [...(this.byUser.get(hint.userId as string) ?? [])].filter((c) => c.scope.businessId === businessId)
      : [...(this.byBusiness.get(businessId) ?? [])];
    for (const conn of targets) conn.onHint(notificationId);
  }

  private ensureSubscriber(): void {
    if (this.subscriberStarted) return;
    this.subscriberStarted = true;
    const sub = this.deps.createSubscriber();
    if (!sub) return; // no Redis configured: connections poll on their heartbeat
    this.subscriber = sub;

    sub.on('message', (channel, message) => {
      if (channel === STREAM_CHANNEL) this.handleMessage(message);
    });
    sub.on('ready', () => this.onSubscriberReady());
    sub.on('close', () => {
      this.subscriberReady = false;
    });
    sub.on('end', () => {
      this.subscriberReady = false;
    });
    sub.on('error', () => {
      /* reconnects via retryStrategy; status is tracked through ready/close */
    });
    // ioredis re-subscribes automatically after reconnecting.
    sub.subscribe(STREAM_CHANNEL).catch(() => {});
    if (sub.status === 'ready') this.onSubscriberReady();
  }

  private onSubscriberReady(): void {
    if (this.subscriberReady) return;
    this.subscriberReady = true;
    const reconnected = this.subscriberWasReady;
    this.subscriberWasReady = true;
    if (!reconnected) return;
    // Hints published while Redis was down are lost: every stream re-reads from its cursor.
    for (const conn of this.connections) {
      conn.schedulePull(Math.floor(this.deps.random() * REDIS_RESYNC_JITTER_MS));
    }
  }

  private ensureSignalHandlers(): void {
    if (this.signalsInstalled || !this.deps.installSignalHandlers) return;
    this.signalsInstalled = true;
    // Next's own SIGTERM/SIGINT handler calls server.close() and exits once every connection
    // has ended; open streams would hold that until PM2 kills the process. This only ends the
    // streams and Redis subscription; Next still owns the exit (and the DB pool with it).
    const onSignal = () => void this.shutdown();
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = (async () => {
      const span = SHUTDOWN_RECONNECT_MAX_MS - SHUTDOWN_RECONNECT_MIN_MS;
      await Promise.all(
        [...this.connections].map((c) =>
          c.shutdown(SHUTDOWN_RECONNECT_MIN_MS + Math.floor(this.deps.random() * span))
        )
      );
      const sub = this.subscriber;
      this.subscriber = null;
      this.subscriberReady = false;
      if (sub) {
        await sub.unsubscribe(STREAM_CHANNEL).catch(() => {});
        await sub.quit().catch(() => {});
      }
    })();
    return this.shutdownPromise;
  }
}

function addTo(map: Map<string, Set<StreamConnection>>, key: string, conn: StreamConnection): void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(conn);
}

function removeFrom(map: Map<string, Set<StreamConnection>>, key: string, conn: StreamConnection): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) map.delete(key);
}

export function createNotificationStreamHub(overrides: Partial<HubDeps> = {}): NotificationStreamHub {
  return new NotificationStreamHub({
    source: dbStreamSource,
    createSubscriber: defaultSubscriber,
    publisherReady: defaultPublisherReady,
    random: Math.random,
    installSignalHandlers: process.env.NODE_ENV !== 'test',
    limits: { perUser: MAX_STREAMS_PER_USER, perProcess: MAX_STREAMS_PER_PROCESS },
    ...overrides,
  });
}

const globalForHub = globalThis as unknown as { __khatarioNotificationStreamHub?: NotificationStreamHub };

/** One hub per process; kept on globalThis so dev hot reload does not create a second one. */
export function getNotificationStreamHub(): NotificationStreamHub {
  if (!globalForHub.__khatarioNotificationStreamHub) {
    globalForHub.__khatarioNotificationStreamHub = createNotificationStreamHub();
  }
  return globalForHub.__khatarioNotificationStreamHub;
}

/** Tests only: replace the process hub. */
export function setNotificationStreamHubForTests(hub: NotificationStreamHub | undefined): void {
  globalForHub.__khatarioNotificationStreamHub = hub;
}
