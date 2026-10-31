/**
 * /api/todos writes use the session's business and user, never a business_id, created_by or
 * action_by sent in the body; assignees must belong to that business; bad input is a 400; and a
 * todo from another business is not found.
 */
const mockQueryOne = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryRows: jest.fn().mockResolvedValue([]),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  getPool: () => ({ connect: async () => ({ query: mockClientQuery, release: jest.fn() }) }),
}));
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Feature not available' }, { status: 403 });
    }
  }
  return { assertFeatureAccess: jest.fn().mockResolvedValue(undefined), FeatureAccessDeniedError };
});
const mockSchedule = jest.fn();
jest.mock('@/lib/queue/todoReminderQueue', () => ({
  scheduleTodoReminder: (...a: unknown[]) => mockSchedule(...a),
  cancelScheduledTodoReminder: jest.fn(),
}));
jest.mock('@/lib/queue/syncTodoReminderJob', () => ({ syncTodoReminderJobAfterUpdate: jest.fn() }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/todos/route';
import { PATCH, DELETE, GET as getOne } from '@/app/api/todos/[id]/route';
import { POST as snooze } from '@/app/api/todos/[id]/snooze/route';

const USER = '11111111-1111-4111-8111-111111111111';
const BIZ = '22222222-2222-4222-8222-222222222222';
const OTHER_BIZ = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';
const COLLEAGUE = '55555555-5555-4555-8555-555555555555';
const TODO = '66666666-6666-4666-8666-666666666666';

const session = {
  'x-authenticated-user-id': USER,
  'x-authenticated-business-id': BIZ,
  'x-authenticated-session-version': '1',
};

function req(method: string, url: string, body?: unknown, headers: Record<string, string> = session) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const create = (body: Record<string, unknown>, headers?: Record<string, string>) =>
  POST(req('POST', '/api/todos', body, headers));
const ctx = { params: { id: TODO } };

const DUE = '2030-01-10T11:30:00.000Z';
const existingTodo = {
  id: TODO,
  business_id: BIZ,
  title: 'Call supplier',
  due_date: new Date(DUE),
  priority: 'medium',
  status: 'pending',
  reminder_type: 'once',
  reminder_time: new Date('2030-01-10T10:30:00.000Z'),
};

const sqlCalls = (pattern: string) =>
  mockClientQuery.mock.calls.filter(([sql]) => String(sql).includes(pattern));

beforeEach(() => {
  mockQueryOne.mockReset().mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('auth_session_version')) return { auth_session_version: '1' };
    if (sql.includes('FROM users')) {
      // COLLEAGUE belongs to BIZ; OTHER_USER belongs to another business.
      return params[0] === COLLEAGUE && params[1] === BIZ ? { id: COLLEAGUE } : null;
    }
    if (sql.includes('FROM todos')) {
      return params[0] === TODO && params[1] === BIZ ? existingTodo : null;
    }
    return null;
  });
  mockClientQuery.mockReset().mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('INSERT INTO todos')) {
      return {
        rows: [{ id: TODO, business_id: params[0], reminder_type: params[6], reminder_time: params[7] }],
      };
    }
    if (sql.includes('UPDATE todos')) return { rows: [{ ...existingTodo }] };
    return { rows: [] };
  });
  mockSchedule.mockReset();
});

describe('POST /api/todos', () => {
  it('creates the todo in the session business, created by the session user', async () => {
    const res = await create({
      business_id: BIZ,
      title: '  Call supplier ',
      due_date: DUE,
      priority: 'high',
      assigned_to: COLLEAGUE,
      created_by: OTHER_USER,
    });
    expect(res.status).toBe(200);
    const [, params] = sqlCalls('INSERT INTO todos')[0];
    expect(params[0]).toBe(BIZ);
    expect(params[1]).toBe(COLLEAGUE);
    expect(params[2]).toBe('Call supplier');
    expect(params[5]).toBe('high');
    expect(params[11]).toBe(USER);
    const [, historyParams] = sqlCalls('create_todo_history')[0];
    expect(historyParams).toEqual([TODO, 'Call supplier', USER]);
    expect(sqlCalls('COMMIT')).toHaveLength(1);
  });

  it('rejects a business_id that is not the session business', async () => {
    const res = await create({ business_id: OTHER_BIZ, title: 'x', due_date: DUE });
    expect(res.status).toBe(403);
    expect(sqlCalls('INSERT')).toHaveLength(0);
  });

  it('requires a session, even with business_id and created_by in the body', async () => {
    const res = await create({ business_id: BIZ, created_by: USER, title: 'x', due_date: DUE }, {});
    expect(res.status).toBe(401);
    expect(sqlCalls('INSERT')).toHaveLength(0);
  });

  it('refuses an assignee from another business', async () => {
    const res = await create({ title: 'x', due_date: DUE, assigned_to: OTHER_USER });
    expect(res.status).toBe(400);
    expect(sqlCalls('INSERT')).toHaveLength(0);
  });

  it.each([
    [{ due_date: DUE }],
    [{ title: 'x' }],
    [{ title: 'x', due_date: 'not a date' }],
    [{ title: 'x', due_date: DUE, priority: 'urgent' }],
    [{ title: 'x', due_date: DUE, reminder_type: 'daily' }],
    [{ title: 'x', due_date: DUE, reminder_time: 'soon' }],
    [{ title: 'x', due_date: DUE, reminder_channels: ['sms'] }],
    [{ title: 'x', due_date: DUE, related_entity_id: 'INV-1' }],
    [{ title: 'x'.repeat(256), due_date: DUE }],
  ])('answers bad input %j with a 400', async (body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(sqlCalls('INSERT')).toHaveLength(0);
  });

  it('gives a default reminder a time, so it is scheduled', async () => {
    const res = await create({ title: 'x', due_date: DUE });
    expect(res.status).toBe(200);
    const [, params] = sqlCalls('INSERT INTO todos')[0];
    expect(params[6]).toBe('once');
    expect(params[7]).toBe('2030-01-10T10:30:00.000Z');
    expect(mockSchedule).toHaveBeenCalledWith(TODO, new Date('2030-01-10T10:30:00.000Z'));
  });

  it('stores no reminder time when reminders are off', async () => {
    await create({ title: 'x', due_date: DUE, reminder_type: 'none', reminder_time: DUE });
    const [, params] = sqlCalls('INSERT INTO todos')[0];
    expect(params[7]).toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('rolls back the todo when its history row fails', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('create_todo_history')) throw new Error('boom');
      if (sql.includes('INSERT INTO todos')) return { rows: [{ id: TODO }] };
      return { rows: [] };
    });
    const res = await create({ title: 'x', due_date: DUE });
    expect(res.status).toBe(500);
    expect(sqlCalls('ROLLBACK')).toHaveLength(1);
    expect(sqlCalls('COMMIT')).toHaveLength(0);
  });
});

describe('/api/todos/:id', () => {
  it('treats a todo of another business as not found', async () => {
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('auth_session_version') ? { auth_session_version: '1' } : null,
    );
    expect((await getOne(req('GET', `/api/todos/${TODO}`), ctx)).status).toBe(404);
    expect((await PATCH(req('PATCH', `/api/todos/${TODO}`, { status: 'completed' }), ctx)).status).toBe(404);
    expect((await DELETE(req('DELETE', `/api/todos/${TODO}`), ctx)).status).toBe(404);
    expect(
      (await snooze(req('POST', `/api/todos/${TODO}/snooze`, { snooze_until: DUE }), ctx)).status,
    ).toBe(404);
    expect(sqlCalls('UPDATE')).toHaveLength(0);
  });

  it('answers a malformed id with 404 instead of a 500', async () => {
    const res = await getOne(req('GET', '/api/todos/abc'), { params: { id: 'abc' } });
    expect(res.status).toBe(404);
  });

  it('records history against the session user, not body action_by', async () => {
    const res = await PATCH(req('PATCH', `/api/todos/${TODO}`, { status: 'completed', action_by: OTHER_USER }), ctx);
    expect(res.status).toBe(200);
    const [sql, params] = sqlCalls('UPDATE todos')[0];
    expect(sql).toContain('business_id =');
    expect(params.slice(-2)).toEqual([TODO, BIZ]);
    const [, historyParams] = sqlCalls('create_todo_history')[0];
    expect(historyParams[4]).toBe(USER);
  });

  it('refuses to reassign to a user of another business', async () => {
    const res = await PATCH(req('PATCH', `/api/todos/${TODO}`, { assigned_to: OTHER_USER }), ctx);
    expect(res.status).toBe(400);
    expect(sqlCalls('UPDATE')).toHaveLength(0);
  });

  it('answers a bad status or date with 400', async () => {
    expect((await PATCH(req('PATCH', `/api/todos/${TODO}`, { status: 'done' }), ctx)).status).toBe(400);
    expect((await PATCH(req('PATCH', `/api/todos/${TODO}`, { due_date: 'tomorrow' }), ctx)).status).toBe(400);
    expect(
      (await snooze(req('POST', `/api/todos/${TODO}/snooze`, { snooze_until: 'later' }), ctx)).status,
    ).toBe(400);
  });
});
