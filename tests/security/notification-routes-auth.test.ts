/**
 * Release 1 notification security: identity from the session only, membership via the home
 * business or user_businesses, and read/mark-all-read scoped to the caller. Release 3: the
 * stream route keeps those checks, re-checks them every 5 minutes, and enforces limits/503.
 */
const mockQueryOne = jest.fn();
const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  query: (...a: unknown[]) => mockQuery(...a),
  queryRows: jest.fn(),
}));
const mockGetRedis = jest.fn();
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => mockGetRedis() }));

import { NextRequest } from 'next/server';
import { GET as streamGET } from '@/app/api/notifications/stream/route';
import { PATCH as readOnePATCH } from '@/app/api/notifications/[id]/read/route';
import { PATCH as readAllPATCH, POST as readAllPOST } from '@/app/api/notifications/read-all/route';
import { POST as markAllPOST } from '@/app/api/notifications/mark-all-read/route';
import {
  createNotificationStreamHub,
  setNotificationStreamHubForTests,
  type NotificationStreamHub,
} from '@/lib/notifications/stream/hub';
import { MemorySource, readSse } from '../lib/notifications/stream/sse-harness';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '55555555-5555-4555-8555-555555555555';
const BIZ_X = '22222222-2222-4222-8222-222222222222';
const BIZ_Y = '33333333-3333-4333-8333-333333333333';
const NOTE = '44444444-4444-4444-8444-444444444444';

type Db = {
  sessionVersion: number;
  active: boolean;
  homeBusiness: string;
  memberships: string[];
};
let db: Db;

function installDb() {
  mockQueryOne.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/auth_session_version/.test(sql)) {
      return db.active && params[0] === USER_A ? { auth_session_version: String(db.sessionVersion) } : null;
    }
    if (/FROM users u/.test(sql) && /user_businesses/.test(sql)) {
      const [userId, businessId] = params as string[];
      if (userId !== USER_A || !db.active) return null;
      return db.homeBusiness === businessId || db.memberships.includes(businessId) ? { one: 1 } : null;
    }
    throw new Error(`unexpected queryOne: ${sql}`);
  });
  mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: NOTE }] });
}

function session(path: string, init: { method?: string; body?: unknown; business?: string; sv?: string } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-authenticated-user-id': USER_A,
      'x-authenticated-business-id': init.business ?? BIZ_X,
      'x-authenticated-session-version': init.sv ?? '3',
      'content-type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function anonymous(path: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-user-id': USER_A, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

beforeEach(() => {
  db = { sessionVersion: 3, active: true, homeBusiness: BIZ_X, memberships: [] };
  mockQueryOne.mockReset();
  mockQuery.mockReset();
  mockGetRedis.mockReset().mockReturnValue(null);
  installDb();
});

describe('GET /api/notifications/stream authorization', () => {
  let source: MemorySource;
  let hub: NotificationStreamHub;
  const open: { cancel: () => Promise<void> }[] = [];

  beforeEach(() => {
    source = new MemorySource();
    hub = createNotificationStreamHub({
      source,
      createSubscriber: () => null,
      publisherReady: () => false,
      random: () => 0.5,
      installSignalHandlers: false,
      limits: { perUser: 2, perProcess: 100 },
    });
    setNotificationStreamHubForTests(hub);
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => s.cancel()));
    setNotificationStreamHubForTests(undefined);
  });

  async function streamOk(req: NextRequest) {
    const res = await streamGET(req);
    expect(res.status).toBe(200);
    const sse = readSse(res.body!);
    open.push(sse);
    return { res, sse };
  }

  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('refuses client-supplied ids without a session (store-host / legacy fallback)', async () => {
    const res = await streamGET(anonymous(`/api/notifications/stream?business_id=${BIZ_X}&user_id=${USER_A}`));
    expect(res.status).toBe(401);
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(hub.size).toBe(0);
  });

  it('ignores query ids and streams the session user and business only', async () => {
    source.insert({ businessId: BIZ_Y, userId: USER_B });
    const { res, sse } = await streamOk(
      session(`/api/notifications/stream?business_id=${BIZ_Y}&user_id=${USER_B}&after_seq=0`)
    );
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const membershipCall = mockQueryOne.mock.calls.find(([sql]) => /user_businesses/.test(sql));
    expect(membershipCall?.[1]).toEqual([USER_A, BIZ_X]);
    expect(hub.countForUser(USER_A)).toBe(1);
    expect(hub.countForUser(USER_B)).toBe(0);

    const mine = source.insert({ businessId: BIZ_X, userId: USER_A });
    hub.handleMessage(JSON.stringify({ businessId: BIZ_X, userId: USER_A, notificationId: mine.id }));
    await new Promise((r) => setTimeout(r, 100));
    expect(sse.events()[0].event).toBe('connected');
    expect(sse.messages().map((e) => e.data.notificationId)).toEqual([mine.id]);
    expect(source.calls.every((c) => c.scope.businessId === BIZ_X && c.scope.userId === USER_A)).toBe(true);
  });

  it('uses Last-Event-ID as the resume cursor', async () => {
    source.insert({ businessId: BIZ_X, userId: USER_A, recent: false });
    const second = source.insert({ businessId: BIZ_X, userId: USER_A });
    const req = session('/api/notifications/stream?after_seq=0');
    req.headers.set('last-event-id', '1');
    const { sse } = await streamOk(req);
    await tick();
    expect(sse.messages().map((e) => e.data.seq)).toEqual([second.seq]);
    expect(source.calls.find((c) => c.fn === 'fetchRecentAtOrBelow')?.arg).toBe(1n);
  });

  it('refuses a revoked session version', async () => {
    db.sessionVersion = 4;
    const res = await streamGET(session('/api/notifications/stream'));
    expect(res.status).toBe(401);
    expect(hub.size).toBe(0);
  });

  it('refuses a session business the user is not a member of', async () => {
    const res = await streamGET(session('/api/notifications/stream', { business: BIZ_Y }));
    expect(res.status).toBe(403);
    expect(hub.size).toBe(0);
  });

  it('keeps an older session for business X working after the user switched to Y elsewhere', async () => {
    db.homeBusiness = BIZ_Y;
    db.memberships = [BIZ_X, BIZ_Y];
    await streamOk(session('/api/notifications/stream', { business: BIZ_X }));
  });

  it('refuses an inactive user', async () => {
    db.active = false;
    const res = await streamGET(session('/api/notifications/stream'));
    expect(res.status).toBe(401);
  });

  it('returns 429 with Retry-After over the per-user stream limit', async () => {
    await streamOk(session('/api/notifications/stream'));
    await streamOk(session('/api/notifications/stream'));
    const res = await streamGET(session('/api/notifications/stream'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(await res.json()).toEqual({ error: 'Too many notification streams', code: 'STREAM_LIMIT' });
  });

  it('frees the slot when the client goes away', async () => {
    const { sse } = await streamOk(session('/api/notifications/stream'));
    expect(hub.size).toBe(1);
    await sse.cancel();
    await tick();
    expect(hub.size).toBe(0);
  });

  it('frees the slot when the request is aborted', async () => {
    const ac = new AbortController();
    const base = session('/api/notifications/stream');
    const req = new NextRequest(base.url, { headers: base.headers, signal: ac.signal });
    await streamOk(req);
    expect(hub.size).toBe(1);
    ac.abort();
    await tick();
    expect(hub.size).toBe(0);
  });

  it('returns 503 with Retry-After while shutting down', async () => {
    const shutdown = hub.shutdown();
    const res = await streamGET(session('/api/notifications/stream'));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.json()).toEqual({ error: 'Server is restarting', code: 'SHUTTING_DOWN' });
    expect(mockQueryOne).not.toHaveBeenCalled();
    await shutdown;
  });

  it('closes the stream with an auth event when the periodic re-check finds the session revoked', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    try {
      const { sse } = await streamOk(session('/api/notifications/stream'));
      await jest.advanceTimersByTimeAsync(0);
      db.sessionVersion = 4;
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(sse.events().at(-1)).toMatchObject({ event: 'auth', data: { reason: 'revoked' } });
      expect(hub.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes the stream when membership is lost', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    try {
      const { sse } = await streamOk(session('/api/notifications/stream'));
      await jest.advanceTimersByTimeAsync(0);
      db.homeBusiness = BIZ_Y;
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(sse.events().at(-1)).toMatchObject({ event: 'auth', data: { reason: 'forbidden' } });
      expect(hub.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('PATCH /api/notifications/[id]/read', () => {
  const call = (req: NextRequest, id = NOTE) => readOnePATCH(req, { params: { id } });

  it('requires a session', async () => {
    const res = await call(anonymous(`/api/notifications/${NOTE}/read`, { method: 'PATCH' }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('scopes the update to the session business and the caller (or broadcast rows)', async () => {
    const res = await call(session(`/api/notifications/${NOTE}/read`, { method: 'PATCH' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Notification marked as read' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([NOTE, BIZ_X, USER_A]);
    expect(sql).toMatch(/business_id = \$2/);
    expect(sql).toMatch(/\(user_id = \$3 OR user_id IS NULL\)/);
  });

  it("returns 404 for another user's or another business's notification", async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    const res = await call(session(`/api/notifications/${NOTE}/read`, { method: 'PATCH' }));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a malformed id without touching the database', async () => {
    const res = await call(session('/api/notifications/not-a-uuid/read', { method: 'PATCH' }), 'not-a-uuid');
    expect(res.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('refuses a non-member session business', async () => {
    const res = await call(session(`/api/notifications/${NOTE}/read`, { method: 'PATCH', business: BIZ_Y }));
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('mark all notifications read', () => {
  const routes: [string, (r: NextRequest) => Promise<Response>, string, string][] = [
    ['PATCH /read-all', readAllPATCH, '/api/notifications/read-all', 'PATCH'],
    ['POST /read-all', readAllPOST, '/api/notifications/read-all', 'POST'],
    ['POST /mark-all-read', markAllPOST, '/api/notifications/mark-all-read', 'POST'],
  ];

  it.each(routes)('%s marks only the caller and broadcast rows in the session business', async (_n, handler, path, method) => {
    const res = await handler(session(path, { method, body: { business_id: BIZ_X, user_id: USER_B } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'All notifications marked as read' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([BIZ_X, USER_A]);
    expect(sql).toMatch(/\(user_id = \$2 OR user_id IS NULL\)/);
  });

  it.each(routes)('%s refuses another business id in the body', async (_n, handler, path, method) => {
    const res = await handler(session(path, { method, body: { business_id: BIZ_Y } }));
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each(routes)('%s refuses requests without a session', async (_n, handler, path, method) => {
    const res = await handler(anonymous(path, { method, body: { business_id: BIZ_X } }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each(routes)('%s works without a body (session business)', async (_n, handler, path, method) => {
    const res = await handler(session(path, { method }));
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([BIZ_X, USER_A]);
  });
});
