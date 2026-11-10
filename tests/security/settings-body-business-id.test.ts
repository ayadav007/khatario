/**
 * Settings writes the phone app makes: the business is the session business only. A body
 * `business_id` naming another business is refused, and a body without one still works.
 */
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: jest.fn().mockResolvedValue([]),
  getPool: () => ({ connect: async () => ({ query: mockClientQuery, release: () => {} }) }),
}));
const mockAuthorize = jest.fn();
jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return { authorize: (...a: unknown[]) => mockAuthorize(...a), AuthorizationError };
});
jest.mock('@/lib/subscription/feature-access', () => {
  const actual = jest.requireActual('@/lib/subscription/feature-access');
  return { ...actual, denyIfFeatureMissing: jest.fn().mockResolvedValue(null) };
});
jest.mock('@/lib/accounting/bank-register', () => ({
  applyBankLedgerOpeningBalance: jest.fn(),
  assertBankLedgerAvailable: jest.fn(),
  BankRegisterError: class extends Error {},
  createBankLedger: jest.fn().mockResolvedValue('ledger-new'),
}));
jest.mock('@/lib/accounting/settlement-accounts-db', () => ({ ledgerHasOpeningBalance: jest.fn().mockResolvedValue(false) }));

import { NextRequest } from 'next/server';
import { POST as postLeaveBalance } from '@/app/api/employees/leave-balances/route';
import { POST as postBankAccount, PUT as putBankAccount } from '@/app/api/bank-accounts/route';
import { BUSINESS_A, BUSINESS_B, USER_A, SESSION_VERSION } from './fixtures/identities';

const EMP_A = '30000000-0000-4000-8000-0000000000a1';
const EMP_B = '30000000-0000-4000-8000-0000000000b1';
const LT_A = '40000000-0000-4000-8000-0000000000a1';
const LT_B = '40000000-0000-4000-8000-0000000000b1';
const OWNER_OF: Record<string, string> = { [EMP_A]: BUSINESS_A, [EMP_B]: BUSINESS_B, [LT_A]: BUSINESS_A, [LT_B]: BUSINESS_B };

const sessionA = {
  'x-authenticated-user-id': USER_A,
  'x-authenticated-business-id': BUSINESS_A,
  'x-authenticated-session-version': SESSION_VERSION,
  'content-type': 'application/json',
};
const req = (url: string, body: unknown, method = 'POST') =>
  new NextRequest(`http://localhost${url}`, { method, headers: sessionA, body: JSON.stringify(body) });
const writes = () =>
  [...mockQuery.mock.calls, ...mockQueryOne.mock.calls, ...mockClientQuery.mock.calls].filter(([sql]) =>
    /^\s*(INSERT|UPDATE|DELETE)/i.test(String(sql)),
  );

beforeEach(() => {
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientQuery.mockReset().mockImplementation(async (sql: string) =>
    /INSERT INTO bank_accounts/i.test(sql) ? { rows: [{ id: 'bank-new', ledger_account_id: 'ledger-new' }] } : { rows: [] },
  );
  mockQueryOne.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    const [id, scope] = params as string[];
    if (/FROM (employees|leave_types)/i.test(text)) {
      return OWNER_OF[id] && OWNER_OF[id] === scope ? { id } : null;
    }
    if (/INSERT INTO leave_balances/i.test(text)) return { id: 'lb-new' };
    if (/FROM bank_accounts WHERE id/i.test(text)) return scope === BUSINESS_A ? { id, business_id: BUSINESS_A } : null;
    return null;
  });
});

describe('POST /api/employees/leave-balances', () => {
  const body = { employee_id: EMP_A, leave_type_id: LT_A, year: 2026, opening_balance: 5 };

  it('works without a body business_id, scoped to the session business', async () => {
    const res = await postLeaveBalance(req('/api/employees/leave-balances', body));
    expect(res.status).toBe(201);
    expect(mockAuthorize).toHaveBeenCalledWith(USER_A, 'leave_requests', 'create', expect.objectContaining({ businessId: BUSINESS_A }));
  });

  it('refuses a body business_id naming another business', async () => {
    const res = await postLeaveBalance(
      req('/api/employees/leave-balances', { ...body, business_id: BUSINESS_B, employee_id: EMP_B, leave_type_id: LT_B }),
    );
    expect(res.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it("does not set a balance for another business's employee", async () => {
    const res = await postLeaveBalance(req('/api/employees/leave-balances', { ...body, employee_id: EMP_B }));
    expect(res.status).toBe(404);
    expect(writes()).toHaveLength(0);
  });

  it("does not use another business's leave type", async () => {
    const res = await postLeaveBalance(req('/api/employees/leave-balances', { ...body, leave_type_id: LT_B }));
    expect(res.status).toBe(404);
    expect(writes()).toHaveLength(0);
  });
});

describe('/api/bank-accounts', () => {
  const body = { account_name: 'Current', account_number: '1234', bank_name: 'SBI', create_ledger: true };

  it('POST works without a body business_id and writes to the session business', async () => {
    const res = await postBankAccount(req('/api/bank-accounts', body));
    expect(res.status).toBe(201);
    const insert = mockClientQuery.mock.calls.find(([sql]) => /INSERT INTO bank_accounts/i.test(String(sql)));
    expect(insert?.[1]?.[0]).toBe(BUSINESS_A);
  });

  it('POST refuses a body business_id naming another business', async () => {
    const res = await postBankAccount(req('/api/bank-accounts', { ...body, business_id: BUSINESS_B }));
    expect(res.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('PUT works without a body business_id', async () => {
    const res = await putBankAccount(req('/api/bank-accounts', { id: 'bank-1', account_name: 'Renamed' }, 'PUT'));
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
  });
});
