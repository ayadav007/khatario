/**
 * Tasks act only inside the session business: a foreign assignee is refused with 404 and nothing
 * is written; the list join and the PATCH update carry the business condition.
 * DB and session are mocked.
 */
import { NextRequest } from 'next/server';

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];

const OWN_EMP = 'a0000000-0000-4000-8000-000000000001';
const FOREIGN_EMP = 'a0000000-0000-4000-8000-000000000002';
const TASK = 't0000000-0000-4000-8000-000000000001';

function answer(sql: string, params: unknown[] = []) {
  calls.push({ sql, params });
  const inSession = params.includes('biz-session');
  if (/^\s*SELECT[\s\S]*FROM employees\s+WHERE/i.test(sql) && /SELECT\s+1\b/i.test(sql)) {
    return { rows: params[0] === OWN_EMP && inSession ? [{ one: 1 }] : [] };
  }
  if (/^\s*SELECT\s+id\s+FROM\s+tasks/i.test(sql)) {
    return { rows: params[0] === TASK && inSession ? [{ id: TASK }] : [] };
  }
  if (/^\s*SELECT\s+t\.\*/i.test(sql)) return { rows: [] };
  return { rows: [{ id: TASK }], rowCount: 1 };
}

jest.mock('@/lib/db', () => ({
  query: async (sql: string, params?: unknown[]) => answer(sql, params),
  queryOne: async (sql: string, params?: unknown[]) => answer(sql, params).rows[0] ?? null,
  queryRows: async (sql: string, params?: unknown[]) => answer(sql, params).rows,
}));
jest.mock('@/lib/subscription/limit-response', () => ({ limitExceededResponse: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/hr/manager-scope', () => ({ getEmployeeIdForUser: jest.fn().mockResolvedValue(null) }));

import { GET, POST } from '@/app/api/tasks/route';
import { PATCH } from '@/app/api/tasks/[id]/route';

const headers = {
  'content-type': 'application/json',
  'x-authenticated-user-id': 'user-1',
  'x-authenticated-business-id': 'biz-session',
};
const req = (method: string, body?: unknown, url = 'http://localhost/api/tasks') =>
  new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const writes = () => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));

beforeEach(() => {
  calls.length = 0;
});

describe('POST /api/tasks', () => {
  it('foreign assignee: 404 Assignee not found, nothing written', async () => {
    const res = await POST(req('POST', { title: 'x', assigned_to: FOREIGN_EMP }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Assignee not found');
    expect(writes()).toHaveLength(0);
  });
  it('own assignee: created', async () => {
    const res = await POST(req('POST', { title: 'x', assigned_to: OWN_EMP }));
    expect(res.status).toBe(201);
    expect(writes()).toHaveLength(1);
  });
  it('no assignee: created as before', async () => {
    const res = await POST(req('POST', { title: 'x' }));
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/tasks/[id]', () => {
  const p = { params: { id: TASK } };
  it('foreign assignee: 404, nothing written', async () => {
    const res = await PATCH(req('PATCH', { assigned_to: FOREIGN_EMP }), p);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Assignee not found');
    expect(writes()).toHaveLength(0);
  });
  it('own assignee: updated, UPDATE carries business_id', async () => {
    const res = await PATCH(req('PATCH', { assigned_to: OWN_EMP, status: 'completed' }), p);
    expect(res.status).toBe(200);
    const w = writes();
    expect(w).toHaveLength(1);
    expect(w[0].sql).toMatch(/business_id\s*=/i);
    expect(w[0].params).toContain('biz-session');
  });
  it('null assignee (unassign) proceeds', async () => {
    const res = await PATCH(req('PATCH', { assigned_to: null }), p);
    expect(res.status).toBe(200);
    expect(writes()).toHaveLength(1);
  });
});

describe('GET /api/tasks', () => {
  it('assignee and assigner joins carry the business condition', async () => {
    await GET(req('GET', undefined));
    const sql = calls.find((c) => /FROM tasks t/i.test(c.sql))!.sql;
    expect(sql).toMatch(/JOIN employees assignee ON t\.assigned_to = assignee\.id AND assignee\.business_id = t\.business_id/);
    expect(sql).toMatch(/JOIN employees assigner ON t\.assigned_by = assigner\.id AND assigner\.business_id = t\.business_id/);
  });
});
