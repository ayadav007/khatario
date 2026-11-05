/**
 * /api/tax-provisions/[id]/payments.
 *
 * The provision id comes from the path. Reads and the payment write must be confined to the
 * session business, need the accounting (journal) permission, and record the session user as
 * created_by regardless of any user id in the body.
 */
const mockQueryOne = jest.fn();
const mockQueryRows = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: (...a: unknown[]) => mockQueryRows(...a),
  query: jest.fn(),
  getPool: () => ({ connect: async () => ({ query: mockClientQuery, release: jest.fn() }) }),
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
jest.mock('@/lib/subscription/feature-access', () => ({
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tax-provisions/[id]/payments/route';
import { BUSINESS_A, BUSINESS_B, USER_A, USER_B, SESSION_VERSION } from './fixtures/identities';

const PROVISION_A = '10000000-0000-4000-8000-0000000000a1';
const PROVISION_B = '10000000-0000-4000-8000-0000000000b1';
const OWNER_OF = { [PROVISION_A]: BUSINESS_A, [PROVISION_B]: BUSINESS_B } as Record<string, string>;

const sessionA = {
  'x-authenticated-user-id': USER_A,
  'x-authenticated-business-id': BUSINESS_A,
  'x-authenticated-session-version': SESSION_VERSION,
};

/** Rows exist for both tenants; a lookup scoped to the wrong business, or not scoped at all, must not match. */
function provisionLookup(sql: string, params: unknown[]) {
  if (!/FROM tax_provisions/i.test(sql)) return null;
  const id = params.find((p) => typeof p === 'string' && p in OWNER_OF) as string | undefined;
  const scope = params.find((p) => p === BUSINESS_A || p === BUSINESS_B);
  if (!id) return null;
  if (!scope) return { id, provision_amount: '1000', paid_amount: '0', business_id: OWNER_OF[id], unscoped: true };
  if (scope !== OWNER_OF[id]) return null;
  return { id, provision_amount: '1000', paid_amount: '0', business_id: OWNER_OF[id] };
}

beforeEach(() => {
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockQueryOne.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => provisionLookup(String(sql), params));
  mockQueryRows.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM tax_payments/i.test(String(sql))) {
      const scope = params.find((p) => p === BUSINESS_A || p === BUSINESS_B);
      const id = params.find((p) => typeof p === 'string' && p in OWNER_OF) as string;
      if (scope && scope !== OWNER_OF[id]) return [];
      return [{ id: 'pay-1', payment_date: '2026-09-30', payment_amount: '250.00' }];
    }
    return [];
  });
  mockClientQuery.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    if (/INSERT INTO tax_payments/i.test(text)) return { rows: [{ id: 'pay-new' }], rowCount: 1 };
    const row = provisionLookup(text, params);
    if (/FROM tax_provisions/i.test(text)) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
});

function get(id: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest(`http://localhost/api/tax-provisions/${id}/payments`, { headers }), { params: { id } });
}
function post(id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest(`http://localhost/api/tax-provisions/${id}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  );
}
const writes = () => mockClientQuery.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(String(sql)));

describe('GET', () => {
  it('refuses an unauthenticated request', async () => {
    const res = await get(PROVISION_A);
    expect(res.status).toBe(401);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("does not list another business's tax payments", async () => {
    const res = await get(PROVISION_B, sessionA);
    expect(res.status).toBe(404);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it('requires the journal read permission', async () => {
    const { AuthorizationError } = jest.requireMock('@/lib/authorization');
    mockAuthorize.mockRejectedValue(new AuthorizationError('denied'));
    const res = await get(PROVISION_A, sessionA);
    expect(res.status).toBe(403);
    expect(mockAuthorize).toHaveBeenCalledWith(USER_A, 'journal', 'read', expect.objectContaining({ businessId: BUSINESS_A }));
  });

  it('lists payments of an owned provision, scoped to the business', async () => {
    const res = await get(PROVISION_A, sessionA);
    expect(res.status).toBe(200);
    expect((await res.json()).payments).toHaveLength(1);
    const [, params] = mockQueryRows.mock.calls[0];
    expect(params).toContain(BUSINESS_A);
  });
});

describe('POST', () => {
  const payment = { payment_date: '2026-10-01', payment_amount: 250, payment_mode: 'online' };

  it('refuses an unauthenticated request', async () => {
    const res = await post(PROVISION_A, { ...payment, business_id: BUSINESS_A });
    expect(res.status).toBe(401);
    expect(writes()).toEqual([]);
  });

  it("does not record a payment against another business's provision", async () => {
    const res = await post(PROVISION_B, { ...payment, business_id: BUSINESS_A }, sessionA);
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it('refuses a restricted staff user without the journal create permission', async () => {
    const { AuthorizationError } = jest.requireMock('@/lib/authorization');
    mockAuthorize.mockRejectedValue(new AuthorizationError('denied'));
    const res = await post(PROVISION_A, { ...payment, business_id: BUSINESS_A }, sessionA);
    expect(res.status).toBe(403);
    expect(mockAuthorize).toHaveBeenCalledWith(USER_A, 'journal', 'create', expect.objectContaining({ businessId: BUSINESS_A }));
    expect(writes()).toEqual([]);
  });

  it('records created_by as the session user, ignoring a body user_id, and scopes the update', async () => {
    const res = await post(PROVISION_A, { ...payment, business_id: BUSINESS_A, user_id: USER_B }, sessionA);
    expect(res.status).toBe(201);
    const insert = mockClientQuery.mock.calls.find(([sql]) => /INSERT INTO tax_payments/i.test(String(sql)));
    expect(insert).toBeDefined();
    expect(insert![1]).toContain(USER_A);
    expect(insert![1]).not.toContain(USER_B);
    const lock = mockClientQuery.mock.calls.find(([sql]) => /FROM tax_provisions/i.test(String(sql)));
    expect(String(lock![0])).toMatch(/FOR UPDATE/i);
    expect(lock![1]).toContain(BUSINESS_A);
    const update = mockClientQuery.mock.calls.find(([sql]) => /UPDATE tax_provisions/i.test(String(sql)));
    expect(String(update![0])).toMatch(/business_id/i);
    expect(update![1]).toContain(BUSINESS_A);
  });

  it('still refuses a body business_id that differs from the session', async () => {
    const res = await post(PROVISION_A, { ...payment, business_id: BUSINESS_B }, sessionA);
    expect(res.status).toBe(403);
    expect(writes()).toEqual([]);
  });
});
