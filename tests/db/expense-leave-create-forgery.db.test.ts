/**
 * Real-PostgreSQL regression tests for security review R2: expense-claim and leave-request
 * creation must never take the employee or business from the request body when no business
 * session or database-validated portal session exists, and a session in business A must not
 * create records for business B by naming B's ids in the body.
 */
import {
  SECURITY_DB_URL,
  pointLibDbAtTestDatabase,
  seedBusiness,
  seedEmployee,
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
jest.mock('@/lib/subscription/limit-response', () => ({ limitExceededResponse: jest.fn(async () => null) }));
jest.mock('@/lib/supplier-hub-visibility', () => ({ isSupplierHubVisible: jest.fn(async () => true) }));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
// Portal plan gate (plan catalogue rows); identity and tenancy stay real.
jest.mock('@/lib/employee-portal/feature-gates', () => ({ assertEmployeePortalFeature: jest.fn(async () => undefined) }));
const mockPortal = jest.fn();
jest.mock('@/lib/employee-portal/session', () => ({
  getEmployeePortalSessionFromRequest: (...a: unknown[]) => mockPortal(...a),
}));

import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

const d = SECURITY_DB_URL ? describe : describe.skip;

d('expense and leave creation cannot be forged (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  let A: SeededBusiness;
  let B: SeededBusiness;
  let leaveTypeB: string;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const expenses = () => require('@/app/api/employees/expenses/route');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const leaves = () => require('@/app/api/employees/leave-requests/route');

  function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    headerBag.current = headers;
    return new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  const expenseCount = async (employeeId: string) =>
    Number((await pool.query(`SELECT count(*) FROM employee_expenses WHERE employee_id = $1`, [employeeId])).rows[0].count);
  const leaveCount = async (employeeId: string) =>
    Number((await pool.query(`SELECT count(*) FROM leave_requests WHERE employee_id = $1`, [employeeId])).rows[0].count);

  const claim = (business: SeededBusiness, employeeId: string) => ({
    business_id: business.businessId,
    employee_id: employeeId,
    expense_date: '2026-10-02',
    amount: 750,
    description: 'Forged claim',
  });
  const leave = (business: SeededBusiness, employeeId: string) => ({
    business_id: business.businessId,
    employee_id: employeeId,
    leave_type_id: leaveTypeB,
    start_date: '2026-11-10',
    end_date: '2026-11-10',
    reason: 'Forged leave',
  });

  beforeAll(async () => {
    const { getPool } = await import('@/lib/db');
    pool = getPool();
    A = await seedBusiness(pool, 'A');
    B = await seedBusiness(pool, 'B');
    await seedEmployee(pool, A.staffId, A.businessId);
    await seedEmployee(pool, B.staffId, B.businessId);
    leaveTypeB = randomUUID();
    await pool.query(
      `INSERT INTO leave_types (id, business_id, leave_code, leave_name) VALUES ($1, $2, 'CL', 'Casual')`,
      [leaveTypeB, B.businessId],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM leave_requests WHERE employee_id = ANY($1::uuid[])`, [[A.staffId, B.staffId]]);
    await pool.query(`DELETE FROM leave_types WHERE id = $1`, [leaveTypeB]);
    await cleanupSeeded(pool);
    const { closePool } = await import('@/lib/db');
    await closePool();
  });

  beforeEach(() => mockPortal.mockReset().mockResolvedValue(null));

  describe('no session at all (fabricated portal cookie)', () => {
    it('an expense claim naming business B and its employee is refused and nothing is written', async () => {
      const before = await expenseCount(B.staffId);
      const res = await expenses().POST(post('/api/employees/expenses', claim(B, B.staffId), { 'x-employee-portal-session': '1' }));
      expect(res.status).toBe(401);
      expect(await expenseCount(B.staffId)).toBe(before);
    });

    it('a leave request naming business B and its employee is refused and nothing is written', async () => {
      const before = await leaveCount(B.staffId);
      const res = await leaves().POST(post('/api/employees/leave-requests', leave(B, B.staffId), { 'x-employee-portal-session': '1' }));
      expect(res.status).toBe(401);
      expect(await leaveCount(B.staffId)).toBe(before);
    });

    it('the same requests without any portal header are refused too', async () => {
      const e = await expenses().POST(post('/api/employees/expenses', claim(B, B.staffId)));
      expect(e.status).toBe(401);
      const l = await leaves().POST(post('/api/employees/leave-requests', leave(B, B.staffId)));
      expect(l.status).toBe(401);
    });
  });

  describe("a session in business A naming business B's ids", () => {
    it("A's owner cannot file an expense for B's employee", async () => {
      const before = await expenseCount(B.staffId);
      const res = await expenses().POST(post('/api/employees/expenses', claim(B, B.staffId), sessionHeaders(A.ownerId, A.businessId)));
      expect([403, 404]).toContain(res.status);
      expect(await expenseCount(B.staffId)).toBe(before);
    });

    it("A's restricted staff cannot file an expense for B's employee", async () => {
      const before = await expenseCount(B.staffId);
      const res = await expenses().POST(post('/api/employees/expenses', claim(B, B.staffId), sessionHeaders(A.staffId, A.businessId)));
      expect([403, 404]).toContain(res.status);
      expect(await expenseCount(B.staffId)).toBe(before);
    });

    it("A's owner cannot file leave for B's employee", async () => {
      const before = await leaveCount(B.staffId);
      const res = await leaves().POST(post('/api/employees/leave-requests', leave(B, B.staffId), sessionHeaders(A.ownerId, A.businessId)));
      expect([403, 404]).toContain(res.status);
      expect(await leaveCount(B.staffId)).toBe(before);
    });

    it("a validated portal session of A's employee cannot file for B's employee", async () => {
      mockPortal.mockResolvedValue({ employee_id: A.staffId, business_id: A.businessId });
      const beforeB = await expenseCount(B.staffId);
      const res = await expenses().POST(post('/api/employees/expenses', claim(B, B.staffId), { 'x-employee-portal-session': '1' }));
      // The portal actor's own employee id and business replace the body; nothing is written for B.
      expect(await expenseCount(B.staffId)).toBe(beforeB);
      expect([201, 402, 403, 404]).toContain(res.status);
    });
  });

  describe('legitimate self-service still works', () => {
    it('restricted staff files their own expense claim in their own business', async () => {
      const before = await expenseCount(A.staffId);
      const res = await expenses().POST(post('/api/employees/expenses', claim(A, A.staffId), sessionHeaders(A.staffId, A.businessId)));
      expect(res.status).toBe(201);
      expect(await expenseCount(A.staffId)).toBe(before + 1);
    });

    it("restricted staff cannot file a claim for a colleague without the expenses permission", async () => {
      const before = await expenseCount(A.ownerId);
      await pool.query(
        `INSERT INTO employees (id, business_id, employee_code, is_active) VALUES ($1, $2, $3, true) ON CONFLICT (id) DO NOTHING`,
        [A.ownerId, A.businessId, `E-${A.ownerId.slice(0, 8)}`],
      );
      const res = await expenses().POST(post('/api/employees/expenses', claim(A, A.ownerId), sessionHeaders(A.staffId, A.businessId)));
      expect(res.status).toBe(403);
      expect(await expenseCount(A.ownerId)).toBe(before);
    });
  });
});
