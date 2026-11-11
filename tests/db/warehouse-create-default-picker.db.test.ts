/**
 * Real-PostgreSQL regression tests for security review R3.
 *
 * - POST /api/warehouses must not accept another business's branch (authorize() returns early for
 *   a business owner before its branch check, so the route has to check ownership itself).
 * - Both default-warehouse pickers (the SQL function from migration 465 and the warehouse-mode
 *   switch's defaultWarehouseForBranch) must never return a warehouse of another business, even
 *   when a cross-business branch_warehouses row exists from before the fix.
 * - Warehouse reads must not reveal another business's branch name through such a row.
 * - The SQL function picks deterministically when a branch has several primary warehouses.
 */
import fs from 'fs';
import path from 'path';
import {
  SECURITY_DB_URL,
  pointLibDbAtTestDatabase,
  seedBusiness,
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
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));

import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

const d = SECURITY_DB_URL ? describe : describe.skip;
const migration465 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/465_default_warehouse_same_business.sql'),
  'utf8',
);

d('warehouse create and default-warehouse pickers (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  let A: SeededBusiness;
  let B: SeededBusiness;
  let warehouseB: string;
  let plantedA: string;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const warehousesRoute = () => require('@/app/api/warehouses/route');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const warehouseIdRoute = () => require('@/app/api/warehouses/[id]/route');

  function request(pathname: string, method: string, headers: Record<string, string>, body?: unknown) {
    headerBag.current = headers;
    return new NextRequest(`http://localhost${pathname}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function insertWarehouse(businessId: string, name: string, branchId: string | null, createdAt: string) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO warehouses (id, business_id, name, branch_id, is_active, created_at) VALUES ($1, $2, $3, $4, true, $5)`,
      [id, businessId, name, branchId, createdAt],
    );
    return id;
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/db');
    pool = getPool();
    // Apply the migration file under test (CREATE OR REPLACE, idempotent).
    await pool.query(migration465);
    A = await seedBusiness(pool, 'A');
    B = await seedBusiness(pool, 'B');
    // B's own warehouse for its branch, created later than A's planted one.
    warehouseB = await insertWarehouse(B.businessId, 'B main', B.branchId, '2026-06-01');
    await pool.query(`INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary) VALUES ($1, $2, true)`, [B.branchId, warehouseB]);
    // A cross-business row as it could exist from before the fix: A's older warehouse marked primary for B's branch.
    plantedA = await insertWarehouse(A.businessId, 'A planted', null, '2026-01-01');
    await pool.query(`INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary) VALUES ($1, $2, true)`, [B.branchId, plantedA]);
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM branch_warehouses WHERE branch_id = ANY($1::uuid[]) OR warehouse_id IN (SELECT id FROM warehouses WHERE business_id = ANY($2::uuid[]))`,
      [[A.branchId, B.branchId], [A.businessId, B.businessId]],
    );
    await pool.query(`DELETE FROM warehouses WHERE business_id = ANY($1::uuid[])`, [[A.businessId, B.businessId]]);
    await cleanupSeeded(pool);
    const { closePool } = await import('@/lib/db');
    await closePool();
  });

  describe('POST /api/warehouses', () => {
    it("A's owner cannot create a warehouse on B's branch, and nothing is written", async () => {
      const name = `Forged ${randomUUID().slice(0, 6)}`;
      const res = await warehousesRoute().POST(
        request('/api/warehouses', 'POST', sessionHeaders(A.ownerId, A.businessId), { name, branch_id: B.branchId }),
      );
      expect(res.status).toBe(400);
      const created = await pool.query(`SELECT id FROM warehouses WHERE name = $1`, [name]);
      expect(created.rowCount).toBe(0);
      const links = await pool.query(
        `SELECT 1 FROM branch_warehouses bw JOIN warehouses w ON w.id = bw.warehouse_id
          WHERE bw.branch_id = $1 AND w.business_id = $2 AND w.name = $3`,
        [B.branchId, A.businessId, name],
      );
      expect(links.rowCount).toBe(0);
    });

    it("A's owner cannot pass B's business_id in the body to create inside B", async () => {
      const name = `Cross ${randomUUID().slice(0, 6)}`;
      const res = await warehousesRoute().POST(
        request('/api/warehouses', 'POST', sessionHeaders(A.ownerId, A.businessId), { name, business_id: B.businessId }),
      );
      expect(res.status).toBe(201);
      const row = await pool.query<{ business_id: string }>(`SELECT business_id FROM warehouses WHERE name = $1`, [name]);
      expect(row.rows[0].business_id).toBe(A.businessId);
    });

    it('creating a warehouse on an own branch still works and links it', async () => {
      const name = `Own ${randomUUID().slice(0, 6)}`;
      const res = await warehousesRoute().POST(
        request('/api/warehouses', 'POST', sessionHeaders(A.ownerId, A.businessId), { name, branch_id: A.branchId }),
      );
      expect(res.status).toBe(201);
      const { warehouse } = await res.json();
      const link = await pool.query(`SELECT is_primary FROM branch_warehouses WHERE branch_id = $1 AND warehouse_id = $2`, [A.branchId, warehouse.id]);
      expect(link.rows[0]?.is_primary).toBe(true);
    });

    it('a malformed branch id is a 400, not a 500', async () => {
      const res = await warehousesRoute().POST(
        request('/api/warehouses', 'POST', sessionHeaders(A.ownerId, A.businessId), { name: `Bad ${randomUUID().slice(0, 6)}`, branch_id: 'not-a-uuid' }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('default-warehouse pickers ignore a cross-business link', () => {
    it("the SQL function returns B's own warehouse for B's branch, never A's", async () => {
      const r = await pool.query<{ id: string }>(`SELECT get_default_warehouse_for_branch($1) AS id`, [B.branchId]);
      expect(r.rows[0].id).toBe(warehouseB);
    });

    it("the warehouse-mode switch picker returns B's own warehouse, never A's", async () => {
      const { defaultWarehouseForBranch } = await import('@/lib/inventory/warehouse-mode-switch');
      const client = await pool.connect();
      try {
        expect(await defaultWarehouseForBranch(client, B.branchId)).toBe(warehouseB);
      } finally {
        client.release();
      }
    });

    it('the SQL function picks the oldest primary warehouse when a branch has several', async () => {
      const older = await insertWarehouse(A.businessId, 'A old primary', A.branchId, '2025-01-01');
      const newer = await insertWarehouse(A.businessId, 'A new primary', A.branchId, '2026-09-01');
      await pool.query(
        `INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary) VALUES ($1, $3, true), ($1, $2, true)`,
        [A.branchId, older, newer],
      );
      for (let i = 0; i < 5; i += 1) {
        const r = await pool.query<{ id: string }>(`SELECT get_default_warehouse_for_branch($1) AS id`, [A.branchId]);
        expect(r.rows[0].id).toBe(older);
      }
    });
  });

  describe('reads do not reveal another business through such a link', () => {
    it("B's warehouse list shows no branch name of A, and A's planted warehouse is not listed for B", async () => {
      const res = await warehousesRoute().GET(
        request(`/api/warehouses?branch_id=${B.branchId}`, 'GET', sessionHeaders(B.ownerId, B.businessId)),
      );
      expect(res.status).toBe(200);
      const { warehouses } = await res.json();
      const ids = (warehouses as Array<{ id: string }>).map((w) => w.id);
      expect(ids).toContain(warehouseB);
      expect(ids).not.toContain(plantedA);
    });

    it("a warehouse of A whose branch_id points at B's branch does not show B's branch name", async () => {
      await pool.query(`UPDATE warehouses SET branch_id = $1 WHERE id = $2`, [B.branchId, plantedA]);
      const res = await warehouseIdRoute().GET(
        request(`/api/warehouses/${plantedA}`, 'GET', sessionHeaders(A.ownerId, A.businessId)),
        { params: { id: plantedA } },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const warehouse = body.warehouse ?? body;
      expect(warehouse.branch_name ?? null).toBeNull();
      const list = await warehousesRoute().GET(request('/api/warehouses', 'GET', sessionHeaders(A.ownerId, A.businessId)));
      const rows = (await list.json()).warehouses as Array<{ id: string; branch_name: string | null }>;
      expect(rows.find((w) => w.id === plantedA)?.branch_name ?? null).toBeNull();
    });
  });
});
