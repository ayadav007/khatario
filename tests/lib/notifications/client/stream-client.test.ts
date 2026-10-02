/**
 * Release 4 stream client: fetch-based SSE, cursor, de-duplication, reconnect/backoff,
 * auth handling, lifecycle (online/visibility/WebView resume), fallback polling, cross-tab
 * relay and cleanup. The real client runs against a scripted fetch; nothing under test is mocked.
 */
import {
  ChannelBus,
  consumer,
  flush,
  MemoryStorage,
  msg,
  OTHER_SESSION,
  SESSION,
  setup,
  useClientFakeTimers,
} from './client-harness';

const CURSOR_KEY = `khatario:notif-cursor:v1:${SESSION.businessId}:${SESSION.userId}`;

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => useClientFakeTimers());
afterEach(() => jest.useRealTimers());

describe('connect and cursor', () => {
  it('bootstraps the cursor from the list before the first connect and sends it both ways', async () => {
    const t = setup();
    const list = deferred<string>();
    const c = consumer(SESSION, { reconcile: jest.fn(() => list.promise) });
    t.client.subscribe(c);
    await flush();
    expect(c.reconcile).toHaveBeenCalledWith('bootstrap');
    expect(t.server.calls).toHaveLength(0);

    list.resolve('41');
    await flush();
    expect(t.server.calls).toHaveLength(1);
    expect(t.server.last().url).toBe('/api/notifications/stream?after_seq=41');
    expect(t.server.last().headers).toMatchObject({ 'Last-Event-ID': '41', Accept: 'text/event-stream' });
    expect(t.storage.getItem(CURSOR_KEY)).toBe('41');
  });

  it('uses a persisted cursor without a bootstrap GET', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CURSOR_KEY, '1000000000007');
    const t = setup({ storage });
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    expect(c.reconcile).not.toHaveBeenCalled();
    expect(t.server.last().headers['Last-Event-ID']).toBe('1000000000007');
  });

  it('starts an empty session at 0 so rows created before the stream opens are replayed', async () => {
    const t = setup();
    t.client.subscribe(consumer(SESSION, { reconcile: jest.fn(async () => '0') }));
    await flush();
    expect(t.server.last().url).toBe('/api/notifications/stream?after_seq=0');
  });

  it('connects without a cursor when the bootstrap GET fails', async () => {
    const t = setup();
    t.client.subscribe(consumer(SESSION, { reconcile: jest.fn(async () => Promise.reject(new Error('500'))) }));
    await flush();
    expect(t.server.last().url).toBe('/api/notifications/stream');
    expect(t.server.last().headers['Last-Event-ID']).toBeUndefined();
  });

  it('keeps a separate cursor per session when the business switches', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CURSOR_KEY, '50');
    storage.setItem(`khatario:notif-cursor:v1:${OTHER_SESSION.businessId}:${OTHER_SESSION.userId}`, '7');
    const t = setup({ storage });
    const offA = t.client.subscribe(consumer());
    await flush();
    t.server.last().stream().push(msg(51));
    await flush();
    expect(storage.getItem(CURSOR_KEY)).toBe('51');

    t.client.subscribe(consumer(OTHER_SESSION));
    offA();
    await flush();
    expect(t.server.calls[0].signal.aborted).toBe(true);
    expect(t.server.last().headers['Last-Event-ID']).toBe('7');
    expect(storage.getItem(CURSOR_KEY)).toBe('51');
  });

  it("bootstraps a session without a stored cursor from that session's server cursor only", async () => {
    const storage = new MemoryStorage();
    storage.setItem(CURSOR_KEY, '50');
    const otherKey = `khatario:notif-cursor:v1:${OTHER_SESSION.businessId}:${OTHER_SESSION.userId}`;
    const t = setup({ storage });
    const a = consumer(SESSION, { reconcile: jest.fn(async () => '900') });
    const offA = t.client.subscribe(a);
    await flush();
    expect(a.reconcile).not.toHaveBeenCalled();

    const b = consumer(OTHER_SESSION, { reconcile: jest.fn(async () => '12') });
    t.client.subscribe(b);
    offA();
    await flush();
    expect(b.reconcile).toHaveBeenCalledWith('bootstrap');
    expect(t.server.last().headers['Last-Event-ID']).toBe('12');
    expect(storage.getItem(otherKey)).toBe('12');
    expect(storage.getItem(CURSOR_KEY)).toBe('50');
  });

  it('never moves a stored cursor from a later GET (wake, poll), lower or higher', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CURSOR_KEY, '50');
    const t = setup({ storage });
    const c = consumer(SESSION, { reconcile: jest.fn().mockResolvedValueOnce('10').mockResolvedValueOnce('99') });
    t.client.subscribe(c);
    await flush();
    t.lifecycle.emit('resume');
    await flush();
    t.lifecycle.emit('resume');
    await flush();
    expect(c.reconcile).toHaveBeenCalledTimes(2);
    expect(c.reconcile).not.toHaveBeenCalledWith('bootstrap');
    expect(storage.getItem(CURSOR_KEY)).toBe('50');
    expect(t.server.last().headers['Last-Event-ID']).toBe('50');
  });

  it('opens one connection per tab for several consumers of the session', async () => {
    const t = setup();
    const a = consumer();
    const b = consumer();
    t.client.subscribe(a);
    t.client.subscribe(b);
    await flush();
    expect(t.server.calls).toHaveLength(1);
    const s = t.server.last().stream();
    s.push(msg(5));
    await flush();
    expect(a.onNotification).toHaveBeenCalledTimes(1);
    expect(b.onNotification).toHaveBeenCalledTimes(1);
  });
});

describe('processing, cursor advancement and de-duplication', () => {
  it('advances the cursor only after the consumer finished handling the event', async () => {
    const t = setup();
    const done = deferred();
    const c = consumer(SESSION, { onNotification: jest.fn(() => done.promise) });
    t.client.subscribe(c);
    await flush();
    const s = t.server.last().stream();
    s.push(msg(5));
    await flush();
    expect(c.onNotification).toHaveBeenCalledWith(expect.objectContaining({ seq: '5' }), { seq: '5', source: 'stream' });
    expect(t.client.currentCursor).toBe('0');

    done.resolve();
    await flush();
    expect(t.client.currentCursor).toBe('5');
    expect(t.storage.getItem(CURSOR_KEY)).toBe('5');
  });

  it('keeps the cursor when handling fails, skips later events, reconnects and replays', async () => {
    const t = setup();
    const c = consumer(SESSION, {
      onNotification: jest.fn().mockRejectedValueOnce(new Error('render failed')).mockResolvedValue(undefined),
    });
    t.client.subscribe(c);
    await flush();
    t.server.last().stream().push(msg(5) + msg(6));
    await flush();
    expect(c.onNotification).toHaveBeenCalledTimes(1);
    expect(t.client.currentCursor).toBe('0');
    expect(t.client.currentStatus).toBe('backoff');

    await jest.advanceTimersByTimeAsync(1000);
    expect(t.server.calls).toHaveLength(2);
    expect(t.server.last().headers['Last-Event-ID']).toBe('0');
    t.server.last().stream().push(msg(5) + msg(6));
    await flush();
    expect(c.onNotification.mock.calls.map(([p]) => p.seq)).toEqual(['5', '5', '6']);
    expect(t.client.currentCursor).toBe('6');
  });

  it('never advances the cursor for a malformed event', async () => {
    const t = setup();
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    t.server.last().stream().push('id: 9\nevent: message\ndata: {not json\n\n');
    await flush();
    expect(c.onNotification).not.toHaveBeenCalled();
    expect(t.client.currentCursor).toBe('0');
  });

  it('handles each seq once, still following the cursor for duplicates', async () => {
    const t = setup();
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    t.server.last().stream().push(msg(5) + msg(5, { id: 6 }) + msg(7));
    await flush();
    expect(c.onNotification.mock.calls.map(([p]) => p.seq)).toEqual(['5', '7']);
    expect(t.client.currentCursor).toBe('7');
  });

  it('uses the event id as the cursor, so a late lower seq never moves it back', async () => {
    const t = setup();
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    t.server.last().stream().push(msg(10) + msg(8, { id: 10 }));
    await flush();
    expect(c.onNotification.mock.calls.map(([p]) => p.seq)).toEqual(['10', '8']);
    expect(t.client.currentCursor).toBe('10');
  });

  it('keeps de-duplication memory bounded', async () => {
    const t = setup({ dedupMax: 3 });
    t.client.subscribe(consumer());
    await flush();
    t.server.last().stream().push([1, 2, 3, 4, 5].map((s) => msg(s)).join(''));
    await flush();
    expect(t.client.dedupSize).toBe(3);
  });
});

describe('control events', () => {
  it('on resync runs the list reconcile first, then moves the cursor, then handles later events', async () => {
    const t = setup();
    const list = deferred<string>();
    const c = consumer(SESSION, {
      reconcile: jest.fn().mockResolvedValueOnce('0').mockImplementationOnce(() => list.promise),
    });
    t.client.subscribe(c);
    await flush();
    t.server.last().stream().push(
      'id: 900\nevent: resync\ndata: {"reason":"too_many","latest_seq":"900"}\n\n' + msg(901)
    );
    await flush();
    expect(c.reconcile).toHaveBeenLastCalledWith('resync');
    expect(c.onNotification).not.toHaveBeenCalled();
    expect(t.client.currentCursor).toBe('0');

    list.resolve('900');
    await flush();
    expect(c.onNotification).toHaveBeenCalledTimes(1);
    expect(t.client.currentCursor).toBe('901');
  });

  it('a resync that cannot reconcile keeps the old cursor and reconnects', async () => {
    const t = setup();
    const c = consumer(SESSION, {
      reconcile: jest.fn().mockResolvedValueOnce('3').mockRejectedValueOnce(new Error('offline')),
    });
    t.client.subscribe(c);
    await flush();
    t.server.last().stream().push('id: 900\nevent: resync\ndata: {"reason":"too_many","latest_seq":"900"}\n\n');
    await flush();
    expect(t.client.currentCursor).toBe('3');
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.server.calls).toHaveLength(2);
    expect(t.server.last().headers['Last-Event-ID']).toBe('3');
  });

  it('reconnects after the delay a reconnect event asks for', async () => {
    const t = setup();
    t.client.subscribe(consumer());
    await flush();
    const first = t.server.last();
    first.stream().push('retry: 4000\nevent: reconnect\ndata: {"reason":"shutdown","delay_ms":4000}\n\n');
    await flush();
    expect(first.signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(3999);
    expect(t.server.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.server.calls).toHaveLength(2);
  });

  it('an auth event refreshes the session once (revoked) or reports forbidden', async () => {
    const t = setup();
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    t.server.last().stream().push('event: auth\ndata: {"reason":"revoked"}\n\n');
    await flush();
    expect(t.refreshSession).toHaveBeenCalledTimes(1);
    expect(t.server.calls).toHaveLength(2);

    t.server.last().stream().push('event: auth\ndata: {"reason":"forbidden"}\n\n');
    await flush();
    expect(c.onForbidden).toHaveBeenCalledTimes(1);
    expect(t.client.currentStatus).toBe('forbidden');
  });
});

describe('HTTP status handling', () => {
  it('401: one session refresh, then stops without looping', async () => {
    const t = setup();
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    t.server.last().respond(401);
    await flush();
    expect(t.refreshSession).toHaveBeenCalledTimes(1);
    expect(t.server.calls).toHaveLength(2);

    t.server.last().respond(401);
    await flush();
    expect(t.refreshSession).toHaveBeenCalledTimes(1);
    expect(t.client.currentStatus).toBe('unauthorized');
    expect(c.onUnauthorized).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30 * 60_000);
    expect(t.server.calls).toHaveLength(2);
  });

  it('401 with a failed refresh stops immediately', async () => {
    const t = setup();
    t.refreshSession.mockResolvedValue(false);
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    t.server.last().respond(401);
    await flush();
    expect(t.server.calls).toHaveLength(1);
    expect(c.onUnauthorized).toHaveBeenCalled();
  });

  it('a successful connection re-arms the one refresh attempt', async () => {
    const t = setup();
    t.client.subscribe(consumer());
    await flush();
    t.server.last().respond(401);
    await flush();
    t.server.last().stream().end();
    await flush();
    await jest.advanceTimersByTimeAsync(1000);
    t.server.last().respond(401);
    await flush();
    expect(t.refreshSession).toHaveBeenCalledTimes(2);
  });

  it('403: refreshes the auth context and stays stopped for that session; a new session reconnects', async () => {
    const t = setup();
    const c = consumer();
    const unsubscribe = t.client.subscribe(c);
    await flush();
    t.server.last().respond(403);
    await flush();
    expect(c.onForbidden).toHaveBeenCalledTimes(1);
    expect(t.client.currentStatus).toBe('forbidden');
    await jest.advanceTimersByTimeAsync(30 * 60_000);
    expect(t.server.calls).toHaveLength(1);

    t.client.subscribe(consumer(OTHER_SESSION));
    unsubscribe();
    await flush();
    expect(t.server.calls).toHaveLength(2);
  });

  it.each([429, 503])('%s: waits for Retry-After (plus up to 1s jitter)', async (status) => {
    const t = setup();
    t.client.subscribe(consumer());
    await flush();
    t.server.last().respond(status, { 'Retry-After': '7' });
    await flush();
    await jest.advanceTimersByTimeAsync(7499);
    expect(t.server.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.server.calls).toHaveLength(2);
  });

  it('503 without Retry-After and unexpected responses fall back to backoff', async () => {
    const t = setup();
    t.client.subscribe(consumer());
    await flush();
    t.server.last().respond(503);
    await flush();
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.server.calls).toHaveLength(2);
    t.server.last().respond(200, { 'content-type': 'text/html' }, '<html>login</html>');
    await flush();
    await jest.advanceTimersByTimeAsync(2000);
    expect(t.server.calls).toHaveLength(3);
  });
});

describe('reconnect backoff', () => {
  async function gaps(random: () => number, failures: number) {
    const t = setup({ random });
    t.client.subscribe(consumer());
    await flush();
    const out: number[] = [];
    for (let i = 0; i < failures; i += 1) {
      const failedAt = Date.now();
      t.server.last().fail();
      await flush();
      const before = t.server.calls.length;
      while (t.server.calls.length === before) await jest.advanceTimersByTimeAsync(100);
      out.push(t.server.last().at - failedAt);
    }
    return out;
  }

  it('starts at 1s, doubles and caps at 60s, with jitter inside ±20%', async () => {
    const low = await gaps(() => 0, 9);
    const high = await gaps(() => 1, 9);
    const mid = await gaps(() => 0.5, 9);
    expect(mid).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(low).toEqual([800, 1600, 3200, 6400, 12800, 25600, 48000, 48000, 48000]);
    expect(high).toEqual([1200, 2400, 4800, 9600, 19200, 38400, 60000, 60000, 60000]);
  });

  it('resets after 30 seconds of stable connection, not before', async () => {
    const t = setup();
    t.client.subscribe(consumer());
    await flush();
    for (let i = 0; i < 3; i += 1) {
      t.server.last().fail();
      await flush();
      await jest.advanceTimersByTimeAsync(60_000);
    }
    // attempt is now 3: a drop after 10s backs off 8s
    let s = t.server.last().stream();
    await jest.advanceTimersByTimeAsync(10_000);
    s.end();
    await flush();
    let before = t.server.calls.length;
    await jest.advanceTimersByTimeAsync(7999);
    expect(t.server.calls).toHaveLength(before);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.server.calls).toHaveLength(before + 1);

    // stable for 30s: the next drop retries after 1s
    s = t.server.last().stream();
    await jest.advanceTimersByTimeAsync(30_000);
    s.end();
    await flush();
    before = t.server.calls.length;
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.server.calls).toHaveLength(before + 1);
  });
});

describe('heartbeat watchdog', () => {
  it('reconnects when nothing arrives for 60 seconds', async () => {
    const t = setup();
    t.client.subscribe(consumer());
    await flush();
    const first = t.server.last();
    first.stream();
    await jest.advanceTimersByTimeAsync(59_999);
    expect(t.server.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(first.signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.server.calls).toHaveLength(2);
  });

  it('server pings keep the connection', async () => {
    const t = setup();
    t.client.subscribe(consumer());
    await flush();
    const s = t.server.last().stream();
    for (let i = 0; i < 12; i += 1) {
      await jest.advanceTimersByTimeAsync(25_000);
      s.push(': ping\n\n');
      await flush();
    }
    expect(t.server.calls).toHaveLength(1);
    expect(t.client.currentStatus).toBe('open');
  });
});

describe('online, visibility and WebView resume', () => {
  it('drops the stream offline and reconnects immediately (with catch-up) when back online', async () => {
    const t = setup();
    const c = consumer(SESSION, { reconcile: jest.fn(async () => '5') });
    t.client.subscribe(c);
    await flush();
    const first = t.server.last();
    first.stream();
    t.lifecycle.emit('offline');
    expect(first.signal.aborted).toBe(true);
    expect(t.client.currentStatus).toBe('offline');
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.server.calls).toHaveLength(1);

    t.lifecycle.emit('online');
    await flush();
    expect(t.server.calls).toHaveLength(2);
    expect(c.reconcile).toHaveBeenLastCalledWith('wake');
    expect(t.server.last().headers['Last-Event-ID']).toBe('5');
  });

  it('becoming visible leaves a healthy stream alone but replaces a stale one', async () => {
    const t = setup();
    t.client.subscribe(consumer());
    await flush();
    t.server.last().stream();
    await flush();
    t.lifecycle.emit('hidden');
    t.lifecycle.emit('visible');
    await flush();
    expect(t.server.calls).toHaveLength(1);

    t.freeze(120_000); // tab frozen: no timers ran, no bytes for 2 minutes
    t.lifecycle.emit('visible');
    await flush();
    expect(t.server.calls).toHaveLength(2);
  });

  it('Capacitor resume always reconnects and catches up, skipping any pending backoff', async () => {
    const t = setup();
    const c = consumer(SESSION, { reconcile: jest.fn(async () => '5') });
    t.client.subscribe(c);
    await flush();
    t.server.last().stream();
    t.lifecycle.emit('resume');
    await flush();
    expect(t.server.calls).toHaveLength(2);
    expect(t.server.calls[0].signal.aborted).toBe(true);
    expect(c.reconcile).toHaveBeenLastCalledWith('wake');

    for (let i = 0; i < 4; i += 1) {
      t.server.last().fail();
      await flush();
      await jest.advanceTimersByTimeAsync(60_000);
    }
    t.server.last().fail();
    await flush();
    const before = t.server.calls.length;
    t.lifecycle.emit('resume');
    await flush();
    expect(t.server.calls).toHaveLength(before + 1);
  });
});

describe('fallback polling', () => {
  it('does not poll while the stream is healthy', async () => {
    const t = setup();
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    const s = t.server.last().stream();
    for (let i = 0; i < 20; i += 1) {
      await jest.advanceTimersByTimeAsync(25_000);
      s.push(': ping\n\n');
      await flush();
    }
    expect(c.reconcile.mock.calls.filter(([r]) => r === 'poll')).toHaveLength(0);
  });

  it('polls every 5 minutes while streaming is unavailable (visible tabs only)', async () => {
    const t = setup();
    t.refreshSession.mockResolvedValue(false);
    const c = consumer();
    t.client.subscribe(c);
    await flush();
    t.server.last().respond(401);
    await flush();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(c.reconcile.mock.calls.filter(([r]) => r === 'poll')).toHaveLength(2);

    t.lifecycle.visible = false;
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(c.reconcile.mock.calls.filter(([r]) => r === 'poll')).toHaveLength(2);
  });
});

describe('cross-tab', () => {
  it('relays handled events to other tabs, which then ignore the same seq from their own stream', async () => {
    const storage = new MemoryStorage();
    const bus = new ChannelBus();
    const tabA = setup({ storage, bus });
    const tabB = setup({ storage, bus });
    const a = consumer();
    const b = consumer();
    tabA.client.subscribe(a);
    tabB.client.subscribe(b);
    await flush();
    const streamA = tabA.server.last().stream();
    const streamB = tabB.server.last().stream();

    streamA.push(msg(5, { type: 'todo_reminder' }));
    await flush();
    expect(b.onNotification).toHaveBeenCalledWith(expect.objectContaining({ seq: '5' }), { seq: '5', source: 'relay' });
    expect(storage.getItem(CURSOR_KEY)).toBe('5');

    streamB.push(msg(5, { type: 'todo_reminder' }));
    await flush();
    expect(b.onNotification).toHaveBeenCalledTimes(1);
    expect(a.onNotification).toHaveBeenCalledTimes(1);
  });

  it('shares popup dismissals with tabs of the same session only', async () => {
    const bus = new ChannelBus();
    const tabA = setup({ bus });
    const tabB = setup({ bus });
    const tabC = setup({ bus });
    const b = consumer();
    const other = consumer(OTHER_SESSION);
    tabA.client.subscribe(consumer());
    tabB.client.subscribe(b);
    tabC.client.subscribe(other);
    await flush();
    tabA.client.broadcastDismiss(['n1:5']);
    await flush();
    expect(b.onRemoteDismiss).toHaveBeenCalledWith(['n1:5']);
    expect(other.onRemoteDismiss).not.toHaveBeenCalled();
  });
});

describe('cleanup', () => {
  it('closes the reader, timers, listeners and channel when the last consumer leaves', async () => {
    const t = setup();
    const offA = t.client.subscribe(consumer());
    const offB = t.client.subscribe(consumer());
    await flush();
    const call = t.server.last();
    call.stream();
    await flush();

    offA();
    expect(call.signal.aborted).toBe(false);
    expect(t.client.consumerCount).toBe(1);

    offB();
    await flush();
    expect(call.signal.aborted).toBe(true);
    expect(t.client.currentStatus).toBe('idle');
    expect(t.lifecycle.handlers.size).toBe(0);
    expect(t.bus.channels.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    offB(); // idempotent
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.server.calls).toHaveLength(1);
  });

  it('cancels a pending reconnect when unsubscribed during backoff', async () => {
    const t = setup();
    const off = t.client.subscribe(consumer());
    await flush();
    t.server.last().fail();
    await flush();
    expect(t.client.currentStatus).toBe('backoff');
    off();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(t.server.calls).toHaveLength(1);
  });
});
