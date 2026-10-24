import {
  CATCH_UP_BATCH,
  HEARTBEAT_MS,
  HINT_COALESCE_MS,
  MAX_CATCH_UP_ROWS,
  MAX_QUEUED_CHUNKS,
  MAX_WINDOW_ENTRIES,
  OVERLAP_WINDOW_MS,
  REAUTH_MS,
  SHUTDOWN_FLUSH_MS,
} from './config';
import type { StreamRow, StreamScope, StreamSource } from './catch-up';
import { encode, formatComment, formatEvent } from './sse';

export type AuthCheck = 'ok' | 'revoked' | 'forbidden';

export type CloseReason =
  | 'cancelled'
  | 'aborted'
  | 'write_failed'
  | 'slow_client'
  | 'auth'
  | 'error'
  | 'shutdown';

export interface ConnectionHost {
  /** Redis hints are flowing (subscriber and publisher ready); otherwise heartbeats poll. */
  hintsHealthy(): boolean;
  unregister(conn: StreamConnection): void;
  random(): number;
}

export type ConnectionOptions = {
  id: number;
  scope: StreamScope;
  initialCursor: bigint | null;
  source: StreamSource;
  authorize: () => Promise<AuthCheck>;
  host: ConnectionHost;
  maxQueuedChunks?: number;
};

const MAX_ROUNDS_PER_PULL = 20;

/**
 * One SSE stream. PostgreSQL rows are the only thing that is ever sent or that moves the
 * cursor; Redis hints just trigger a pull.
 *
 * Commit order: seq is allocated at insert time but transactions commit in any order, so a
 * lower seq can become visible after a higher one was delivered. Each pull therefore reads
 * from `floor` (the cursor as it was OVERLAP_WINDOW_MS ago) instead of the cursor, and skips
 * seqs already delivered inside that window. Hinted ids are also fetched directly, which
 * covers late commits for published types regardless of the window. A row whose transaction
 * stays open longer than the window (and is not hinted) can still be missed by the stream.
 */
export class StreamConnection {
  readonly id: number;
  readonly scope: StreamScope;
  phase: 'catching_up' | 'live' = 'catching_up';
  closed = false;
  closeReason: CloseReason | null = null;

  private cursor = 0n;
  private floor = 0n;
  private readonly window: { seq: bigint; at: number }[] = [];
  private readonly windowSeqs = new Set<string>();
  private readonly pendingIds = new Set<string>();
  private pulling = false;
  private dirty = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reauthTimer: ReturnType<typeof setInterval> | null = null;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: ConnectionOptions;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.scope = opts.scope;
  }

  get currentCursor(): bigint {
    return this.cursor;
  }

  /** Called from ReadableStream.start. The connection is already registered (live hints buffer). */
  attach(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.controller = controller;
    if (this.closed) {
      this.safeCloseController();
      return;
    }
    this.write(formatEvent('connected', { message: 'SSE stream connected' }));
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.reauthTimer = setInterval(() => void this.reauthorize(), REAUTH_MS);
    void this.catchUp();
  }

  /** A Redis hint for this user/business. Never sent to the client by itself. */
  onHint(notificationId: string | null): void {
    if (this.closed) return;
    if (notificationId) this.pendingIds.add(notificationId);
    if (this.pulling) {
      this.dirty = true;
      return;
    }
    if (this.phase === 'live') this.schedulePull(HINT_COALESCE_MS);
  }

  schedulePull(delayMs: number): void {
    if (this.closed || this.pullTimer) return;
    this.pullTimer = setTimeout(() => {
      this.pullTimer = null;
      void this.pull();
    }, delayMs);
  }

  /** Graceful shutdown: tell the client when to reconnect, then close. */
  async shutdown(retryMs: number): Promise<void> {
    if (this.closed) return;
    this.write(formatEvent('reconnect', { reason: 'shutdown', delay_ms: retryMs }, undefined, retryMs));
    await new Promise((r) => setTimeout(r, SHUTDOWN_FLUSH_MS));
    this.close('shutdown');
  }

  close(reason: CloseReason): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reauthTimer) clearInterval(this.reauthTimer);
    if (this.pullTimer) clearTimeout(this.pullTimer);
    this.heartbeatTimer = this.reauthTimer = this.pullTimer = null;
    this.pendingIds.clear();
    this.opts.host.unregister(this);
    this.safeCloseController();
  }

  private safeCloseController(): void {
    try {
      this.controller?.close();
    } catch {
      /* already closed or errored */
    }
  }

  /** Returns false (and closes) when the chunk cannot be written. */
  private write(chunk: string): boolean {
    if (this.closed || !this.controller) return false;
    const desired = this.controller.desiredSize;
    if (desired !== null && desired < -(this.opts.maxQueuedChunks ?? MAX_QUEUED_CHUNKS)) {
      this.close('slow_client');
      return false;
    }
    try {
      this.controller.enqueue(encode(chunk));
      return true;
    } catch {
      this.close('write_failed');
      return false;
    }
  }

  private heartbeat(): void {
    if (!this.write(formatComment('ping'))) return;
    if (this.phase === 'live' && !this.opts.host.hintsHealthy()) void this.pull();
  }

  private async reauthorize(): Promise<void> {
    if (this.closed) return;
    let result: AuthCheck;
    try {
      result = await this.opts.authorize();
    } catch {
      return; // transient (database); try again at the next interval
    }
    if (this.closed || result === 'ok') return;
    this.write(formatEvent('auth', { reason: result }));
    this.close('auth');
  }

  private async catchUp(): Promise<void> {
    const { source } = this.opts;
    try {
      if (this.opts.initialCursor == null) {
        this.cursor = this.floor = await source.latestSeq(this.scope);
      } else {
        const latest = await source.latestSeq(this.scope);
        if (this.opts.initialCursor > latest) {
          this.resyncTo(latest, 'cursor_ahead');
        } else {
          this.cursor = this.floor = this.opts.initialCursor;
          // Rows at or below the client's cursor that committed after it was sent.
          const recent = await source.fetchRecentAtOrBelow(this.scope, this.cursor, CATCH_UP_BATCH);
          if (this.closed) return;
          this.deliver(recent.filter((r) => r.recent));
        }
      }
      if (this.closed) return;
      await this.pull();
      if (!this.closed) this.phase = 'live';
    } catch {
      this.failAndReconnect();
    }
  }

  private async pull(): Promise<void> {
    if (this.closed) return;
    if (this.pulling) {
      this.dirty = true;
      return;
    }
    this.pulling = true;
    try {
      do {
        this.dirty = false;
        await this.pullOnce();
      } while (this.dirty && !this.closed);
    } catch {
      this.failAndReconnect();
    } finally {
      this.pulling = false;
    }
  }

  private async pullOnce(): Promise<void> {
    const { source } = this.opts;
    this.pruneWindow(Date.now());

    const ids = [...this.pendingIds];
    this.pendingIds.clear();
    // Hinted rows at or below the floor are late commits the range query cannot see; they are
    // merged into the first round so delivery stays in ascending seq order.
    let hinted: StreamRow[] = [];
    if (ids.length) {
      hinted = (await source.fetchByIds(this.scope, ids)).filter((r) => BigInt(r.seq) > this.floor || r.recent);
      if (this.closed) return;
    }

    let from = this.floor;
    let delivered = 0;
    for (let round = 0; round < MAX_ROUNDS_PER_PULL; round += 1) {
      const fetched = await source.fetchAfter(this.scope, from, CATCH_UP_BATCH);
      if (this.closed) return;
      const bound = continuationBound(fetched);
      const rows = [...hinted, ...fetched];
      hinted = [];
      // Rows past the bound (hinted or not) are re-read by the next round.
      delivered += this.deliver(bound == null ? rows : rows.filter((r) => BigInt(r.seq) <= bound));
      if (this.closed) return;
      if (delivered > MAX_CATCH_UP_ROWS) {
        this.resyncTo(await source.latestSeq(this.scope), 'too_many');
        return;
      }
      if (bound == null) return;
      from = bound;
    }
    this.resyncTo(await source.latestSeq(this.scope), 'too_many');
  }

  /** Sends rows not yet delivered in the window, ascending by seq. Returns how many were sent. */
  private deliver(rows: StreamRow[]): number {
    const sorted = [...rows].sort((a, b) => cmp(BigInt(a.seq), BigInt(b.seq)));
    let sent = 0;
    const now = Date.now();
    for (const row of sorted) {
      if (this.closed) break;
      if (this.windowSeqs.has(row.seq)) continue;
      const seq = BigInt(row.seq);
      // The event id is the connection cursor, so a late (lower) seq never moves the client's
      // Last-Event-ID backwards; payload.seq is always the row's own seq.
      if (seq > this.cursor) this.cursor = seq;
      if (!this.write(formatEvent('message', this.payload(row), this.cursor.toString()))) break;
      this.window.push({ seq, at: now });
      this.windowSeqs.add(row.seq);
      sent += 1;
    }
    return sent;
  }

  private payload(row: StreamRow) {
    return {
      type: row.type,
      businessId: this.scope.businessId,
      userId: this.scope.userId,
      notificationId: row.id,
      title: row.title,
      message: row.message,
      reference_id: row.reference_id,
      reference_type: row.reference_type,
      timestamp: Date.now(),
      seq: row.seq,
    };
  }

  private pruneWindow(now: number): void {
    while (
      this.window.length &&
      (now - this.window[0].at > OVERLAP_WINDOW_MS || this.window.length > MAX_WINDOW_ENTRIES)
    ) {
      const e = this.window.shift()!;
      this.windowSeqs.delete(e.seq.toString());
      if (e.seq > this.floor) this.floor = e.seq;
    }
  }

  /** Too much to replay (or a cursor from elsewhere): skip ahead and let the client refetch. */
  private resyncTo(latest: bigint, reason: 'too_many' | 'cursor_ahead'): void {
    this.cursor = this.floor = latest;
    this.window.length = 0;
    this.windowSeqs.clear();
    this.write(formatEvent('resync', { reason, latest_seq: latest.toString() }, latest.toString()));
  }

  private failAndReconnect(): void {
    if (this.closed) return;
    const retry = 5_000 + Math.floor(this.opts.host.random() * 10_000);
    this.write(formatEvent('reconnect', { reason: 'error', delay_ms: retry }, undefined, retry));
    this.close('error');
  }
}

function cmp(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * When a branch returns a full batch, rows beyond its last seq were not read yet, so only rows
 * up to the smallest such last seq are complete. Null when both branches were exhausted.
 */
function continuationBound(rows: StreamRow[]): bigint | null {
  let bound: bigint | null = null;
  for (const branch of ['own', 'broadcast'] as const) {
    const part = rows.filter((r) => r.branch === branch);
    if (part.length >= CATCH_UP_BATCH) {
      const last = part.reduce((m, r) => (BigInt(r.seq) > m ? BigInt(r.seq) : m), 0n);
      if (bound == null || last < bound) bound = last;
    }
  }
  return bound;
}
