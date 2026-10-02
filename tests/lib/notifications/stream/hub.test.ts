/**
 * Release 3 notification stream: registry, limits, cleanup, Redis fan-out/reconnect, catch-up
 * handshake, de-duplication, overlap reconciliation, heartbeat, re-authorization, shutdown.
 * Database behaviour is covered against real PostgreSQL in tests/db/notification-stream.db.test.ts.
 */
import { createNotificationStreamHub, type NotificationStreamHub } from '@/lib/notifications/stream/hub';
import type { AuthCheck } from '@/lib/notifications/stream/connection';
import { formatComment, formatEvent, parseCursor } from '@/lib/notifications/stream/sse';
import { attachAndRead, FakeSubscriber, MemorySource } from './sse-harness';

const BIZ = '22222222-2222-4222-8222-222222222222';
const BIZ2 = '33333333-3333-4333-8333-333333333333';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '55555555-5555-4555-8555-555555555555';

let source: MemorySource;
let sub: FakeSubscriber | null;
let publisherUp: boolean;
let hub: NotificationStreamHub;
let auth: jest.Mock<Promise<AuthCheck>, []>;

function makeHub(opts: { perUser?: number; perProcess?: number; noRedis?: boolean; maxQueuedChunks?: number } = {}) {
  sub = opts.noRedis ? null : new FakeSubscriber();
  const created = sub;
  return createNotificationStreamHub({
    source,
    createSubscriber: jest.fn(() => created),
    publisherReady: () => publisherUp,
    random: () => 0.5,
    installSignalHandlers: false,
    limits: { perUser: opts.perUser ?? 10, perProcess: opts.perProcess ?? 1000 },
    maxQueuedChunks: opts.maxQueuedChunks,
  });
}

function open(user = ALICE, business = BIZ, cursor: bigint | null = null) {
  const r = hub.open({ scope: { businessId: business, userId: user }, initialCursor: cursor, authorize: auth });
  if (!r.ok) throw new Error(`open refused: ${r.status}`);
  return { conn: r.connection, sse: attachAndRead(r.connection) };
}

const settle = () => jest.advanceTimersByTimeAsync(0);
const hintFor = (row: { id: string }, userId: string | null = ALICE, businessId = BIZ) =>
  sub!.publish({ type: 'general', businessId, userId, notificationId: row.id });

beforeEach(() => {
  jest.useFakeTimers();
  source = new MemorySource();
  publisherUp = true;
  auth = jest.fn(async () => 'ok' as AuthCheck);
  hub = makeHub();
});

afterEach(async () => {
  const done = hub.shutdown();
  await jest.advanceTimersByTimeAsync(1000);
  await done;
  jest.useRealTimers();
});

describe('cursor parsing and SSE format', () => {
  it('prefers Last-Event-ID, falls back to after_seq, ignores junk', () => {
    expect(parseCursor('42', '7')).toBe(42n);
    expect(parseCursor(null, '7')).toBe(7n);
    expect(parseCursor('abc', '7')).toBe(7n);
    expect(parseCursor(' 9 ', null)).toBe(9n);
    expect(parseCursor('-1', '1.5')).toBeNull();
    expect(parseCursor(null, null)).toBeNull();
    expect(parseCursor('1000000000001', null)).toBe(1000000000001n);
  });

  it('formats events and comments', () => {
    expect(formatEvent('message', { a: 1 }, '5')).toBe('id: 5\nevent: message\ndata: {"a":1}\n\n');
    expect(formatEvent('reconnect', {}, undefined, 1500)).toBe('retry: 1500\nevent: reconnect\ndata: {}\n\n');
    expect(formatComment('ping')).toBe(': ping\n\n');
  });
});

describe('catch-up and live delivery', () => {
  it('starts at the newest row without replay, then streams new rows by seq with legacy fields', async () => {
    source.insert({ businessId: BIZ, userId: ALICE });
    const { conn, sse } = open();
    await settle();
    expect(sse.events()[0]).toMatchObject({ event: 'connected' });
    expect(sse.messages()).toHaveLength(0);
    expect(conn.currentCursor).toBe(1n);

    const row = source.insert({ businessId: BIZ, userId: ALICE, type: 'todo_reminder' });
    hintFor(row);
    await jest.advanceTimersByTimeAsync(100);
    expect(sse.messages()).toEqual([
      {
        id: '2',
        event: 'message',
        data: expect.objectContaining({
          type: 'todo_reminder',
          businessId: BIZ,
          userId: ALICE,
          notificationId: row.id,
          title: row.title,
          message: row.message,
          reference_id: null,
          seq: '2',
          timestamp: expect.any(Number),
        }),
      },
    ]);
  });

  it('resumes after the cursor in ascending order, including own and broadcast rows only', async () => {
    source.insert({ businessId: BIZ, userId: ALICE, recent: false }); // 1, before cursor
    source.insert({ businessId: BIZ, userId: null }); // 2 broadcast
    source.insert({ businessId: BIZ, userId: BOB }); // 3 someone else
    source.insert({ businessId: BIZ2, userId: ALICE }); // 4 other business
    source.insert({ businessId: BIZ, userId: ALICE }); // 5
    const { sse } = open(ALICE, BIZ, 1n);
    await settle();
    expect(sse.messages().map((e) => e.data.seq)).toEqual(['2', '5']);
    expect(sse.messages().map((e) => e.id)).toEqual(['2', '5']);
  });

  it('re-sends recent rows at or below a reconnect cursor once (late commits before disconnect)', async () => {
    source.insert({ businessId: BIZ, userId: ALICE, recent: false }); // 1 old
    source.insert({ businessId: BIZ, userId: ALICE, recent: true }); // 2 recent
    source.insert({ businessId: BIZ, userId: ALICE }); // 3
    const { sse } = open(ALICE, BIZ, 3n);
    await settle();
    expect(sse.messages().map((e) => e.data.seq)).toEqual(['2', '3']);
    expect(sse.messages().map((e) => e.id)).toEqual(['3', '3']);
  });

  it('never sends or advances the cursor on a hint alone', async () => {
    const { conn, sse } = open();
    await settle();
    sub!.goReady();
    hintFor({ id: '00000000-0000-4000-8000-000000000099' });
    await jest.advanceTimersByTimeAsync(100);
    expect(sse.messages()).toHaveLength(0);
    expect(conn.currentCursor).toBe(0n);
  });

  it('de-duplicates by seq across repeated hints and pulls', async () => {
    const { sse } = open();
    await settle();
    const row = source.insert({ businessId: BIZ, userId: ALICE });
    hintFor(row);
    hintFor(row);
    await jest.advanceTimersByTimeAsync(100);
    hintFor(row);
    await jest.advanceTimersByTimeAsync(100);
    expect(sse.messages().map((e) => e.data.seq)).toEqual([row.seq]);
  });

  it('delivers a row that arrives during catch-up exactly once, after the catch-up rows', async () => {
    source.insert({ businessId: BIZ, userId: ALICE }); // 1
    source.insert({ businessId: BIZ, userId: ALICE }); // 2
    const release = source.pauseNextFetchAfter();
    const { conn, sse } = open(ALICE, BIZ, 0n);
    await settle();
    expect(conn.phase).toBe('catching_up');

    const late = source.insert({ businessId: BIZ, userId: ALICE }); // 3 commits mid catch-up
    hintFor(late);
    await settle();
    release();
    await jest.advanceTimersByTimeAsync(100);

    expect(conn.phase).toBe('live');
    expect(sse.messages().map((e) => e.data.seq)).toEqual(['1', '2', '3']);
  });

  it('delivers a lower seq that commits after a higher one, without moving the event id back', async () => {
    const { sse } = open();
    await settle();
    const slow = source.insert({ businessId: BIZ, userId: ALICE, visible: false }); // seq 1, uncommitted
    const fast = source.insert({ businessId: BIZ, userId: ALICE }); // seq 2 commits first
    hintFor(fast);
    await jest.advanceTimersByTimeAsync(100);
    slow.visible = true;
    hintFor(slow);
    await jest.advanceTimersByTimeAsync(100);

    const msgs = sse.messages();
    expect(msgs.map((e) => e.data.seq)).toEqual(['2', '1']);
    expect(msgs.map((e) => e.id)).toEqual(['2', '2']);
  });

  it('picks up an unhinted late commit inside the overlap window, not after it (documented limit)', async () => {
    const { sse } = open();
    await settle();
    sub!.goReady();
    const slow = source.insert({ businessId: BIZ, userId: ALICE, visible: false }); // 1
    const fast = source.insert({ businessId: BIZ, userId: ALICE }); // 2
    hintFor(fast);
    await jest.advanceTimersByTimeAsync(100);

    slow.visible = true; // no hint for this one (e.g. a type nobody publishes)
    const next = source.insert({ businessId: BIZ, userId: ALICE }); // 3
    hintFor(next);
    await jest.advanceTimersByTimeAsync(100);
    expect(sse.messages().map((e) => e.data.seq)).toEqual(['2', '1', '3']);

    const tooSlow = source.insert({ businessId: BIZ, userId: ALICE, visible: false }); // 4
    const after = source.insert({ businessId: BIZ, userId: ALICE }); // 5
    hintFor(after);
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(121_000);
    tooSlow.visible = true;
    const last = source.insert({ businessId: BIZ, userId: ALICE }); // 6
    hintFor(last);
    await jest.advanceTimersByTimeAsync(100);
    expect(sse.messages().map((e) => e.data.seq)).toEqual(['2', '1', '3', '5', '6']);
  });

  it('sends resync (with the new cursor as id) when catch-up exceeds the bound', async () => {
    for (let i = 0; i < 1101; i += 1) source.insert({ businessId: BIZ, userId: ALICE, recent: false });
    const { conn, sse } = open(ALICE, BIZ, 0n);
    await settle();
    const resync = sse.events().find((e) => e.event === 'resync');
    expect(resync).toMatchObject({ id: '1101', data: { reason: 'too_many', latest_seq: '1101' } });
    expect(conn.currentCursor).toBe(1101n);
    expect(conn.phase).toBe('live');
  });

  it('sends resync when the cursor is ahead of anything in scope', async () => {
    source.insert({ businessId: BIZ, userId: ALICE });
    const { conn, sse } = open(ALICE, BIZ, 999n);
    await settle();
    expect(sse.events().find((e) => e.event === 'resync')).toMatchObject({ id: '1', data: { reason: 'cursor_ahead' } });
    expect(conn.currentCursor).toBe(1n);
  });
});

describe('limits and registry cleanup', () => {
  it('allows 10 streams per user, then 429 with Retry-After; other users are unaffected', () => {
    for (let i = 0; i < 10; i += 1) open();
    const r = hub.open({ scope: { businessId: BIZ, userId: ALICE }, initialCursor: null, authorize: auth });
    expect(r).toMatchObject({ ok: false, status: 429, code: 'STREAM_LIMIT', retryAfterS: 30 });
    const r2 = hub.open({ scope: { businessId: BIZ2, userId: ALICE }, initialCursor: null, authorize: auth });
    expect(r2.ok).toBe(false);
    expect(hub.open({ scope: { businessId: BIZ, userId: BOB }, initialCursor: null, authorize: auth }).ok).toBe(true);
    expect(hub.size).toBe(11);
  });

  it('enforces the process-wide cap', () => {
    hub = makeHub({ perProcess: 2 });
    open(ALICE);
    open(BOB);
    const r = hub.open({ scope: { businessId: BIZ2, userId: ALICE }, initialCursor: null, authorize: auth });
    expect(r).toMatchObject({ ok: false, status: 429, retryAfterS: 15 });
  });

  it('frees the slot and timers when the client cancels', async () => {
    const { conn, sse } = open();
    await settle();
    expect(hub.size).toBe(1);
    await sse.cancel();
    await settle();
    expect(conn.closeReason).toBe('cancelled');
    expect(hub.size).toBe(0);
    expect(hub.countForUser(ALICE)).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('frees the slot when a write fails', async () => {
    const r = hub.open({ scope: { businessId: BIZ, userId: ALICE }, initialCursor: null, authorize: auth });
    if (!r.ok) throw new Error('refused');
    let calls = 0;
    r.connection.attach({
      desiredSize: 1,
      enqueue: () => {
        calls += 1;
        if (calls > 1) throw new TypeError('Invalid state: stream is closed');
      },
      close: () => {},
      error: () => {},
    } as unknown as ReadableStreamDefaultController<Uint8Array>);
    await jest.advanceTimersByTimeAsync(25_000);
    expect(r.connection.closeReason).toBe('write_failed');
    expect(hub.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('disconnects a client that stops reading', async () => {
    hub = makeHub({ maxQueuedChunks: 100 });
    const r = hub.open({ scope: { businessId: BIZ, userId: ALICE }, initialCursor: 0n, authorize: auth });
    if (!r.ok) throw new Error('refused');
    for (let i = 0; i < 700; i += 1) source.insert({ businessId: BIZ, userId: ALICE });
    // Attached but never read: chunks pile up in the stream queue.
    new ReadableStream<Uint8Array>({ start: (c) => r.connection.attach(c) });
    await settle();
    expect(r.connection.closeReason).toBe('slow_client');
    expect(hub.size).toBe(0);
  });

  it('frees the slot and tells the client when re-authorization fails', async () => {
    const { conn, sse } = open();
    await settle();
    auth.mockResolvedValue('forbidden');
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(sse.events().at(-1)).toMatchObject({ event: 'auth', data: { reason: 'forbidden' } });
    expect(conn.closeReason).toBe('auth');
    expect(hub.size).toBe(0);
  });
});

describe('heartbeat and re-authorization', () => {
  it('sends a ping every 25 seconds', async () => {
    const { sse } = open();
    await settle();
    await jest.advanceTimersByTimeAsync(24_999);
    expect(sse.events().filter((e) => e.comment === 'ping')).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(25_000);
    expect(sse.events().filter((e) => e.comment === 'ping')).toHaveLength(2);
  });

  it('re-checks authorization every 5 minutes and closes on revocation', async () => {
    const { conn, sse } = open();
    await settle();
    await jest.advanceTimersByTimeAsync(4 * 60_000);
    expect(auth).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(auth).toHaveBeenCalledTimes(1);
    expect(conn.closed).toBe(false);

    auth.mockRejectedValueOnce(new Error('db down'));
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(conn.closed).toBe(false);

    auth.mockResolvedValueOnce('revoked');
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(sse.events().at(-1)).toMatchObject({ event: 'auth', data: { reason: 'revoked' } });
    expect(conn.closed).toBe(true);
  });
});

describe('Redis subscriber', () => {
  it('uses one subscriber per process and subscribes once', async () => {
    const create = jest.fn(() => sub);
    sub = new FakeSubscriber();
    hub = createNotificationStreamHub({
      source,
      createSubscriber: create,
      publisherReady: () => true,
      random: () => 0.5,
      installSignalHandlers: false,
      limits: { perUser: 10, perProcess: 100 },
    });
    open(ALICE);
    open(ALICE);
    open(BOB);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sub.subscribe).toHaveBeenCalledTimes(1);
    expect(sub.subscribe).toHaveBeenCalledWith('notifications');
    expect(sub.listenerCount('message')).toBe(1);
    expect(hub.subscriberCount).toBe(1);
  });

  it('fans a hint out to that user in that business only; business-wide hints reach everyone there', async () => {
    const a1 = open(ALICE, BIZ);
    const a2 = open(ALICE, BIZ);
    const aOther = open(ALICE, BIZ2);
    const b = open(BOB, BIZ);
    await settle();
    const spies = [a1, a2, aOther, b].map(({ conn }) => jest.spyOn(conn, 'onHint'));

    sub!.publish({ businessId: BIZ, userId: ALICE, notificationId: null });
    expect(spies.map((s) => s.mock.calls.length)).toEqual([1, 1, 0, 0]);

    sub!.publish({ businessId: BIZ, notificationId: null });
    expect(spies.map((s) => s.mock.calls.length)).toEqual([2, 2, 0, 1]);

    sub!.publish('not json');
    sub!.publish({ businessId: 'nope', userId: ALICE });
    sub!.emit('message', 'other-channel', JSON.stringify({ businessId: BIZ }));
    expect(spies.map((s) => s.mock.calls.length)).toEqual([2, 2, 0, 1]);
  });

  it('re-runs catch-up for every stream (with jitter) after Redis reconnects', async () => {
    sub!.goReady();
    const a = open(ALICE);
    const b = open(BOB);
    await settle();
    sub!.drop();
    const missedA = source.insert({ businessId: BIZ, userId: ALICE });
    const missedB = source.insert({ businessId: BIZ, userId: null });
    // The hints for these were published while Redis was down and are lost.
    sub!.goReady();
    await jest.advanceTimersByTimeAsync(4_999);
    expect(a.sse.messages()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(a.sse.messages().map((e) => e.data.seq)).toEqual([missedA.seq, missedB.seq]);
    expect(b.sse.messages().map((e) => e.data.seq)).toEqual([missedB.seq]);
  });

  it('polls on each heartbeat while Redis is down or not configured', async () => {
    hub = makeHub({ noRedis: true });
    const { sse } = open();
    await settle();
    const row = source.insert({ businessId: BIZ, userId: ALICE });
    await jest.advanceTimersByTimeAsync(25_000);
    expect(sse.messages().map((e) => e.data.seq)).toEqual([row.seq]);
  });

  it('polls while the publisher is down even if the subscriber is up', async () => {
    sub!.goReady();
    publisherUp = false;
    const { sse } = open();
    await settle();
    const row = source.insert({ businessId: BIZ, userId: ALICE });
    await jest.advanceTimersByTimeAsync(25_000);
    expect(sse.messages().map((e) => e.data.seq)).toEqual([row.seq]);
  });
});

describe('shutdown', () => {
  it('asks every stream to reconnect with jitter, closes them, quits Redis and refuses new streams', async () => {
    sub!.goReady();
    const a = open(ALICE);
    const b = open(BOB);
    await settle();
    const done = hub.shutdown();
    expect(hub.open({ scope: { businessId: BIZ, userId: ALICE }, initialCursor: null, authorize: auth })).toMatchObject({
      ok: false,
      status: 503,
      code: 'SHUTTING_DOWN',
    });
    await jest.advanceTimersByTimeAsync(300);
    await done;

    for (const { conn, sse } of [a, b]) {
      const ev = sse.events().find((e) => e.event === 'reconnect');
      expect(ev?.retry).toBeGreaterThanOrEqual(1000);
      expect(ev?.retry).toBeLessThanOrEqual(10_000);
      expect(ev?.data).toMatchObject({ reason: 'shutdown', delay_ms: ev?.retry });
      expect(conn.closeReason).toBe('shutdown');
    }
    expect(hub.size).toBe(0);
    expect(sub!.unsubscribe).toHaveBeenCalledWith('notifications');
    expect(sub!.quit).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
