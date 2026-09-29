/**
 * Real-PostgreSQL tests for Phase 2.7: purchase delete, purchase cancel and payment creation take
 * the acting user only from the session identity that middleware sets (`x-authenticated-user-id`,
 * stripped from client requests). Body / query / custom-header user ids must never authorize or
 * be recorded. Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database (with
 * migrations 323-325). PBAC `authorize` is stubbed with a per-user allow list so the test can
 * prove which identity was checked; everything else runs against the database.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/security/premium-module-api', () => ({
  withPremiumSubscriptionApi:
    (opts: { parseJsonBody?: boolean }, handler: (ctx: unknown) => Promise<unknown>) =>
    async (request: Request, ctx?: { params?: Record<string, string> }) => {
      const body = opts?.parseJsonBody ? await request.json().catch(() => ({})) : undefined;
      return handler({
        request,
        body,
        businessId: request.headers.get('x-authenticated-business-id'),
        userId: request.headers.get('x-authenticated-user-id'),
        params: ctx?.params ?? {},
      });
    },
}));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn(),
}));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/soft-delete-entitlements', () => ({
  shouldUseSoftDelete: jest.fn().mockResolvedValue(true),
}));

import { getPool, closePool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess } from '@/lib/enforce-access';
import { createPurchaseLedgerEntries } from '@/lib/ledger-utils';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { listRule37Exposure, syncRule37ForBill, RULE37_REVERSAL } from '@/lib/gst/rule37';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postPayment } from '@/app/api/payments/route';
import { POST as postTdsDeduct } from '@/app/api/tds/deduct/route';
import { DELETE as deletePurchase } from '@/app/api/purchases/[id]/route';
import { POST as cancelPurchaseRoute } from '@/app/api/purchases/[id]/cancel/route';

const migration325 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/325_tds_transaction_status.sql'),
  'utf8'
);

type Line = { id: string; code: string; dr: number; cr: number; reversed: boolean; is_reversal: boolean };
const r2 = (n: number) => Math.round(n * 100) / 100;
const authorizeMock = authorize as jest.Mock;
const enforceAccessMock = enforceAccess as jest.Mock;

d('Phase 2.7 accounting mutation identity (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  /** A: the authenticated caller. */
  const A = randomUUID();
  /** OTHER: a real user (the primary admin) whose id an attacker puts in the body. */
  const OTHER = randomUUID();
  const SUPP = randomUUID();
  const ITEM = randomUUID();
  const CAT = randomUUID();
  const tag = B.slice(0, 8);

  /** PBAC stub: only the listed users are allowed. */
  const allowOnly = (...users: string[]) =>
    authorizeMock.mockImplementation(async (userId: string) => {
      if (!users.includes(userId)) throw new AuthorizationError('Not allowed', 'FORBIDDEN');
    });
  const authorizedUsers = () => authorizeMock.mock.calls.map((c) => c[0]);

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /**
   * `session` is the middleware identity. Every request also carries the spoofing attempts the
   * routes must ignore: OTHER in the query string and in a caller-supplied `x-user-id` header.
   */
  const req = (p: string, method: string, body: unknown, session: string | null) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-user-id': OTHER };
    if (session) {
      headers['x-authenticated-user-id'] = session;
      headers['x-authenticated-business-id'] = B;
    }
    const sep = p.includes('?') ? '&' : '?';
    return new NextRequest(`http://localhost${p}${sep}user_id=${OTHER}&userId=${OTHER}&business_id=${B}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
  };
  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    return { status: r.status, json: (await r.json()) as any };
  };
  const spoofBody = { user_id: OTHER, userId: OTHER, created_by: OTHER, deleted_by: OTHER, cancelled_by: OTHER, business_id: B };

  async function lines(type: string, id: string): Promise<Line[]> {
    return (
      await pool.query<Line>(
        `SELECT l.id, a.account_code AS code, l.debit::float8 AS dr, l.credit::float8 AS cr,
                EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.original_line_id = l.id) AS reversed,
                EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.reversal_line_id = l.id) AS is_reversal
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_type = $2 AND l.voucher_id = $3
          ORDER BY l.created_at, l.id`,
        [B, type, id]
      )
    ).rows;
  }
  const net = (rows: Line[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.code] = r2((m[r.code] || 0) + r.dr - r.cr);
    for (const k of Object.keys(m)) if (m[k] === 0) delete m[k];
    return m;
  };
  const active = (rows: Line[]) => rows.filter((r) => !r.reversed && !r.is_reversal);
  function expectFullyReversed(rows: Line[]) {
    expect(rows.length).toBeGreaterThan(0);
    expect(active(rows)).toHaveLength(0);
    expect(net(rows)).toEqual({});
  }
  /** Distinct created_by on the reversal links of a voucher. */
  const reversalActors = async (type: string, id: string) =>
    (
      await pool.query(
        `SELECT DISTINCT created_by FROM ledger_entry_reversals WHERE business_id = $1 AND voucher_type = $2 AND voucher_id = $3`,
        [B, type, id]
      )
    ).rows.map((r) => r.created_by);

  const supplierBalance = async () =>
    Number((await pool.query(`SELECT current_balance FROM suppliers WHERE id = $1`, [SUPP])).rows[0].current_balance);
  const paymentCount = async () =>
    Number((await pool.query(`SELECT COUNT(*) AS n FROM payments WHERE business_id = $1`, [B])).rows[0].n);

  async function makeDraftPurchase(taxable: number, date: string) {
    const id = randomUUID();
    const half = r2(taxable * 0.09);
    const grand = r2(taxable + 2 * half);
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, $5, 'draft', '27', false, true, $6, $7, $8, $8, 0, $9, 0, $9, 'unpaid', $10)`,
      [id, B, SUPP, `DR-${tag}-${id.slice(0, 4)}`, date, taxable, 2 * half, half, grand, BR]
    );
    await pool.query(
      `INSERT INTO purchase_items (purchase_id, item_id, item_name, quantity, unit_price, taxable_value, tax_rate,
          tax_amount, cgst_amount, sgst_amount, line_total)
       VALUES ($1, $2, 'Widget', 1, $3, $3, 18, $4, $5, $5, $6)`,
      [id, ITEM, taxable, 2 * half, half, grand]
    );
    return { id, grand };
  }

  async function makeFinalPurchase(taxable: number, date: string) {
    const id = randomUUID();
    const half = r2(taxable * 0.09);
    const grand = r2(taxable + 2 * half);
    const billNo = `PB-${tag}-${id.slice(0, 4)}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
            is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id, supplier_gstin)
         VALUES ($1, $2, $3, $4, $5, 'final', '27', false, true, $6, $7, $8, $8, 0, $9, 0, $9, 'unpaid', $10, '27ABCDE1234F1Z5')`,
        [id, B, SUPP, billNo, date, taxable, 2 * half, half, grand, BR]
      );
      await c.query(
        `INSERT INTO purchase_items (purchase_id, item_id, item_name, quantity, unit_price, taxable_value, tax_rate,
            tax_amount, cgst_amount, sgst_amount, line_total)
         VALUES ($1, $2, 'Widget', 1, $3, $3, 18, $4, $5, $5, $6)`,
        [id, ITEM, taxable, 2 * half, half, grand]
      );
      await adjustBranchItemStock(c, B, BR, ITEM, 1);
      await refreshItemGlobalStockFromBranches(c, B, ITEM);
      await c.query(
        `INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, reference_id, unit_cost, created_by)
         VALUES ($1, $2, 'in', 1, 'purchase', $3, $4, $5)`,
        [B, ITEM, id, taxable, A]
      );
      await createPurchaseLedgerEntries({
        businessId: B,
        purchaseId: id,
        purchaseNumber: billNo,
        purchaseDate: date,
        grandTotal: grand,
        supplierId: SUPP,
        isCashPurchase: false,
        branchId: BR,
        poolClient: c,
        taxableValue: taxable,
        cgstTotal: half,
        sgstTotal: half,
        itcEligible: true,
        itcClaimDate: date,
      });
      await c.query(`UPDATE suppliers SET current_balance = current_balance + $1 WHERE id = $2`, [grand, SUPP]);
    });
    return { id, grand };
  }

  const pay = (purchaseId: string, amount: number, date: string, session: string | null, tds?: number) =>
    call(
      postPayment(
        req(
          '/api/payments',
          'POST',
          {
            ...spoofBody,
            type: 'payable',
            reference_type: 'purchase',
            reference_id: purchaseId,
            amount,
            payment_mode: 'cash',
            payment_date: date,
            ...(tds ? { tds_amount: tds, tds_section: '194C' } : {}),
          },
          session
        )
      )
    );
  const del = (purchaseId: string, session: string | null) =>
    call(deletePurchase(req(`/api/purchases/${purchaseId}`, 'DELETE', { ...spoofBody, reason: 'Entered twice' }, session), { params: { id: purchaseId } }));
  const cancel = (purchaseId: string, session: string | null) =>
    call(
      cancelPurchaseRoute(req(`/api/purchases/${purchaseId}/cancel`, 'POST', { ...spoofBody, reason: 'Wrong bill' }, session), {
        params: { id: purchaseId },
      })
    );

  beforeAll(async () => {
    pool = getPool();
    await tx((c) => c.query(migration325));
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `Phase27 ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    const phone = Date.now().toString().slice(-8);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk A', $3, false), ($4, $2, 'Owner', $5, true)`,
      [A, B, `93${phone}`, OTHER, `94${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, pan, current_balance)
       VALUES ($1, $2, 'Bharat Supplies', '27', '27ABCDE1234F1Z5', 'ABCDE1234F', 0)`,
      [SUPP, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, purchase_price, selling_price, tax_rate, current_stock)
       VALUES ($1, $2, 'Widget', 'goods', 100, 150, 18, 0)`,
      [ITEM, B]
    );
    await pool.query(
      `INSERT INTO tds_categories (id, business_id, section_code, section_name, rate, threshold_amount)
       VALUES ($1, $2, '194C', 'Contractors', 1, 0)`,
      [CAT, B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', OTHER, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  beforeEach(() => {
    authorizeMock.mockReset();
    enforceAccessMock.mockClear();
    allowOnly(A, OTHER);
  });

  describe('POST /api/payments', () => {
    test('session user A + body created_by=OTHER: authorized, recorded and posted as A; accounting unchanged', async () => {
      const p = await makeDraftPurchase(10000, '2026-09-02');
      const before = await supplierBalance();
      const r = await pay(p.id, 3000, '2026-09-03', A, 30);
      expect(r.status).toBe(201);
      const payId = r.json.payment.id;

      expect(authorizedUsers()).toEqual([A]);
      expect(enforceAccessMock).toHaveBeenCalledWith(expect.objectContaining({ userId: A, businessId: B }));
      expect(enforceAccessMock.mock.calls.some((c) => c[0]?.userId === OTHER)).toBe(false);

      expect((await pool.query(`SELECT created_by FROM payments WHERE id = $1`, [payId])).rows[0].created_by).toBe(A);
      expect(
        (await pool.query(`SELECT created_by FROM tds_transactions WHERE payment_id = $1`, [payId])).rows.map((x) => x.created_by)
      ).toEqual([A]);
      const logs = (
        await pool.query(`SELECT DISTINCT user_id FROM activity_logs WHERE business_id = $1 AND entity_id = $2`, [B, payId])
      ).rows.map((x) => x.user_id);
      expect(logs).toEqual([A]);

      expect(net(await lines('payment', payId))).toEqual({ '2101': 3030, '1101': -3000, '2102': -30 });
      expect(await supplierBalance()).toBeCloseTo(before - 3030, 2);
      const doc = (await pool.query(`SELECT paid_amount, tds_deducted FROM purchases WHERE id = $1`, [p.id])).rows[0];
      expect(Number(doc.paid_amount)).toBe(3000);
      expect(Number(doc.tds_deducted)).toBe(30);
    });

    test("OTHER's permissions cannot authorize A's payment (403, nothing written)", async () => {
      allowOnly(OTHER);
      const p = await makeDraftPurchase(1000, '2026-09-04');
      const count = await paymentCount();
      const bal = await supplierBalance();
      const r = await pay(p.id, 100, '2026-09-04', A);
      expect(r.status).toBe(403);
      expect(authorizedUsers()).toEqual([A]);
      expect(await paymentCount()).toBe(count);
      expect(await supplierBalance()).toBeCloseTo(bal, 2);
    });

    test('no session: 401 even with created_by / user_id in body, query and x-user-id', async () => {
      const p = await makeDraftPurchase(1000, '2026-09-05');
      const count = await paymentCount();
      const r = await pay(p.id, 100, '2026-09-05', null);
      expect(r.status).toBe(401);
      expect(authorizeMock).not.toHaveBeenCalled();
      expect(await paymentCount()).toBe(count);
    });

    test('authenticated user without payments.create: 403', async () => {
      allowOnly();
      const p = await makeDraftPurchase(1000, '2026-09-06');
      const count = await paymentCount();
      const r = await pay(p.id, 100, '2026-09-06', A);
      expect(r.status).toBe(403);
      expect(await paymentCount()).toBe(count);
    });
  });

  describe('DELETE /api/purchases/[id]', () => {
    test('session user A + body user OTHER: authorized and attributed to A; Phase 2.6 draft delete unchanged', async () => {
      const p = await makeDraftPurchase(5000, '2026-09-07');
      const X = await supplierBalance();
      const paid = await pay(p.id, 1000, '2026-09-07', A);
      expect(paid.status).toBe(201);
      const payId = paid.json.payment.id;
      authorizeMock.mockClear();

      const out = await del(p.id, A);
      expect(out.status).toBe(200);
      expect(out.json.supplier_balance_restored).toBe(1000);
      expect(authorizedUsers()).toEqual([A]);

      expectFullyReversed(await lines('payment', payId));
      expect(await reversalActors('payment', payId)).toEqual([A]);
      expect(await supplierBalance()).toBeCloseTo(X, 2);
      expect((await pool.query(`SELECT deleted_at FROM purchases WHERE id = $1`, [p.id])).rows[0].deleted_at).not.toBeNull();
    });

    test('final bill deleted by A: cancelled_by and reversal created_by are A, not the body user', async () => {
      const p = await makeFinalPurchase(2000, '2026-09-08');
      const out = await del(p.id, A);
      expect(out.status).toBe(200);
      expect(authorizedUsers()).toEqual([A]);
      const doc = (await pool.query(`SELECT status, cancelled_by FROM purchases WHERE id = $1`, [p.id])).rows[0];
      expect(doc).toEqual({ status: 'cancelled', cancelled_by: A });
      expect(await reversalActors('purchase', p.id)).toEqual([A]);
    });

    test("OTHER's permissions cannot authorize A's delete (403, draft untouched)", async () => {
      allowOnly(OTHER);
      const p = await makeDraftPurchase(1000, '2026-09-09');
      const out = await del(p.id, A);
      expect(out.status).toBe(403);
      expect(authorizedUsers()).toEqual([A]);
      expect((await pool.query(`SELECT deleted_at FROM purchases WHERE id = $1`, [p.id])).rows[0].deleted_at).toBeNull();
    });

    test('no session: 401 even with deleted_by / user_id in body, query and x-user-id', async () => {
      const p = await makeDraftPurchase(1000, '2026-09-10');
      const out = await del(p.id, null);
      expect(out.status).toBe(401);
      expect(authorizeMock).not.toHaveBeenCalled();
      expect((await pool.query(`SELECT deleted_at FROM purchases WHERE id = $1`, [p.id])).rows[0].deleted_at).toBeNull();
    });

    test('authenticated user without purchases.delete: 403', async () => {
      allowOnly();
      const p = await makeDraftPurchase(1000, '2026-09-11');
      const out = await del(p.id, A);
      expect(out.status).toBe(403);
      expect((await pool.query(`SELECT deleted_at FROM purchases WHERE id = $1`, [p.id])).rows[0].deleted_at).toBeNull();
    });
  });

  describe('POST /api/purchases/[id]/cancel', () => {
    test('A cancels with body cancelled_by=OTHER: bill, TDS, Rule 37, stock and every reversal attributed to A', async () => {
      const X = await supplierBalance();
      const p = await makeFinalPurchase(5000, '2026-01-10');
      const t = await call(
        postTdsDeduct(
          req('/api/tds/deduct', 'POST', { purchase_id: p.id, tds_category_id: CAT, payment_amount: 5000, transaction_date: '2026-01-12' }, A),
          { params: {} } as never
        )
      );
      expect(t.status).toBe(201);
      const tdsId = t.json.tds_transaction.id;
      await tx(async (c) => {
        const row = (await listRule37Exposure(c, { businessId: B, asOn: '2026-09-20' })).find((x) => x.purchase_id === p.id)!;
        await syncRule37ForBill(c, { businessId: B, row, entryDate: '2026-09-20' });
      });
      const r37 = (
        await pool.query<{ voucher_id: string }>(
          `SELECT DISTINCT voucher_id FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = $2 AND reference_number = $3`,
          [B, RULE37_REVERSAL, `RULE37|${p.id}`]
        )
      ).rows.map((r) => r.voucher_id);
      expect(r37).toHaveLength(1);
      authorizeMock.mockClear();

      const out = await cancel(p.id, A);
      expect(out.status).toBe(200);
      expect(authorizedUsers()).toEqual([A]);

      const doc = (await pool.query(`SELECT status, cancelled_by, cancellation_reason FROM purchases WHERE id = $1`, [p.id])).rows[0];
      expect(doc).toEqual({ status: 'cancelled', cancelled_by: A, cancellation_reason: 'Wrong bill' });
      const tds = (await pool.query(`SELECT status, cancelled_by FROM tds_transactions WHERE id = $1`, [tdsId])).rows[0];
      expect(tds).toEqual({ status: 'cancelled', cancelled_by: A });

      for (const [type, id] of [
        ['purchase', p.id],
        ['tds', tdsId],
        [RULE37_REVERSAL, r37[0]],
      ] as const) {
        expectFullyReversed(await lines(type, id));
        expect(await reversalActors(type, id)).toEqual([A]);
      }
      const outs = (
        await pool.query(`SELECT DISTINCT created_by FROM stock_movements WHERE reference_type = 'purchase_cancel' AND reference_id = $1`, [p.id])
      ).rows.map((r) => r.created_by);
      expect(outs).toEqual([A]);
      expect(await supplierBalance()).toBeCloseTo(X, 2);
    });

    test('paid bill: still 409 PURCHASE_HAS_PAYMENTS for A, nothing reversed', async () => {
      const p = await makeFinalPurchase(2000, '2026-09-12');
      const paid = await pay(p.id, 500, '2026-09-12', A);
      expect(paid.status).toBe(201);
      const out = await cancel(p.id, A);
      expect(out.status).toBe(409);
      expect(out.json.code).toBe('PURCHASE_HAS_PAYMENTS');
      expect((await pool.query(`SELECT status, cancelled_by FROM purchases WHERE id = $1`, [p.id])).rows[0]).toEqual({
        status: 'final',
        cancelled_by: null,
      });
      expect(await reversalActors('purchase', p.id)).toEqual([]);
      expect(active(await lines('payment', paid.json.payment.id)).length).toBeGreaterThan(0);
    });

    test("OTHER's permissions cannot authorize A's cancel (403, bill untouched)", async () => {
      allowOnly(OTHER);
      const p = await makeFinalPurchase(1000, '2026-09-13');
      const before = await lines('purchase', p.id);
      const out = await cancel(p.id, A);
      expect(out.status).toBe(403);
      expect(authorizedUsers()).toEqual([A]);
      expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [p.id])).rows[0].status).toBe('final');
      expect(await lines('purchase', p.id)).toEqual(before);
    });

    test('no session: 401 even with cancelled_by / user_id in body, query and x-user-id', async () => {
      const p = await makeFinalPurchase(1000, '2026-09-14');
      const out = await cancel(p.id, null);
      expect(out.status).toBe(401);
      expect(authorizeMock).not.toHaveBeenCalled();
      expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [p.id])).rows[0].status).toBe('final');
    });

    test('authenticated user without cancel permission: 403', async () => {
      allowOnly();
      const p = await makeFinalPurchase(1000, '2026-09-15');
      const out = await cancel(p.id, A);
      expect(out.status).toBe(403);
      expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [p.id])).rows[0].status).toBe('final');
    });
  });
});
