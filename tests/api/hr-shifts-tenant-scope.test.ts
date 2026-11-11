/**
 * Shift roster and bulk assign write only to the session business's own employees and shifts.
 * A body employee_id or shift_id from another business is refused with 404 before any write, and the
 * roster / bulk-assign / absent-marking SQL is scoped to the business on its own. DB and session are mocked.
 */
import { NextRequest } from 'next/server';

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];

const OWN_EMPLOYEES = ['11111111-1111-4111-8111-111111111111'];
const OWN_SHIFTS = ['22222222-2222-4222-8222-222222222222'];
const FOREIGN_EMPLOYEE = '33333333-3333-4333-8333-333333333333';
const FOREIGN_SHIFT = '44444444-4444-4444-8444-444444444444';

function answer(sql: string, params: unknown[] = []) {
  calls.push({ sql, params });
  if (/FROM employees\b[\s\S]*ANY\(/i.test(sql) && /^\s*SELECT id/i.test(sql)) {
    const ids = params[0] as string[];
    return { rows: ids.filter((id) => OWN_EMPLOYEES.includes(id)).map((id) => ({ id })) };
  }
  if (/FROM shifts\b[\s\S]*ANY\(/i.test(sql) && /^\s*SELECT id/i.test(sql)) {
    const ids = params[0] as string[];
    return { rows: ids.filter((id) => OWN_SHIFTS.includes(id)).map((id) => ({ id })) };
  }
  return { rows: [{ id: 'row' }], rowCount: 1 };
}

jest.mock('@/lib/db', () => ({
  query: async (sql: string, params?: unknown[]) => answer(sql, params),
  queryOne: async (sql: string, params?: unknown[]) => answer(sql, params).rows[0] ?? null,
  queryRows: async (sql: string, params?: unknown[]) => answer(sql, params).rows,
}));
jest.mock('@/lib/authorization', () => ({
  authorize: jest.fn().mockResolvedValue(undefined),
  AuthorizationError: class extends Error {
    toNextResponse() {
      return new Response('denied', { status: 403 });
    }
  },
}));

import { PATCH as rosterPatch } from '@/app/api/hr/shifts/roster/route';
import { POST as bulkPost } from '@/app/api/hr/shifts/bulk-assign/route';
import { runShiftRosterAbsentMarking } from '@/lib/hr/shift-overtime/roster-absent';

const headers = { 'content-type': 'application/json', 'x-authenticated-user-id': 'user-1', 'x-authenticated-business-id': 'biz-session' };
const send = (path: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, headers, body: JSON.stringify(body) });

const writes = () => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));

beforeEach(() => {
  calls.length = 0;
});

describe('PATCH /api/hr/shifts/roster', () => {
  const entry = (employee_id: string, shift_id: string | null) => ({ employee_id, roster_date: '2026-11-10', shift_id, is_day_off: shift_id === null });

  it('refuses a foreign employee with 404 and writes nothing', async () => {
    const res = await rosterPatch(send('/api/hr/shifts/roster', 'PATCH', { entries: [entry(FOREIGN_EMPLOYEE, OWN_SHIFTS[0])] }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Employee or shift not found' });
    expect(writes()).toEqual([]);
  });

  it('refuses a foreign shift with 404 and writes nothing', async () => {
    const res = await rosterPatch(send('/api/hr/shifts/roster', 'PATCH', { entries: [entry(OWN_EMPLOYEES[0], FOREIGN_SHIFT)] }));
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it('refuses the whole request when one of two entries is foreign', async () => {
    const res = await rosterPatch(
      send('/api/hr/shifts/roster', 'PATCH', { entries: [entry(OWN_EMPLOYEES[0], OWN_SHIFTS[0]), entry(FOREIGN_EMPLOYEE, null)] }),
    );
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it('checks against the session business', async () => {
    await rosterPatch(send('/api/hr/shifts/roster', 'PATCH', { entries: [entry(OWN_EMPLOYEES[0], OWN_SHIFTS[0])] }));
    const lookups = calls.filter((c) => /ANY\(/i.test(c.sql));
    expect(lookups.length).toBe(2);
    for (const l of lookups) expect(l.params[1]).toBe('biz-session');
  });

  it('proceeds for owned employee and shift, and a day off needs no shift', async () => {
    const res = await rosterPatch(
      send('/api/hr/shifts/roster', 'PATCH', { entries: [entry(OWN_EMPLOYEES[0], OWN_SHIFTS[0]), entry(OWN_EMPLOYEES[0], null)] }),
    );
    expect(res.status).toBe(200);
    expect(writes().length).toBe(2);
    for (const w of writes()) expect(w.params[0]).toBe('biz-session');
  });

  it('the roster write itself is scoped to the business employees and shifts', async () => {
    await rosterPatch(send('/api/hr/shifts/roster', 'PATCH', { entries: [entry(OWN_EMPLOYEES[0], OWN_SHIFTS[0])] }));
    const sql = writes()[0].sql;
    expect(sql).toMatch(/employees/);
    expect(sql).toMatch(/e\.business_id = \$1/);
    expect(sql).toMatch(/sh\.business_id = \$1/);
  });
});

describe('POST /api/hr/shifts/bulk-assign', () => {
  const body = (over: Record<string, unknown>) => ({ shift_id: OWN_SHIFTS[0], employee_ids: [OWN_EMPLOYEES[0]], effective_from: '2026-11-10', effective_to: null, ...over });

  it('refuses a foreign employee with 404, no UPDATE or INSERT', async () => {
    const res = await bulkPost(send('/api/hr/shifts/bulk-assign', 'POST', body({ employee_ids: [OWN_EMPLOYEES[0], FOREIGN_EMPLOYEE] })));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Employee or shift not found' });
    expect(writes()).toEqual([]);
  });

  it('refuses a foreign shift with 404, no UPDATE or INSERT', async () => {
    const res = await bulkPost(send('/api/hr/shifts/bulk-assign', 'POST', body({ shift_id: FOREIGN_SHIFT })));
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it('proceeds for owned ids, with business-scoped statements', async () => {
    const res = await bulkPost(send('/api/hr/shifts/bulk-assign', 'POST', body({})));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assigned: 1 });
    const w = writes();
    expect(w.length).toBe(2);
    expect(w[0].sql).toMatch(/business_id = \$2/);
    expect(w[1].sql).toMatch(/e\.business_id = \$1/);
    expect(w[1].sql).toMatch(/sh\.business_id = \$1/);
  });

  it('clearing the default shift (null) needs no shift lookup', async () => {
    const res = await bulkPost(send('/api/hr/shifts/bulk-assign', 'POST', body({ shift_id: null })));
    expect(res.status).toBe(200);
    expect(calls.filter((c) => /FROM shifts\b[\s\S]*ANY\(/i.test(c.sql))).toEqual([]);
  });
});

describe('runShiftRosterAbsentMarking', () => {
  it('joins employees and attendance only within the business', async () => {
    await runShiftRosterAbsentMarking({ businessId: 'biz-a', targetDate: '2026-11-09' });
    const sqls = calls.map((c) => c.sql);
    const rostered = sqls.find((s) => /FROM shift_roster_entries r/i.test(s))!;
    expect(rostered).toMatch(/e\.business_id = r\.business_id/);
    expect(rostered).toMatch(/s\.business_id = r\.business_id/);
    const attendance = sqls.filter((s) => /employee_attendance/i.test(s));
    expect(attendance.length).toBeGreaterThan(0);
    for (const s of attendance) expect(s).toMatch(/business_id/);
  });
});
