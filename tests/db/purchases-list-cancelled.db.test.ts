/**
 * Real-PostgreSQL tests for GET /api/purchases: cancelled bills are listed (status 'cancelled')
 * under the same tenant / branch / soft-delete filters as every other bill, while the payment
 * and aging filters, days_overdue and the UI totals never count them. Runs only when
 * PHASE2_TEST_DATABASE_URL points at a disposable database. PBAC, the platform-module gate and
 * branch access are stubbed; the SQL runs against the database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/security/require-platform-module', () => ({
  requirePlatformModule: jest.fn().mockResolvedValue(undefined),
  platformModuleErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/branch-access', () => ({ getUserAccessibleBranchIds: jest.fn() }));
jest.mock('@/lib/permissions', () => ({ checkUserPermission: jest.fn() }));

import { getPool, closePool } from '@/lib/db';
import { getUserAccessibleBranchIds } from '@/lib/branch-access';
import { checkUserPermission } from '@/lib/permissions';
import { GET as listPurchases } from '@/app/api/purchases/route';
import { computePurchaseTotals } from '@/lib/accounting-ui/purchase-actions';

const branchAccessMock = getUserAccessibleBranchIds as jest.Mock;
const permissionMock = checkUserPermission as jest.Mock;

d('GET /api/purchases lists cancelled bills (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const FOREIGN = randomUUID();
  const BR = randomUUID();
  const BR2 = randomUUID();
  const FBR = randomUUID();
  const U = randomUUID();
  const SUPP = randomUUID();
  const FSUPP = randomUUID();
  const tag = B.slice(0, 8);

  const ids = {
    draft: randomUUID(),
    open: randomUUID(),
    paid: randomUUID(),
    cancelledUnpaid: randomUUID(),
    cancelledPaidOtherBranch: randomUUID(),
    cancelledDeleted: randomUUID(),
    foreignCancelled: randomUUID(),
  };

  async function insertPurchase(p: {
    id: string;
    business: string;
    branch: string;
    supplier: string;
    status: string;
    paymentStatus: string;
    grand: number;
    paid: number;
    deleted?: boolean;
  }) {
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, deleted_at)
       VALUES ($1, $2, $3, $4, CURRENT_DATE - 45, $5, '27', false, true, $6, 0, 0, 0, 0, $6, $7, $8, $9, $10, $11)`,
      [
        p.id,
        p.business,
        p.supplier,
        `LC-${tag}-${p.id.slice(0, 6)}`,
        p.status,
        p.grand,
        p.paid,
        p.status === 'cancelled' ? 0 : p.grand - p.paid,
        p.paymentStatus,
        p.branch,
        p.deleted ? new Date() : null,
      ]
    );
  }

  /** Session identity comes from the middleware headers; the query business_id is a spoof attempt. */
  async function list(params: Record<string, string> = {}) {
    const qs = new URLSearchParams({ business_id: FOREIGN, limit: '50', ...params });
    const res = await listPurchases(
      new NextRequest(`http://localhost/api/purchases?${qs}`, {
        headers: { 'x-authenticated-user-id': U, 'x-authenticated-business-id': B },
      })
    );
    const json = (await res.json()) as any;
    return { status: res.status, json, rows: (json.purchases || []) as any[] };
  }
  const idsOf = (rows: any[]) => rows.map((r) => r.id).sort();

  beforeAll(async () => {
    pool = getPool();
    for (const [biz, name] of [
      [B, `List ${tag}`],
      [FOREIGN, `Foreign ${tag}`],
    ]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, name]
      );
    }
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $3, 'Main', '27', true, true, true), ($2, $3, 'Second', '27', false, false, true),
              ($4, $5, 'Foreign main', '27', true, true, true)`,
      [BR, BR2, B, FBR, FOREIGN]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk', $3, false)`,
      [U, B, `95${Date.now().toString().slice(-8)}`]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, current_balance)
       VALUES ($1, $2, 'List Supplier', '27', 0), ($3, $4, 'Foreign Supplier', '27', 0)`,
      [SUPP, B, FSUPP, FOREIGN]
    );

    const base = { business: B, branch: BR, supplier: SUPP };
    await insertPurchase({ ...base, id: ids.draft, status: 'draft', paymentStatus: 'unpaid', grand: 200, paid: 0 });
    await insertPurchase({ ...base, id: ids.open, status: 'final', paymentStatus: 'unpaid', grand: 1000, paid: 0 });
    await insertPurchase({ ...base, id: ids.paid, status: 'final', paymentStatus: 'paid', grand: 500, paid: 500 });
    // Cancel keeps the last payment_status, so these rows look "unpaid" / "paid" to a naive filter.
    await insertPurchase({ ...base, id: ids.cancelledUnpaid, status: 'cancelled', paymentStatus: 'unpaid', grand: 9000, paid: 0 });
    await insertPurchase({
      ...base,
      branch: BR2,
      id: ids.cancelledPaidOtherBranch,
      status: 'cancelled',
      paymentStatus: 'paid',
      grand: 700,
      paid: 0,
    });
    await insertPurchase({
      ...base,
      id: ids.cancelledDeleted,
      status: 'cancelled',
      paymentStatus: 'unpaid',
      grand: 300,
      paid: 0,
      deleted: true,
    });
    await insertPurchase({
      business: FOREIGN,
      branch: FBR,
      supplier: FSUPP,
      id: ids.foreignCancelled,
      status: 'cancelled',
      paymentStatus: 'unpaid',
      grand: 400,
      paid: 0,
    });
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM purchases WHERE business_id = ANY($1::uuid[])`, [[B, FOREIGN]]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, FOREIGN]]);
    } finally {
      await closePool();
    }
  });

  beforeEach(() => {
    permissionMock.mockReset().mockResolvedValue(true);
    branchAccessMock.mockReset().mockResolvedValue([BR, BR2]);
  });

  test('status=all includes cancelled bills with status "cancelled", tenant-scoped, soft-deletes excluded', async () => {
    const { status, json, rows } = await list();
    expect(status).toBe(200);
    expect(idsOf(rows)).toEqual(
      [ids.draft, ids.open, ids.paid, ids.cancelledUnpaid, ids.cancelledPaidOtherBranch].sort()
    );
    expect(Number(json.pagination.total)).toBe(5);
    const cancelled = rows.filter((r) => r.status === 'cancelled').map((r) => r.id).sort();
    expect(cancelled).toEqual([ids.cancelledUnpaid, ids.cancelledPaidOtherBranch].sort());
    expect(idsOf(rows)).not.toContain(ids.foreignCancelled);
    expect(idsOf(rows)).not.toContain(ids.cancelledDeleted);
  });

  test('status=cancelled returns only cancelled bills', async () => {
    const { rows } = await list({ status: 'cancelled' });
    expect(idsOf(rows)).toEqual([ids.cancelledUnpaid, ids.cancelledPaidOtherBranch].sort());
  });

  test('non-admin branch filter still applies to cancelled bills', async () => {
    permissionMock.mockResolvedValue(false);
    branchAccessMock.mockResolvedValue([BR]);
    const { rows } = await list();
    expect(idsOf(rows)).toEqual([ids.draft, ids.open, ids.paid, ids.cancelledUnpaid].sort());
    expect(idsOf(rows)).not.toContain(ids.cancelledPaidOtherBranch);
  });

  test('explicit branch_id filter still applies to cancelled bills', async () => {
    const { rows } = await list({ branch_id: BR2 });
    expect(idsOf(rows)).toEqual([ids.cancelledPaidOtherBranch]);
  });

  test('unpaid and paid filters exclude cancelled bills even with a stale payment_status', async () => {
    expect(idsOf((await list({ status: 'unpaid' })).rows)).toEqual([ids.draft, ids.open].sort());
    expect(idsOf((await list({ status: 'paid' })).rows)).toEqual([ids.paid]);
  });

  test('aging filter and days_overdue ignore cancelled bills', async () => {
    const aged = await list({ aging_days_min: '0', aging_days_max: '100000' });
    expect(aged.rows.every((r) => r.status !== 'cancelled')).toBe(true);
    expect(idsOf(aged.rows)).toEqual([ids.draft, ids.open, ids.paid].sort());

    const { rows } = await list();
    for (const r of rows.filter((x) => x.status === 'cancelled')) expect(Number(r.days_overdue)).toBe(0);
    expect(Number(rows.find((r) => r.id === ids.open).days_overdue)).toBeGreaterThan(0);
  });

  test('UI totals over the listed rows exclude cancelled bills', async () => {
    const { rows } = await list();
    expect(computePurchaseTotals(rows)).toEqual({ total: 1700, paid: 500, due: 1200 });
  });
});
