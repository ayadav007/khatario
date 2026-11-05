/**
 * Real-PostgreSQL regression tests for the expense voucher, voucher PDF and attachment routes
 * (security review R1, R4a). Handlers, authorize(), RBAC and SQL run against kh_phase2_test;
 * only plan/subscription gates and the PDF browser are stubbed.
 */
import {
  SECURITY_DB_URL,
  pointLibDbAtTestDatabase,
  seedBusiness,
  seedEmployee,
  seedExpense,
  grantRole,
  cleanupSeeded,
  sessionHeaders,
  headerBag,
  type SeededBusiness,
} from './helpers/security-db';

pointLibDbAtTestDatabase();

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __securityHeaders: { current: Record<string, string> } }).__securityHeaders.current[
        name.toLowerCase()
      ] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'plan' }, { status: 402 });
    }
  }
  class SupplierHubHiddenError extends Error {}
  return {
    assertFeatureAccess: jest.fn(async () => undefined),
    assertModuleAccess: jest.fn(async () => undefined),
    denyIfFeatureMissing: jest.fn(async () => null),
    FeatureAccessDeniedError,
    SupplierHubHiddenError,
  };
});
jest.mock('@/lib/supplier-hub-visibility', () => ({ isSupplierHubVisible: jest.fn(async () => true) }));
// lib/jwt pulls in the ESM-only `jose`; authorize() uses it only to clear cookies (as in phase3a).
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/print-branding', () => ({ maybeAppendKhatarioPrintFooter: jest.fn(async (html: string) => html) }));
const mockLaunch = jest.fn();
jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: (...a: unknown[]) => mockLaunch(...a) } }));
const mockPortal = jest.fn();
jest.mock('@/lib/employee-portal/session', () => ({
  getEmployeePortalSessionFromRequest: (...a: unknown[]) => mockPortal(...a),
}));

import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const d = SECURITY_DB_URL ? describe : describe.skip;

d('expense voucher and attachments (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  let A: SeededBusiness;
  let B: SeededBusiness;
  let expenseAOwnerless: string; // expense of staff A (not of the owner)
  let expenseAStaff: string;
  let expenseB: string;
  let staffA2: string;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const routes = () => ({
    voucher: require('@/app/api/employees/expenses/[id]/voucher/route').GET,
    pdf: require('@/app/api/employees/expenses/[id]/voucher/pdf/route').GET,
    attachments: require('@/app/api/employees/expenses/[id]/attachments/route'),
  });

  function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
    headerBag.current = init.headers ?? {};
    return new NextRequest(`http://localhost${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/db');
    pool = getPool();
    A = await seedBusiness(pool, 'A');
    B = await seedBusiness(pool, 'B');
    await seedEmployee(pool, A.staffId, A.businessId);
    await seedEmployee(pool, B.staffId, B.businessId);
    // A second restricted employee in A, with an expense of their own.
    const second = await seedBusiness(pool, 'A2-helper');
    staffA2 = second.staffId;
    await pool.query(`UPDATE users SET business_id = $1 WHERE id = $2`, [A.businessId, staffA2]);
    await seedEmployee(pool, staffA2, A.businessId);
    expenseAStaff = await seedExpense(pool, A.staffId, 'Taxi A');
    expenseAOwnerless = await seedExpense(pool, staffA2, 'Hotel A2');
    expenseB = await seedExpense(pool, B.staffId, 'Taxi B');
  });

  afterAll(async () => {
    await cleanupSeeded(pool);
    const { closePool } = await import('@/lib/db');
    await closePool?.();
  });

  beforeEach(() => {
    mockPortal.mockReset().mockResolvedValue(null);
    mockLaunch.mockReset().mockResolvedValue({
      newPage: async () => ({ setContent: async () => undefined, pdf: async () => Buffer.from('%PDF') }),
      close: async () => undefined,
    });
  });

  const attachmentCount = async (expenseId: string) =>
    Number((await pool.query(`SELECT count(*) FROM expense_attachments WHERE expense_id = $1`, [expenseId])).rows[0].count);

  it('R1: the owner can open a voucher of their own business (the query runs on the real schema)', async () => {
    const res = await routes().voucher(req(`/api/employees/expenses/${expenseAStaff}/voucher`, { headers: sessionHeaders(A.ownerId, A.businessId) }), {
      params: { id: expenseAStaff },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.html).toBe('string');
  });

  it('R1: the owner can download the PDF and list attachments', async () => {
    const pdf = await routes().pdf(req(`/api/employees/expenses/${expenseAStaff}/voucher/pdf`, { headers: sessionHeaders(A.ownerId, A.businessId) }), {
      params: { id: expenseAStaff },
    });
    expect(pdf.status).toBe(200);
    const list = await routes().attachments.GET(
      req(`/api/employees/expenses/${expenseAStaff}/attachments`, { headers: sessionHeaders(A.ownerId, A.businessId) }),
      { params: { id: expenseAStaff } },
    );
    expect(list.status).toBe(200);
  });

  it("business A's owner cannot open, list or attach to business B's expense", async () => {
    const h = sessionHeaders(A.ownerId, A.businessId);
    const v = await routes().voucher(req(`/api/employees/expenses/${expenseB}/voucher`, { headers: h }), { params: { id: expenseB } });
    expect(v.status).toBe(404);
    const l = await routes().attachments.GET(req(`/api/employees/expenses/${expenseB}/attachments`, { headers: h }), { params: { id: expenseB } });
    expect(l.status).toBe(404);
    const before = await attachmentCount(expenseB);
    const p = await routes().attachments.POST(
      req(`/api/employees/expenses/${expenseB}/attachments`, {
        method: 'POST',
        headers: h,
        body: { file_name: 'x.pdf', file_url: 'https://evil.example/x.pdf' },
      }),
      { params: { id: expenseB } },
    );
    expect(p.status).toBe(404);
    expect(await attachmentCount(expenseB)).toBe(before);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('R4a: restricted staff can open their own expense voucher and attach a receipt', async () => {
    const h = sessionHeaders(A.staffId, A.businessId);
    const v = await routes().voucher(req(`/api/employees/expenses/${expenseAStaff}/voucher`, { headers: h }), { params: { id: expenseAStaff } });
    expect(v.status).toBe(200);
    const before = await attachmentCount(expenseAStaff);
    const p = await routes().attachments.POST(
      req(`/api/employees/expenses/${expenseAStaff}/attachments`, {
        method: 'POST',
        headers: h,
        body: { file_name: 'r.jpg', file_url: 'https://cdn.example/r.jpg' },
      }),
      { params: { id: expenseAStaff } },
    );
    expect(p.status).toBe(201);
    expect(await attachmentCount(expenseAStaff)).toBe(before + 1);
  });

  it("restricted staff cannot open or attach to a colleague's expense", async () => {
    const h = sessionHeaders(A.staffId, A.businessId);
    const v = await routes().voucher(req(`/api/employees/expenses/${expenseAOwnerless}/voucher`, { headers: h }), {
      params: { id: expenseAOwnerless },
    });
    expect(v.status).toBe(403);
    const before = await attachmentCount(expenseAOwnerless);
    const p = await routes().attachments.POST(
      req(`/api/employees/expenses/${expenseAOwnerless}/attachments`, {
        method: 'POST',
        headers: h,
        body: { file_name: 'x.jpg', file_url: 'https://cdn.example/x.jpg' },
      }),
      { params: { id: expenseAOwnerless } },
    );
    expect(p.status).toBe(403);
    expect(await attachmentCount(expenseAOwnerless)).toBe(before);
  });

  it("a staff member granted expenses read can open a colleague's voucher", async () => {
    await grantRole(pool, A.staffRoleId, 'expenses', { view: true });
    try {
      const v = await routes().voucher(
        req(`/api/employees/expenses/${expenseAOwnerless}/voucher`, { headers: sessionHeaders(A.staffId, A.businessId) }),
        { params: { id: expenseAOwnerless } },
      );
      expect(v.status).toBe(200);
    } finally {
      await pool.query(`DELETE FROM role_permissions WHERE role_id = $1 AND module_key = 'expenses'`, [A.staffRoleId]);
    }
  });

  it('a fabricated portal cookie with no session gets 401 and no database row is read', async () => {
    const v = await routes().voucher(req(`/api/employees/expenses/${expenseAStaff}/voucher`, { headers: { 'x-employee-portal-session': '1' } }), {
      params: { id: expenseAStaff },
    });
    expect(v.status).toBe(401);
    const p = await routes().pdf(req(`/api/employees/expenses/${expenseAStaff}/voucher/pdf`), { params: { id: expenseAStaff } });
    expect(p.status).toBe(401);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('a validated portal session reaches its own expense only', async () => {
    mockPortal.mockResolvedValue({ employee_id: A.staffId, business_id: A.businessId });
    const own = await routes().voucher(req(`/api/employees/expenses/${expenseAStaff}/voucher`, { headers: { 'x-employee-portal-session': '1' } }), {
      params: { id: expenseAStaff },
    });
    expect(own.status).toBe(200);
    const other = await routes().voucher(
      req(`/api/employees/expenses/${expenseAOwnerless}/voucher`, { headers: { 'x-employee-portal-session': '1' } }),
      { params: { id: expenseAOwnerless } },
    );
    expect(other.status).toBe(403);
    const foreign = await routes().voucher(req(`/api/employees/expenses/${expenseB}/voucher`, { headers: { 'x-employee-portal-session': '1' } }), {
      params: { id: expenseB },
    });
    expect(foreign.status).toBe(404);
  });
});
