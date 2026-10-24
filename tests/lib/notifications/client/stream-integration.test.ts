/**
 * Release 4 client against the real Release 3 stream route + hub (in-memory rows, no Redis):
 * GET/stream handoff, live delivery, shutdown reconnect with Last-Event-ID, resync, re-fire,
 * all through the real NotificationStore.
 */
const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  query: jest.fn(),
  queryRows: jest.fn(),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { NextRequest } from 'next/server';
import { GET as streamGET } from '@/app/api/notifications/stream/route';
import {
  createNotificationStreamHub,
  setNotificationStreamHubForTests,
  type NotificationStreamHub,
} from '@/lib/notifications/stream/hub';
import { NotificationStore, type ClientNotification } from '@/lib/notifications/client/notification-store';
import { NotificationStreamClient, STREAM_CLIENT_DEFAULTS } from '@/lib/notifications/client/stream-client';
import { MemorySource } from '../stream/sse-harness';
import { ChannelBus, FakeLifecycle, MemoryStorage, SESSION } from './client-harness';

const { businessId: BIZ, userId: USER } = SESSION;

let source: MemorySource;
let hub: NotificationStreamHub;
let client: NotificationStreamClient;
let store: NotificationStore;
let afterGet: (() => void) | null;
let getCalls: string[];
let unsubscribe: (() => void) | null = null;

function makeHub() {
  const h = createNotificationStreamHub({
    source,
    createSubscriber: () => null,
    publisherReady: () => true,
    random: () => 0,
    installSignalHandlers: false,
  });
  setNotificationStreamHubForTests(h);
  return h;
}

/** Rows with an older created_at than their seq suggests: outside GET's top 20 by created_at. */
let olderCreatedAt: Set<string>;

/** Same rows GET /api/notifications would return (own + broadcast, newest first, 20). */
function listRows(): ClientNotification[] {
  return source.rows
    .filter((r) => r.visible && r.business_id === BIZ && (r.user_id === USER || r.user_id === null))
    .filter((r) => !olderCreatedAt.has(r.id))
    .sort((a, b) => Number(BigInt(b.seq) - BigInt(a.seq)))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      is_read: false,
      created_at: new Date().toISOString(),
      seq: r.seq,
      popup_dismissed_at: null,
      reference_id: r.reference_id,
    }));
}

async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) {
      throw new Error(`timed out (client ${client.currentStatus}, cursor ${client.currentCursor}, hub ${hub.size})`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const hint = (id: string) => hub.handleMessage(JSON.stringify({ businessId: BIZ, userId: USER, notificationId: id }));

beforeEach(() => {
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (/auth_session_version/.test(sql)) return { auth_session_version: '3' };
    if (/user_businesses/.test(sql)) return { one: 1 };
    throw new Error(`unexpected ${sql}`);
  });
  source = new MemorySource();
  hub = makeHub();
  store = new NotificationStore();
  afterGet = null;
  getCalls = [];
  olderCreatedAt = new Set();

  client = new NotificationStreamClient({
    ...STREAM_CLIENT_DEFAULTS,
    fetch: (async (input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers as Record<string, string>);
      headers.set('x-authenticated-user-id', USER);
      headers.set('x-authenticated-business-id', BIZ);
      headers.set('x-authenticated-session-version', '3');
      return streamGET(new NextRequest(`http://localhost${String(input)}`, { headers, signal: init?.signal ?? undefined }));
    }) as typeof fetch,
    storage: new MemoryStorage(),
    random: () => 0,
    now: Date.now,
    lifecycle: new FakeLifecycle(),
    createChannel: new ChannelBus().create,
    refreshSession: async () => false,
  });
});

function start() {
  const s = store;
  unsubscribe = client.subscribe({
    session: SESSION,
    onNotification: (payload, { seq }) => s.applyEvent(payload, seq),
    // Mirrors GET /api/notifications: stream_cursor (latest visible seq) is read before the list.
    reconcile: async (reason) => {
      getCalls.push(reason);
      const cursor = (await source.latestSeq(SESSION)).toString();
      s.applyList(listRows());
      afterGet?.();
      afterGet = null;
      return cursor;
    },
  });
}

afterEach(async () => {
  unsubscribe?.();
  unsubscribe = null;
  await hub.shutdown();
  setNotificationStreamHubForTests(undefined);
});

it('loses nothing between the initial GET and the stream opening, and delivers it once', async () => {
  source.insert({ businessId: BIZ, userId: USER, type: 'todo_reminder' }); // 1, in the GET
  let between!: { id: string };
  afterGet = () => {
    between = source.insert({ businessId: BIZ, userId: USER, type: 'todo_reminder' }); // 2, after the GET
  };
  start();
  await until(() => store.getSnapshot().notifications.length === 2);
  await new Promise((r) => setTimeout(r, 100));

  const s = store.getSnapshot();
  expect(s.notifications.map((n) => n.seq)).toEqual(['2', '1']);
  expect(s.popups.map((p) => p.seq)).toEqual(['1', '2']);
  expect(s.notifications.find((n) => n.id === between.id)).toBeDefined();
  expect(client.currentCursor).toBe('2');
  expect(getCalls).toEqual(['bootstrap']);
});

it('starts from the server cursor, not the list max, so a higher seq outside the top 20 is not replayed', async () => {
  for (let i = 0; i < 25; i += 1) source.insert({ businessId: BIZ, userId: i % 2 ? null : USER, recent: false });
  const outside = source.insert({ businessId: BIZ, userId: USER, type: 'todo_reminder', recent: false });
  olderCreatedAt.add(outside.id);
  const listMax = listRows()[0].seq;
  expect(BigInt(outside.seq)).toBeGreaterThan(BigInt(listMax!));

  start();
  await until(() => client.currentStatus === 'open' && hub.size === 1);
  expect(client.currentCursor).toBe(outside.seq);

  const live = source.insert({ businessId: BIZ, userId: USER });
  hint(live.id);
  await until(() => store.getSnapshot().notifications[0]?.id === live.id);
  await new Promise((r) => setTimeout(r, 100));
  const s = store.getSnapshot();
  expect(s.notifications.find((n) => n.id === outside.id)).toBeUndefined();
  expect(s.popups).toEqual([]);
  expect(s.notifications).toHaveLength(21);
  expect(client.currentCursor).toBe(live.seq);
});

it('streams live rows, reconnects after a server restart and replays what it missed exactly once', async () => {
  start();
  await until(() => client.currentStatus === 'open' && hub.size === 1);
  const live = source.insert({ businessId: BIZ, userId: USER });
  hint(live.id);
  await until(() => store.getSnapshot().notifications.length === 1);
  expect(client.currentCursor).toBe(live.seq);

  const shutdown = hub.shutdown(); // reconnect event, retry 1000ms (random 0)
  await shutdown;
  const missed1 = source.insert({ businessId: BIZ, userId: USER });
  const missed2 = source.insert({ businessId: BIZ, userId: null });
  hub = makeHub();

  await until(() => store.getSnapshot().notifications.length === 3, 8000);
  await new Promise((r) => setTimeout(r, 100));
  expect(store.getSnapshot().notifications.map((n) => n.seq)).toEqual([missed2.seq, missed1.seq, live.seq]);
  expect(client.currentCursor).toBe(missed2.seq);
  expect(hub.size).toBe(1);
});

it('on resync replaces the list from GET and continues from the server cursor', async () => {
  start();
  await until(() => client.currentStatus === 'open' && hub.size === 1);
  await hub.shutdown();
  for (let i = 0; i < 1101; i += 1) source.insert({ businessId: BIZ, userId: USER, recent: false });
  hub = makeHub();

  await until(() => client.currentCursor === '1101', 8000);
  expect(getCalls).toEqual(['bootstrap', 'resync']);
  expect(store.getSnapshot().notifications[0].seq).toBe('1101');
  expect(store.getSnapshot().notifications.length).toBeLessThanOrEqual(STREAM_CLIENT_DEFAULTS.dedupMax);
});

it('a re-fired reminder (same id, new seq) pops again and keeps one list entry', async () => {
  const original = source.insert({ businessId: BIZ, userId: USER, type: 'todo_reminder' });
  start();
  await until(() => client.currentStatus === 'open' && hub.size === 1);
  expect(store.getSnapshot().popups).toHaveLength(1);
  const [popup] = store.getSnapshot().popups;
  store.dismiss([popup.key]);

  const refire = source.insert({ businessId: BIZ, userId: USER, type: 'todo_reminder' });
  source.rows = source.rows.filter((r) => r.id !== original.id);
  refire.id = original.id;
  hint(original.id);

  await until(() => store.getSnapshot().popups.length === 1);
  const s = store.getSnapshot();
  expect(s.popups[0]).toMatchObject({ notificationId: original.id, seq: refire.seq });
  expect(s.notifications.filter((n) => n.id === original.id)).toHaveLength(1);
});
