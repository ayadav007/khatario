/**
 * Salary payment, salary advance and commission writes act only inside the session business.
 * A body employee_id / commission_id from another business is refused with 404 before any write,
 * ledger post or payslip; authorize() receives the session business; a client-sent approved_by is
 * never stored. DB, session, ledger and payslip are mocked.
 */
import { NextRequest } from 'next/server';

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];

const OWN_EMPLOYEE = '11111111-1111-4111-8111-111111111111';
const FOREIGN_EMPLOYEE = '33333333-3333-4333-8333-333333333333';
const OWN_COMMISSION = '55555555-5555-4555-8555-555555555555';
const FOREIGN_COMMISSION = '66666666-6666-4666-8666-666666666666';
const OWN_EMPLOYEE_IDS = [OWN_EMPLOYEE, 'user-1'];
let commissionStatus = 'approved';

function answer(sql: string, params: unknown[] = []) {
  calls.push({ sql, params });
  const inSession = params.includes('biz-session');
  if (/FROM commission_earnings/i.test(sql) && /^\s*SELECT/i.test(sql)) {
    const ok = params[0] === OWN_COMMISSION && inSession;
    return { rows: ok ? [{ id: OWN_COMMISSION, status: commissionStatus, employee_id: OWN_EMPLOYEE }] : [] };
  }
  if (/^\s*SELECT[\s\S]*FROM employees\b/i.test(sql)) {
    const id = params[0] as string;
    return OWN_EMPLOYEE_IDS.includes(id) && inSession
      ? { rows: [{ id, name: 'Row Name', bank_account_number: null, bank_ifsc: null }] }
      : { rows: [] };
  }
  if (/FROM salary_payments/i.test(sql) || /FROM salary_advances/i.test(sql)) return { rows: [] };
  return { rows: [{ id: 'row', name: 'Asha' }], rowCount: 1 };
}

jest.mock('@/lib/db', () => ({
  query: async (sql: string, params?: unknown[]) => answer(sql, params),
  queryOne: async (sql: string, params?: unknown[]) => answer(sql, params).rows[0] ?? null,
  queryRows: async (sql: string, params?: unknown[]) => answer(sql, params).rows,
}));
const authorizeMock = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/authorization', () => ({
  authorize: (...a: unknown[]) => authorizeMock(...a),
  AuthorizationError: class extends Error {
    toNextResponse() {
      return new Response('denied', { status: 403 });
    }
  },
}));
jest.mock('@/lib/subscription/limit-response', () => ({ limitExceededResponse: jest.fn().mockResolvedValue(null) }));
const ledger = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/hr/staff-wage-posting', () => ({ postSalaryPaymentToBooks: (...a: unknown[]) => ledger(...a) }));
jest.mock('@/lib/hr/leave/leave-encashment-payroll', () => ({
  getPendingEncashmentTotal: jest.fn().mockResolvedValue(0),
  applyPendingLeaveEncashment: jest.fn().mockResolvedValue(0),
}));
jest.mock('@/lib/hr/shift-overtime/ot-payroll', () => ({
  getPendingOtPayrollTotal: jest.fn().mockResolvedValue(0),
  applyPendingOtPayroll: jest.fn().mockResolvedValue(0),
}));
let locked = false;
jest.mock('@/lib/branch-helpers', () => ({ getDefaultBranchId: jest.fn().mockResolvedValue('branch-1') }));
const guardMock = jest.fn(async () =>
  locked ? new Response(JSON.stringify({ error: 'Cannot post salary payment: the period containing 2026-11-01 is locked.', code: 'PERIOD_LOCKED' }), { status: 403 }) : null,
);
jest.mock('@/lib/http/period-guards', () => ({ periodGuardResponse: (...a: unknown[]) => (guardMock as any)(...a) }));
jest.mock('@/lib/payslip-generator', () => ({ generatePayslipHtml: jest.fn().mockResolvedValue('<p></p>') }));

import { POST as payPost } from '@/app/api/employees/salary/payments/route';
import { POST as advancePost } from '@/app/api/employees/salary/advances/route';
import { POST as commissionPost } from '@/app/api/employees/commissions/route';

const headers = {
  'content-type': 'application/json',
  'x-authenticated-user-id': 'user-1',
  'x-authenticated-business-id': 'biz-session',
};
const send = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
const writes = () => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));

beforeEach(() => {
  calls.length = 0;
  commissionStatus = 'approved';
  locked = false;
  guardMock.mockClear();
  authorizeMock.mockClear();
  ledger.mockClear();
});

describe('POST /api/employees/salary/payments', () => {
  const body = (employee_id: string) => ({
    employee_id,
    salary_month: '2026-10',
    from_date: '2026-10-01',
    to_date: '2026-10-31',
    payment_date: '2026-11-01',
    basic_salary: 20000,
  });

  it('refuses a foreign employee with 404; no write, payslip or ledger post', async () => {
    const res = await payPost(send('/api/employees/salary/payments', body(FOREIGN_EMPLOYEE)));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Employee not found' });
    expect(writes()).toEqual([]);
    expect(ledger).not.toHaveBeenCalled();
  });

  it('proceeds for an owned employee, every employee lookup scoped to the session business', async () => {
    const res = await payPost(send('/api/employees/salary/payments', body(OWN_EMPLOYEE)));
    expect(res.status).toBe(201);
    expect(ledger).toHaveBeenCalledTimes(1);
    const lookups = calls.filter((c) => /FROM employees\b/i.test(c.sql));
    expect(lookups.length).toBeGreaterThan(0);
    for (const l of lookups) expect(l.params).toEqual([OWN_EMPLOYEE, 'biz-session']);
  });
});

describe('POST /api/employees/salary/payments, period lock and narration', () => {
  const body = {
    employee_id: OWN_EMPLOYEE,
    salary_month: '2026-10',
    from_date: '2026-10-01',
    to_date: '2026-10-31',
    payment_date: '2026-11-01',
    basic_salary: 20000,
  };

  it('a locked period is refused before anything is written: no INSERT, payslip or ledger call', async () => {
    locked = true;
    const res = await payPost(send('/api/employees/salary/payments', body));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PERIOD_LOCKED');
    expect(writes()).toEqual([]);
    expect(ledger).not.toHaveBeenCalled();
    expect(guardMock).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-session', branchId: 'branch-1', dates: ['2026-11-01'] }));
  });

  it('an open period proceeds', async () => {
    const res = await payPost(send('/api/employees/salary/payments', body));
    expect(res.status).toBe(201);
    expect(ledger).toHaveBeenCalledTimes(1);
  });

  it('the ledger narration name comes from the owned employee row, with no users lookup', async () => {
    await payPost(send('/api/employees/salary/payments', body));
    expect(ledger).toHaveBeenCalledWith(expect.objectContaining({ employeeName: 'Row Name' }));
    expect(calls.filter((c) => /FROM users/i.test(c.sql))).toEqual([]);
  });
});

describe('POST /api/employees/salary/advances', () => {
  const body = (employee_id: string) => ({ employee_id, advance_amount: 5000, advance_date: '2026-11-10' });

  it('refuses a foreign employee with 404 and inserts nothing', async () => {
    const res = await advancePost(send('/api/employees/salary/advances', body(FOREIGN_EMPLOYEE)));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Employee not found' });
    expect(writes()).toEqual([]);
  });

  it('inserts for an owned employee in the session business', async () => {
    const res = await advancePost(send('/api/employees/salary/advances', body(OWN_EMPLOYEE)));
    expect(res.status).toBe(201);
    const w = writes();
    expect(w.length).toBe(1);
    expect(w[0].params[0]).toBe('biz-session');
    expect(w[0].params[1]).toBe(OWN_EMPLOYEE);
  });
});

describe('POST /api/employees/commissions', () => {
  const body = (commission_id: string, over: Record<string, unknown> = {}) => ({
    commission_id,
    action: 'pay',
    approved_by: 'attacker-id',
    updated_by_user_id: 'attacker-id',
    ...over,
  });

  it('refuses a foreign commission with 404, no update, no authorize', async () => {
    const res = await commissionPost(send('/api/employees/commissions', body(FOREIGN_COMMISSION)));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Commission not found' });
    expect(writes()).toEqual([]);
  });

  it('authorizes before loading the commission, so a user without permission gets 403 for any id', async () => {
    authorizeMock.mockRejectedValueOnce(new (jest.requireMock('@/lib/authorization').AuthorizationError)());
    const res = await commissionPost(send('/api/employees/commissions', body(FOREIGN_COMMISSION)));
    expect(res.status).toBe(403);
    expect(calls.filter((c) => /commission_earnings/i.test(c.sql))).toEqual([]);
  });

  it('authorizes the session user against the session business', async () => {
    await commissionPost(send('/api/employees/commissions', body(OWN_COMMISSION)));
    expect(authorizeMock).toHaveBeenCalledWith(
      'user-1',
      'commissions',
      'update',
      expect.objectContaining({ businessId: 'biz-session' }),
    );
  });

  it('pay updates one row, scoped to the session business', async () => {
    const res = await commissionPost(send('/api/employees/commissions', body(OWN_COMMISSION)));
    expect(res.status).toBe(200);
    const w = writes();
    expect(w.length).toBe(1);
    expect(w[0].sql).toMatch(/business_id/i);
    expect(w[0].params).toContain('biz-session');
  });

  it('approve stores the session user, never the body approved_by', async () => {
    commissionStatus = 'pending';
    const res = await commissionPost(send('/api/employees/commissions', body(OWN_COMMISSION, { action: 'approve' })));
    expect(res.status).toBe(200);
    const w = writes();
    expect(w.length).toBe(1);
    expect(w[0].params).toContain('user-1');
    expect(w[0].params).toContain('biz-session');
    for (const c of calls) expect(c.params).not.toContain('attacker-id');
  });

  it('cancel is scoped to the session business too', async () => {
    commissionStatus = 'pending';
    await commissionPost(send('/api/employees/commissions', body(OWN_COMMISSION, { action: 'cancel' })));
    const w = writes();
    expect(w.length).toBe(1);
    expect(w[0].params).toContain('biz-session');
  });
});
