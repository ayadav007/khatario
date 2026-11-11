/**
 * /api/warehouses/[id]/branches and PATCH /api/warehouses/[id].
 *
 * `authorize` returns early for a business owner before its warehouse and branch checks, so these
 * handlers must prove themselves that the warehouse in the path and every branch id in the body
 * belong to the session business, and every statement that changes branch_warehouses or
 * warehouses must be scoped to that business.
 */
const mockQueryOne = jest.fn();
const mockQueryRows = jest.fn();
const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: (...a: unknown[]) => mockQueryRows(...a),
  query: (...a: unknown[]) => mockQuery(...a),
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
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {}
  return { assertFeatureAccess: jest.fn().mockResolvedValue(undefined), FeatureAccessDeniedError };
});
jest.mock('@/lib/gst/registration', () => ({ checkWarehousePlace: jest.fn().mockResolvedValue(null) }));

import { NextRequest } from 'next/server';
import { GET as linksGet, PATCH as linksPatch } from '@/app/api/warehouses/[id]/branches/route';
import { PATCH as warehousePatch } from '@/app/api/warehouses/[id]/route';
import { BUSINESS_A, BUSINESS_B, USER_A, SESSION_VERSION } from './fixtures/identities';

const WAREHOUSE_A = '10000000-0000-4000-8000-00000000000a';
const WAREHOUSE_B = '10000000-0000-4000-8000-00000000000b';
const BRANCH_A1 = '20000000-0000-4000-8000-0000000000a1';
const BRANCH_A2 = '20000000-0000-4000-8000-0000000000a2';
const BRANCH_B1 = '20000000-0000-4000-8000-0000000000b1';

const sessionA = {
  'x-authenticated-user-id': USER_A,
  'x-authenticated-business-id': BUSINESS_A,
  'x-authenticated-session-version': SESSION_VERSION,
};

const OWNED = {
  [BUSINESS_A]: { warehouses: [WAREHOUSE_A], branches: [BRANCH_A1, BRANCH_A2] },
  [BUSINESS_B]: { warehouses: [WAREHOUSE_B], branches: [BRANCH_B1] },
} as Record<string, { warehouses: string[]; branches: string[] }>;

/**
 * A database with two tenants. Ownership lookups answer only for the business named in the
 * parameters; an unscoped lookup (no business id among the params) answers for any row, so a
 * missing scope shows up as a cross-tenant result rather than a mocked-away one.
 */
function twoTenantDb() {
  const owningBusiness = (id: string) =>
    Object.keys(OWNED).find((b) => OWNED[b].warehouses.includes(id) || OWNED[b].branches.includes(id));
  const scopeOf = (params: unknown[]) => params.find((p) => typeof p === 'string' && p in OWNED) as string | undefined;

  mockQueryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    const scope = scopeOf(params);
    if (/FROM warehouses/i.test(text)) {
      const id = params.find((p) => typeof p === 'string' && owningBusiness(p) && /0000000a|0000000b$/.test(p)) as string;
      const owner = owningBusiness(id);
      if (!owner || (scope && scope !== owner)) return null;
      return { id, business_id: owner, name: 'Main', branch_id: null, warehouse_code: 'W1', state: 'Gujarat' };
    }
    if (/UPDATE warehouses/i.test(text)) return { id: WAREHOUSE_A, business_id: BUSINESS_A };
    return null;
  });
  mockQueryRows.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    const scope = scopeOf(params);
    if (/FROM branches/i.test(text)) {
      const ids = (params.find((p) => Array.isArray(p)) as string[] | undefined) ?? null;
      const owned = scope ? OWNED[scope].branches : Object.values(OWNED).flatMap((o) => o.branches);
      const rows = (ids ? owned.filter((b) => ids.includes(b)) : owned).map((id) => ({ id, name: id, branch_code: id, is_active: true }));
      return rows;
    }
    if (/FROM branch_warehouses/i.test(text)) return [{ branch_id: BRANCH_B1, is_primary: true }];
    return [];
  });
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
}

function mutations() {
  return [...mockClientQuery.mock.calls, ...mockQuery.mock.calls]
    .map(([sql]) => String(sql))
    .filter((sql) => /^\s*(DELETE|INSERT|UPDATE)/i.test(sql));
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockQueryRows.mockReset();
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  twoTenantDb();
});

function patchLinks(warehouseId: string, body: Record<string, unknown>) {
  return linksPatch(
    new NextRequest(`http://localhost/api/warehouses/${warehouseId}/branches`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...sessionA },
      body: JSON.stringify(body),
    }),
    { params: { id: warehouseId } },
  );
}

describe('PATCH /api/warehouses/[id]/branches', () => {
  it("refuses to relink another business's warehouse and changes nothing", async () => {
    const res = await patchLinks(WAREHOUSE_B, { branch_ids: [BRANCH_A1], primary_branch_id: BRANCH_A1 });
    expect(res.status).toBe(404);
    expect(mutations()).toEqual([]);
  });

  it("refuses to link another business's branch to our warehouse", async () => {
    const res = await patchLinks(WAREHOUSE_A, { branch_ids: [BRANCH_A1, BRANCH_B1], primary_branch_id: BRANCH_A1 });
    expect(res.status).toBe(400);
    expect(mutations()).toEqual([]);
  });

  it('refuses a primary branch that is not one of the linked, owned branches', async () => {
    const res = await patchLinks(WAREHOUSE_A, { branch_ids: [BRANCH_A1], primary_branch_id: BRANCH_B1 });
    expect(res.status).toBe(400);
    expect(mutations()).toEqual([]);
  });

  it('relinks owned branches and scopes every mutation to the session business', async () => {
    const res = await patchLinks(WAREHOUSE_A, { branch_ids: [BRANCH_A1, BRANCH_A2], primary_branch_id: BRANCH_A2 });
    expect(res.status).toBe(200);
    const writes = [...mockClientQuery.mock.calls].filter(([sql]) => /^\s*(DELETE|INSERT|UPDATE)/i.test(String(sql)));
    expect(writes.length).toBeGreaterThan(0);
    for (const [sql, params] of writes) {
      expect(String(sql)).toMatch(/business_id/i);
      expect(params).toContain(BUSINESS_A);
    }
  });
});

describe('GET /api/warehouses/[id]/branches', () => {
  it("does not reveal another business's warehouse links", async () => {
    const res = await linksGet(
      new NextRequest(`http://localhost/api/warehouses/${WAREHOUSE_B}/branches`, { headers: sessionA }),
      { params: { id: WAREHOUSE_B } },
    );
    expect(res.status).toBe(404);
    expect(mockQueryRows.mock.calls.some(([sql]) => /FROM branch_warehouses/i.test(String(sql)))).toBe(false);
  });
});

describe('PATCH /api/warehouses/[id]', () => {
  it("refuses a branch_id that belongs to another business", async () => {
    const res = await warehousePatch(
      new NextRequest(`http://localhost/api/warehouses/${WAREHOUSE_A}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...sessionA },
        body: JSON.stringify({ branch_id: BRANCH_B1 }),
      }),
      { params: { id: WAREHOUSE_A } },
    );
    expect(res.status).toBe(400);
    expect(mutations()).toEqual([]);
    expect(mockQueryOne.mock.calls.some(([sql]) => /UPDATE warehouses/i.test(String(sql)))).toBe(false);
  });

  it('accepts an owned branch_id', async () => {
    const res = await warehousePatch(
      new NextRequest(`http://localhost/api/warehouses/${WAREHOUSE_A}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...sessionA },
        body: JSON.stringify({ branch_id: BRANCH_A1 }),
      }),
      { params: { id: WAREHOUSE_A } },
    );
    expect(res.status).toBe(200);
  });
});
