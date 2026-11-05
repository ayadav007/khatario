/**
 * /api/suppliers/[id]/aliases: the supplier in the path must belong to the session business,
 * the caller needs the suppliers permission, and created_by is the session user.
 */
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
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

import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '@/app/api/suppliers/[id]/aliases/route';
import { BUSINESS_A, BUSINESS_B, USER_A, SESSION_VERSION } from './fixtures/identities';

const SUPPLIER_A = '10000000-0000-4000-8000-0000000000a1';
const SUPPLIER_B = '10000000-0000-4000-8000-0000000000b1';
const ALIAS_B = '20000000-0000-4000-8000-0000000000b1';
const OWNER_OF = { [SUPPLIER_A]: BUSINESS_A, [SUPPLIER_B]: BUSINESS_B } as Record<string, string>;

const sessionA = {
  'x-authenticated-user-id': USER_A,
  'x-authenticated-business-id': BUSINESS_A,
  'x-authenticated-session-version': SESSION_VERSION,
};

beforeEach(() => {
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockQueryOne.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    const supplier = params.find((p) => typeof p === 'string' && p in OWNER_OF) as string | undefined;
    const scope = params.find((p) => p === BUSINESS_A || p === BUSINESS_B);
    if (/FROM suppliers/i.test(text)) {
      if (!supplier) return null;
      if (scope && scope !== OWNER_OF[supplier]) return null;
      return { id: supplier, business_id: OWNER_OF[supplier] };
    }
    if (/INSERT INTO supplier_name_aliases/i.test(text)) return { id: 'alias-new', supplier_id: supplier };
    return null; // no existing alias
  });
  mockQuery.mockReset().mockResolvedValue([]);
});

const url = (id: string, q = '') => `http://localhost/api/suppliers/${id}/aliases${q}`;
const writes = () =>
  [...mockQuery.mock.calls, ...mockQueryOne.mock.calls].filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(String(sql)));

it('GET refuses an unauthenticated request', async () => {
  const res = await GET(new NextRequest(url(SUPPLIER_A)), { params: { id: SUPPLIER_A } });
  expect(res.status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
});

it("GET does not list another business's supplier aliases", async () => {
  const res = await GET(new NextRequest(url(SUPPLIER_B), { headers: sessionA }), { params: { id: SUPPLIER_B } });
  expect(res.status).toBe(404);
  expect(mockQuery).not.toHaveBeenCalled();
});

it('GET requires the suppliers read permission', async () => {
  const { AuthorizationError } = jest.requireMock('@/lib/authorization');
  mockAuthorize.mockRejectedValue(new AuthorizationError('denied'));
  const res = await GET(new NextRequest(url(SUPPLIER_A), { headers: sessionA }), { params: { id: SUPPLIER_A } });
  expect(res.status).toBe(403);
  expect(mockAuthorize).toHaveBeenCalledWith(USER_A, 'suppliers', 'read', expect.objectContaining({ businessId: BUSINESS_A }));
});

it("POST does not add an alias to another business's supplier", async () => {
  const res = await POST(
    new NextRequest(url(SUPPLIER_B), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...sessionA },
      body: JSON.stringify({ alias_name: 'ACME Traders' }),
    }),
    { params: { id: SUPPLIER_B } },
  );
  expect(res.status).toBe(404);
  expect(writes()).toEqual([]);
});

it('POST needs the suppliers update permission and records the session user', async () => {
  const { AuthorizationError } = jest.requireMock('@/lib/authorization');
  mockAuthorize.mockRejectedValueOnce(new AuthorizationError('denied'));
  const denied = await POST(
    new NextRequest(url(SUPPLIER_A), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...sessionA },
      body: JSON.stringify({ alias_name: 'ACME Traders' }),
    }),
    { params: { id: SUPPLIER_A } },
  );
  expect(denied.status).toBe(403);
  expect(writes()).toEqual([]);

  const ok = await POST(
    new NextRequest(url(SUPPLIER_A), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...sessionA },
      body: JSON.stringify({ alias_name: 'ACME Traders' }),
    }),
    { params: { id: SUPPLIER_A } },
  );
  expect(ok.status).toBe(201);
  expect(mockAuthorize).toHaveBeenLastCalledWith(USER_A, 'suppliers', 'update', expect.objectContaining({ businessId: BUSINESS_A }));
  const insert = mockQueryOne.mock.calls.find(([sql]) => /INSERT INTO supplier_name_aliases/i.test(String(sql)));
  expect(insert![1]).toContain(USER_A);
});

it("DELETE does not remove another business's alias", async () => {
  const res = await DELETE(new NextRequest(url(SUPPLIER_B, `?alias_id=${ALIAS_B}`), { method: 'DELETE', headers: sessionA }), {
    params: { id: SUPPLIER_B },
  });
  expect(res.status).toBe(404);
  expect(writes()).toEqual([]);
});

it('DELETE on an owned supplier is scoped to the business', async () => {
  const res = await DELETE(new NextRequest(url(SUPPLIER_A, `?alias_id=${ALIAS_B}`), { method: 'DELETE', headers: sessionA }), {
    params: { id: SUPPLIER_A },
  });
  expect(res.status).toBe(200);
  const del = mockQuery.mock.calls.find(([sql]) => /DELETE FROM supplier_name_aliases/i.test(String(sql)));
  expect(del).toBeDefined();
  expect(del![1]).toContain(BUSINESS_A);
});
