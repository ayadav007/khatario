function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const STREAM_CHANNEL = 'notifications';

export const HEARTBEAT_MS = 25_000;
export const REAUTH_MS = 5 * 60_000;

export const MAX_STREAMS_PER_USER = 10;
/** Per Node process; staging/production run a single `next start` process. */
export const MAX_STREAMS_PER_PROCESS = envInt('NOTIFICATION_STREAM_MAX_CONNECTIONS', 1000);
export const RETRY_AFTER_USER_LIMIT_S = 30;
export const RETRY_AFTER_PROCESS_LIMIT_S = 15;
export const RETRY_AFTER_SHUTDOWN_S = 5;

/**
 * Rows whose transaction commits after a higher seq was already delivered are re-read for this
 * long. Must exceed the longest notification-writing transaction (reminder upserts take ms).
 */
export const OVERLAP_WINDOW_MS = 120_000;
/** Bound on the delivered-seq memory used for de-duplication inside the overlap window. */
export const MAX_WINDOW_ENTRIES = 2000;

/** Rows fetched per query branch per round. */
export const CATCH_UP_BATCH = 200;
/** Above this many rows in one catch-up the client is told to resync from the list API. */
export const MAX_CATCH_UP_ROWS = 1000;

/** Coalesces bursts of Redis hints into one database pull per connection. */
export const HINT_COALESCE_MS = 50;
/** After Redis comes back, each connection re-runs catch-up after a random delay up to this. */
export const REDIS_RESYNC_JITTER_MS = 10_000;
/** Shutdown asks clients to reconnect after a random delay in this range (SSE `retry:`). */
export const SHUTDOWN_RECONNECT_MIN_MS = 1_000;
export const SHUTDOWN_RECONNECT_MAX_MS = 10_000;
/** Lets the reconnect event flush before the stream is closed during shutdown. */
export const SHUTDOWN_FLUSH_MS = 250;

/**
 * Queued (unsent) SSE chunks before a client is treated as too slow and disconnected. Well
 * above MAX_CATCH_UP_ROWS so a full catch-up burst never trips it.
 */
export const MAX_QUEUED_CHUNKS = 5000;

/** Subscriber reconnect back-off, capped. */
export function subscriberRetryDelay(attempt: number): number {
  return Math.min(500 * 2 ** Math.min(attempt, 5), 10_000);
}
