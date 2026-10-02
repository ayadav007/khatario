import { EventEmitter } from 'events';
import type { StreamRow, StreamScope, StreamSource } from '@/lib/notifications/stream/catch-up';
import type { StreamConnection } from '@/lib/notifications/stream/connection';
import type { SubscriberLike } from '@/lib/notifications/stream/hub';

export type SseEvent = { id?: string; event?: string; data?: any; retry?: number; comment?: string };

export function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const ev: SseEvent = {};
      for (const line of block.split('\n')) {
        if (line.startsWith(': ')) ev.comment = line.slice(2);
        else if (line.startsWith('id: ')) ev.id = line.slice(4);
        else if (line.startsWith('event: ')) ev.event = line.slice(7);
        else if (line.startsWith('retry: ')) ev.retry = Number(line.slice(7));
        else if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
      }
      return ev;
    });
}

/** Reads an SSE body (from a Response or a connection attached to a fresh ReadableStream). */
export function readSse(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let text = '';
  let done = false;
  void (async () => {
    for (;;) {
      const r = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (r.done) break;
      text += decoder.decode(r.value);
    }
    done = true;
  })();
  return {
    get text() {
      return text;
    },
    get done() {
      return done;
    },
    events: () => parseSse(text),
    messages: () => parseSse(text).filter((e) => e.event === 'message'),
    cancel: () => reader.cancel().catch(() => {}),
  };
}

export function attachAndRead(conn: StreamConnection) {
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => conn.attach(c),
    cancel: () => conn.close('cancelled'),
  });
  return readSse(stream);
}

type MemRow = StreamRow & { business_id: string; visible: boolean };

/**
 * In-memory notifications table with the same query contract as dbStreamSource. Rows can be
 * inserted invisible (uncommitted) and made visible later, and fetchAfter can be paused.
 */
export class MemorySource implements StreamSource {
  rows: MemRow[] = [];
  private nextSeq = 1n;
  private pauses: (() => Promise<void>)[] = [];
  calls: { fn: string; scope: StreamScope; arg?: unknown }[] = [];

  insert(r: { businessId: string; userId: string | null; type?: string; visible?: boolean; recent?: boolean }): MemRow {
    const seq = this.nextSeq++;
    const row: MemRow = {
      branch: r.userId ? 'own' : 'broadcast',
      id: `00000000-0000-4000-8000-${seq.toString().padStart(12, '0')}`,
      seq: seq.toString(),
      type: r.type ?? 'general',
      title: `t${seq}`,
      message: `m${seq}`,
      reference_type: null,
      reference_id: null,
      user_id: r.userId,
      recent: r.recent ?? true,
      business_id: r.businessId,
      visible: r.visible ?? true,
    };
    this.rows.push(row);
    return row;
  }

  /** Next fetchAfter waits for the returned release function. */
  pauseNextFetchAfter(): () => void {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    this.pauses.push(() => gate);
    return release;
  }

  private scoped(scope: StreamScope) {
    return this.rows.filter(
      (r) => r.visible && r.business_id === scope.businessId && (r.user_id === scope.userId || r.user_id === null)
    );
  }

  async latestSeq(scope: StreamScope) {
    this.calls.push({ fn: 'latestSeq', scope });
    return this.scoped(scope).reduce((m, r) => (BigInt(r.seq) > m ? BigInt(r.seq) : m), 0n);
  }

  async fetchAfter(scope: StreamScope, afterSeq: bigint, limit: number) {
    this.calls.push({ fn: 'fetchAfter', scope, arg: afterSeq });
    // Snapshot first, like a query: rows committed while paused are not in this result.
    const rows = this.scoped(scope).filter((r) => BigInt(r.seq) > afterSeq);
    const pause = this.pauses.shift();
    if (pause) await pause();
    const branch = (b: 'own' | 'broadcast') =>
      rows
        .filter((r) => r.branch === b)
        .sort((a, c) => Number(BigInt(a.seq) - BigInt(c.seq)))
        .slice(0, limit);
    return [...branch('own'), ...branch('broadcast')].map(strip);
  }

  async fetchRecentAtOrBelow(scope: StreamScope, atOrBelow: bigint, limit: number) {
    this.calls.push({ fn: 'fetchRecentAtOrBelow', scope, arg: atOrBelow });
    return this.scoped(scope)
      .filter((r) => BigInt(r.seq) <= atOrBelow)
      .sort((a, c) => Number(BigInt(c.seq) - BigInt(a.seq)))
      .slice(0, limit)
      .map(strip);
  }

  async fetchByIds(scope: StreamScope, ids: string[]) {
    this.calls.push({ fn: 'fetchByIds', scope, arg: ids });
    return this.scoped(scope).filter((r) => ids.includes(r.id)).map(strip);
  }
}

function strip(r: MemRow): StreamRow {
  const { business_id: _b, visible: _v, ...row } = r;
  return row;
}

export class FakeSubscriber extends EventEmitter implements SubscriberLike {
  status = 'connecting';
  subscribe = jest.fn(async (_channel: string) => 1);
  unsubscribe = jest.fn(async (_channel: string) => 1);
  quit = jest.fn(async () => 'OK');

  goReady() {
    this.status = 'ready';
    this.emit('ready');
  }

  drop() {
    this.status = 'reconnecting';
    this.emit('close');
  }

  publish(message: unknown) {
    this.emit('message', 'notifications', typeof message === 'string' ? message : JSON.stringify(message));
  }
}
