/**
 * Actor fields (created_by, uploaded_by, assigned_by, approved_by, preset owner) must always be
 * the authenticated server-side identity. Middleware does not strip `x-user-id`, and request
 * bodies are client-controlled, so neither may choose who is recorded as acting.
 */
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockQueryRows = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('@/lib/db', () => {
  const api = {
    query: (...a: unknown[]) => mockQuery(...a),
    queryOne: (...a: unknown[]) => mockQueryOne(...a),
    queryRows: (...a: unknown[]) => mockQueryRows(...a),
    getPool: () => ({ connect: async () => ({ query: mockClientQuery, release: jest.fn() }) }),
  };
  return { ...api, db: api };
});
jest.mock('@/lib/subscription/limit-response', () => ({ limitExceededResponse: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {}
  return { assertFeatureAccess: jest.fn().mockResolvedValue(undefined), FeatureAccessDeniedError };
});
jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return { authorize: jest.fn().mockResolvedValue(undefined), AuthorizationError };
});
const EMPLOYEE_A = '30000000-0000-4000-8000-0000000000a1';
const EMPLOYEE_B = '30000000-0000-4000-8000-0000000000b1';
jest.mock('@/lib/hr/manager-scope', () => ({
  canActOnExpense: jest.fn().mockResolvedValue(true),
  isEmployeePortalSession: jest.fn().mockReturnValue(false),
  getEmployeeIdForUser: jest.fn(async (userId: string) => (userId === 'cccccccc-cccc-cccc-cccc-cccccccccccc' ? EMPLOYEE_A : null)),
}));

import { NextRequest } from 'next/server';
import { BUSINESS_A, USER_A, USER_B, SESSION_VERSION } from './fixtures/identities';

const sessionA = {
  'x-authenticated-user-id': USER_A,
  'x-authenticated-business-id': BUSINESS_A,
  'x-authenticated-session-version': SESSION_VERSION,
};
const forgedActor = { 'x-user-id': USER_B };

function json(path: string, method: string, body: unknown, headers: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const paramsOf = (calls: unknown[][], pattern: RegExp) => calls.find(([sql]) => pattern.test(String(sql)))?.[1] as unknown[] | undefined;

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [{ id: 'row' }], rowCount: 1 });
  mockQueryOne.mockReset().mockResolvedValue(null);
  mockQueryRows.mockReset().mockResolvedValue([]);
  mockClientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
});

it('opening balances record the session user, not the x-user-id header', async () => {
  const { POST } = await import('@/app/api/opening-balances/route');
  const res = await POST(
    json('/api/opening-balances', 'POST', {
      business_id: BUSINESS_A,
      opening_balances: [
        { entity_type: 'customer', entity_id: '40000000-0000-4000-8000-000000000001', opening_balance: 100, opening_balance_type: 'debit', as_on_date: '2026-04-01' },
      ],
    }, { ...sessionA, ...forgedActor }),
  );
  expect(res.status).toBeLessThan(300);
  const params = paramsOf(mockQuery.mock.calls, /INSERT INTO opening_balance_transactions/i);
  expect(params).toContain(USER_A);
  expect(params).not.toContain(USER_B);
});

it('journal templates record the session user as created_by', async () => {
  const { POST } = await import('@/app/api/journal-entries/templates/route');
  const res = await POST(
    json('/api/journal-entries/templates', 'POST', {
      business_id: BUSINESS_A,
      name: 'Monthly rent',
      lines: [{ account_id: 'a1', debit: 1 }, { account_id: 'a2', credit: 1 }],
    }, { ...sessionA, ...forgedActor }),
  );
  expect(res.status).toBe(201);
  const params = paramsOf(mockQuery.mock.calls, /INSERT INTO journal_entry_templates/i);
  expect(params).toContain(USER_A);
  expect(params).not.toContain(USER_B);
});

describe('filter presets', () => {
  it('a preset belongs to the session user', async () => {
    const { POST } = await import('@/app/api/filters/presets/route');
    mockQueryOne.mockResolvedValue({ id: 'preset-1' });
    const res = await POST(
      json('/api/filters/presets', 'POST', { business_id: BUSINESS_A, name: 'Mine', entity_type: 'invoices', filters: {}, is_default: true }, {
        ...sessionA,
        ...forgedActor,
      }),
    );
    expect(res.status).toBeLessThan(300);
    const insert = paramsOf([...mockQueryRows.mock.calls, ...mockQueryOne.mock.calls, ...mockQuery.mock.calls], /INSERT INTO filter_presets/i);
    expect(insert).toContain(USER_A);
    expect(insert).not.toContain(USER_B);
    for (const [sql, params] of mockQuery.mock.calls) {
      if (/UPDATE filter_presets/i.test(String(sql))) expect(params).not.toContain(USER_B);
    }
  });

  it('listing uses the session user to pick private presets', async () => {
    const { GET } = await import('@/app/api/filters/presets/route');
    const res = await GET(
      new NextRequest(`http://localhost/api/filters/presets?business_id=${BUSINESS_A}&entity_type=invoices`, {
        headers: { ...sessionA, ...forgedActor },
      }),
    );
    expect(res.status).toBe(200);
    const params = paramsOf(mockQueryRows.mock.calls, /FROM filter_presets/i);
    expect(params).toContain(USER_A);
    expect(params).not.toContain(USER_B);
  });
});

it('document uploads record the session user as uploaded_by', async () => {
  const { POST } = await import('@/app/api/documents/route');
  mockQueryOne.mockResolvedValue({ id: 'doc-1' });
  const form = new FormData();
  form.append('file', new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' }));
  form.append('business_id', BUSINESS_A);
  form.append('entity_type', 'customer');
  form.append('entity_id', '40000000-0000-4000-8000-000000000001');
  const res = await POST(new NextRequest('http://localhost/api/documents', { method: 'POST', headers: { ...sessionA, ...forgedActor }, body: form }));
  expect(res.status).toBeLessThan(300);
  const params = paramsOf(mockQueryOne.mock.calls, /INSERT INTO document_attachments/i);
  expect(params).toContain(USER_A);
  expect(params).not.toContain(USER_B);
});

it('a task is assigned_by the acting employee, not a body value', async () => {
  const { POST } = await import('@/app/api/tasks/route');
  mockQueryOne.mockResolvedValue({ id: 'task-1' });
  const res = await POST(
    json('/api/tasks', 'POST', { business_id: BUSINESS_A, title: 'Count stock', assigned_to: EMPLOYEE_A, assigned_by: EMPLOYEE_B }, sessionA),
  );
  expect(res.status).toBe(201);
  const params = paramsOf(mockQueryOne.mock.calls, /INSERT INTO tasks/i);
  expect(params).toContain(EMPLOYEE_A);
  expect(params).not.toContain(EMPLOYEE_B);
});

it('an expense approval records the acting employee as approved_by, not a body value', async () => {
  const { PATCH } = await import('@/app/api/employees/expenses/[id]/route');
  const EXPENSE = '50000000-0000-4000-8000-000000000001';
  mockQueryOne.mockImplementation(async (sql: string) =>
    /FROM employee_expenses/i.test(String(sql)) ? { id: EXPENSE, status: 'pending', employee_id: EMPLOYEE_B, business_id: BUSINESS_A } : null,
  );
  const res = await PATCH(
    json(`/api/employees/expenses/${EXPENSE}`, 'PATCH', { action: 'approve', approved_by: EMPLOYEE_B }, sessionA),
    { params: { id: EXPENSE } },
  );
  expect(res.status).toBeLessThan(300);
  const params = paramsOf(mockQuery.mock.calls, /UPDATE employee_expenses[\s\S]*approved_by/i);
  expect(params).toBeDefined();
  expect(params).toContain(EMPLOYEE_A);
  expect(params).not.toContain(EMPLOYEE_B);
});
