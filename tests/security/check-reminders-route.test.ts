/**
 * /api/todos/check-reminders must never let a signed-in user sweep reminders across businesses.
 * Sessions are limited to their own business; the all-business sweep needs CRON_SECRET.
 * Both paths (and /api/cron/send-todo-reminders) delegate to the shared DB sweep and keep their
 * response shapes.
 */
const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({
  queryRows: jest.fn(),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  query: jest.fn(),
}));
const mockSweep = jest.fn();
jest.mock('@/lib/todo-reminders/sweepDueTodoReminders', () => ({
  sweepDueTodoReminders: (...a: unknown[]) => mockSweep(...a),
}));
jest.mock('@/lib/todo-reminders/reminderLog', () => ({ logTodoReminder: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/todos/check-reminders/route';
import { GET as sendGET, POST as sendPOST } from '@/app/api/cron/send-todo-reminders/route';

const USER = '11111111-1111-4111-8111-111111111111';
const BIZ_X = '22222222-2222-4222-8222-222222222222';
const BIZ_Y = '33333333-3333-4333-8333-333333333333';
const SECRET = 'test-cron-secret';

let member = true;
let sessionVersion = 3;

function sessionReq(query = '', extra: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/todos/check-reminders${query}`, {
    headers: {
      'x-authenticated-user-id': USER,
      'x-authenticated-business-id': BIZ_X,
      'x-authenticated-session-version': '3',
      ...extra,
    },
  });
}

function systemReq(auth?: string, query = '') {
  return new NextRequest(`http://localhost/api/todos/check-reminders${query}`, {
    headers: auth ? { authorization: auth } : {},
  });
}

const RESULT = { processed: 2, skipped: 1, failed: 1, total: 4, batches: 1, stoppedReason: 'complete' };
const perBusinessSweeps = () => mockSweep.mock.calls.filter(([o]) => o?.businessId);
const globalSweeps = () => mockSweep.mock.calls.filter(([o]) => !o?.businessId);

beforeEach(() => {
  member = true;
  sessionVersion = 3;
  delete process.env.CRON_SECRET;
  mockSweep.mockReset().mockResolvedValue(RESULT);
  mockQueryOne.mockReset().mockImplementation(async (sql: string) => {
    if (/auth_session_version/.test(sql)) return { auth_session_version: String(sessionVersion) };
    if (/user_businesses/.test(sql)) return member ? { one: 1 } : null;
    throw new Error(`unexpected queryOne: ${sql}`);
  });
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe('signed-in callers', () => {
  it('without business_id sweeps only the session business (even with CRON_SECRET unset)', async () => {
    const res = await GET(sessionReq());
    expect(res.status).toBe(200);
    expect((await res.json()).business_id).toBe(BIZ_X);
    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(perBusinessSweeps()[0][0]).toMatchObject({ businessId: BIZ_X, maxWallMs: 25_000 });
    expect(globalSweeps()).toHaveLength(0);
  });

  it('with their own business_id sweeps only that business', async () => {
    const res = await GET(sessionReq(`?business_id=${BIZ_X}`));
    expect(res.status).toBe(200);
    expect(perBusinessSweeps()[0][0].businessId).toBe(BIZ_X);
    expect(globalSweeps()).toHaveLength(0);
  });

  it('with another business_id is refused without sweeping', async () => {
    const res = await GET(sessionReq(`?business_id=${BIZ_Y}`));
    expect(res.status).toBe(403);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('cannot reach the all-business sweep even with a valid cron bearer', async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(sessionReq('', { authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect(globalSweeps()).toHaveLength(0);
    expect(perBusinessSweeps()[0][0].businessId).toBe(BIZ_X);
  });

  it('is refused when not a member of the session business', async () => {
    member = false;
    const res = await GET(sessionReq());
    expect(res.status).toBe(403);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('is refused when the session version was revoked', async () => {
    sessionVersion = 4;
    const res = await GET(sessionReq());
    expect(res.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('keeps the per-business response shape', async () => {
    const body = await (await GET(sessionReq())).json();
    expect(Object.keys(body).sort()).toEqual(['business_id', 'duration', 'failed', 'processed', 'skipped', 'total']);
    expect(body).toMatchObject({ business_id: BIZ_X, processed: 2, skipped: 1, failed: 1, total: 4 });
  });

  it('reports a sweep failure as 500', async () => {
    mockSweep.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(sessionReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('db down');
  });
});

describe('system callers without a session', () => {
  it('are refused when CRON_SECRET is not configured (fails closed)', async () => {
    const res = await GET(systemReq());
    expect(res.status).toBe(503);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('are refused with a wrong bearer', async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(systemReq('Bearer nope'));
    expect(res.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('cannot pick a business by query without a session', async () => {
    const res = await GET(systemReq(undefined, `?business_id=${BIZ_X}`));
    expect(res.status).toBe(503);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('run the all-business sweep with the correct bearer and keep the global response shape', async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(systemReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ['duration', 'failed', 'processed', 'scope', 'skipped', 'stoppedReason', 'total'],
    );
    expect(body).toMatchObject({ scope: 'global', stoppedReason: 'complete', processed: 2, total: 4 });
    expect(globalSweeps()).toHaveLength(1);
    expect(globalSweeps()[0][0]).toMatchObject({ maxWallMs: 25_000 });
    expect(perBusinessSweeps()).toHaveLength(0);
  });
});

describe('/api/cron/send-todo-reminders', () => {
  const cronReq = (auth?: string) =>
    new NextRequest('http://localhost/api/cron/send-todo-reminders', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
    });

  it('requires the cron bearer', async () => {
    expect((await sendGET(cronReq())).status).toBe(503);
    process.env.CRON_SECRET = SECRET;
    expect((await sendPOST(cronReq('Bearer nope'))).status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('runs the shared all-business sweep and keeps its response shape (GET and POST)', async () => {
    process.env.CRON_SECRET = SECRET;
    for (const handler of [sendGET, sendPOST]) {
      const body = await (await handler(cronReq(`Bearer ${SECRET}`))).json();
      expect(body).toEqual({
        success: true,
        stoppedReason: 'complete',
        batches: 1,
        totalSeen: 4,
        processed: 2,
        skipped: 1,
        failed: 1,
      });
    }
    expect(globalSweeps()).toHaveLength(2);
    expect(globalSweeps()[0][0]).toMatchObject({ maxWallMs: 25_000, maxBatches: 1000 });
  });
});
