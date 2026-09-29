/**
 * Real-PostgreSQL tests for Phase 2.6 (pre-staging fixes on top of migrations 323/324, plus 325).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with the application
 * schema. The real route handlers run against that database; only the subscription wrapper,
 * PBAC `authorize`, feature `enforceAccess` and the soft-delete entitlement are stubbed, and the
 * caller identity comes from the middleware headers exactly as in production.
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
  authorize: jest.fn().mockResolvedValue(undefined),
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
import { shouldUseSoftDelete } from '@/lib/soft-delete-entitlements';
import { createInvoiceLedgerEntries, createPurchaseLedgerEntries } from '@/lib/ledger-utils';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { cancelFinalPurchase } from '@/lib/purchases/cancel-purchase';
import { listRule37Exposure, syncRule37ForBill, RULE37_REVERSAL } from '@/lib/gst/rule37';
import { GSTR2BGenerator } from '@/lib/gst/gstr2b';
import { GSTR3BGenerator } from '@/lib/gst/gstr3b';
import { GSTR9Generator } from '@/lib/gst/gstr9';
import { fetchPartyLedgerDocs } from '@/lib/reports/party-ledger-docs';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postPayment } from '@/app/api/payments/route';
import { POST as postTdsDeduct } from '@/app/api/tds/deduct/route';
import { GET as getTdsTransactions } from '@/app/api/tds/transactions/route';
import { GET as getTdsSummary } from '@/app/api/tds/reports/summary/route';
import { POST as postTdsDeposit } from '@/app/api/tds/payments/route';
import { DELETE as deletePurchase } from '@/app/api/purchases/[id]/route';
import { POST as cancelPurchaseRoute } from '@/app/api/purchases/[id]/cancel/route';
import { PATCH as cancelInvoiceRoute } from '@/app/api/invoices/[id]/cancel/route';

const migration325 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/325_tds_transaction_status.sql'),
  'utf8'
);

type Line = { id: string; code: string; dr: number; cr: number; reversed: boolean; is_reversal: boolean };
const r2 = (n: number) => Math.round(n * 100) / 100;
const authorizeMock = authorize as jest.Mock;
const softDeleteMock = shouldUseSoftDelete as jest.Mock;

d('Phase 2.6 pre-staging fixes (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const U2 = randomUUID();
  const CUST = randomUUID();
  const SUPP = randomUUID();
  const ITEM = randomUUID();
  const CAT = randomUUID();
  const tag = B.slice(0, 8);

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

  const req = (p: string, method: string, body?: unknown, user: string | null = U) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user) {
      headers['x-authenticated-user-id'] = user;
      headers['x-authenticated-business-id'] = B;
    }
    return new NextRequest(`http://localhost${p}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    return { status: r.status, json: (await r.json()) as any };
  };

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
  /** Fully reversed: every original line has exactly one mirror, nothing active, nets to zero. */
  function expectFullyReversed(rows: Line[]) {
    expect(rows.length).toBeGreaterThan(0);
    expect(active(rows)).toHaveLength(0);
    expect(rows.filter((r) => r.reversed).length).toBe(rows.filter((r) => r.is_reversal).length);
    expect(net(rows)).toEqual({});
  }

  const supplierBalance = async () =>
    Number((await pool.query(`SELECT current_balance FROM suppliers WHERE id = $1`, [SUPP])).rows[0].current_balance);
  /** Supplier payable per the GL (2101 lines attributed to the supplier through their documents). */
  const glSupplierPayable = async () =>
    r2(
      (await fetchPartyLedgerDocs({ businessId: B, partyType: 'supplier', asOfDate: '2027-03-31', partyId: SUPP })).reduce(
        (s, doc) => s + doc.amount,
        0
      )
    );
  async function expectSupplierMatchesGl() {
    expect(await glSupplierPayable()).toBeCloseTo(await supplierBalance(), 2);
  }

  async function expectBusinessBalanced() {
    const t = (
      await pool.query<{ dr: string; cr: string }>(
        `SELECT COALESCE(SUM(debit), 0) AS dr, COALESCE(SUM(credit), 0) AS cr FROM ledger_entry_lines WHERE business_id = $1`,
        [B]
      )
    ).rows[0];
    expect(Number(t.dr)).toBeCloseTo(Number(t.cr), 2);
  }

  const tdsRow = async (id: string) =>
    (
      await pool.query(
        `SELECT id, status, cancelled_at, cancelled_by, cancellation_reason, is_deposited, tds_amount::float8 AS tds_amount,
                purchase_id, payment_id
           FROM tds_transactions WHERE id = $1`,
        [id]
      )
    ).rows[0];
  const tdsRowsOfPurchase = async (purchaseId: string) =>
    (await pool.query(`SELECT id FROM tds_transactions WHERE purchase_id = $1 ORDER BY created_at`, [purchaseId])).rows.map(
      (r) => r.id as string
    );

  async function makeDraftPurchase(o: { taxable: number; date: string }) {
    const id = randomUUID();
    const half = r2(o.taxable * 0.09);
    const grand = r2(o.taxable + 2 * half);
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, $5, 'draft', '27', false, true, $6, $7, $8, $8, 0, $9, 0, $9, 'unpaid', $10)`,
      [id, B, SUPP, `DR-${tag}-${id.slice(0, 4)}`, o.date, o.taxable, 2 * half, half, grand, BR]
    );
    await pool.query(
      `INSERT INTO purchase_items (purchase_id, item_id, item_name, quantity, unit_price, taxable_value, tax_rate,
          tax_amount, cgst_amount, sgst_amount, line_total)
       VALUES ($1, $2, 'Widget', 1, $3, $3, 18, $4, $5, $5, $6)`,
      [id, ITEM, o.taxable, 2 * half, half, grand]
    );
    return { id, grand };
  }

  async function makeFinalPurchase(o: { taxable: number; date: string; itcAvailed?: boolean }) {
    const id = randomUUID();
    const half = r2(o.taxable * 0.09);
    const grand = r2(o.taxable + 2 * half);
    const billNo = `PB-${tag}-${id.slice(0, 4)}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
            is_reverse_charge, itc_eligible, itc_availed, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id, supplier_gstin)
         VALUES ($1, $2, $3, $4, $5, 'final', '27', false, true, $6, $7, $8, $9, $9, 0, $10, 0, $10, 'unpaid', $11, '27ABCDE1234F1Z5')`,
        [id, B, SUPP, billNo, o.date, o.itcAvailed ?? false, o.taxable, 2 * half, half, grand, BR]
      );
      await c.query(
        `INSERT INTO purchase_items (purchase_id, item_id, item_name, quantity, unit_price, taxable_value, tax_rate,
            tax_amount, cgst_amount, sgst_amount, line_total)
         VALUES ($1, $2, 'Widget', 1, $3, $3, 18, $4, $5, $5, $6)`,
        [id, ITEM, o.taxable, 2 * half, half, grand]
      );
      await adjustBranchItemStock(c, B, BR, ITEM, 1);
      await refreshItemGlobalStockFromBranches(c, B, ITEM);
      await c.query(
        `INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, reference_id, unit_cost, created_by)
         VALUES ($1, $2, 'in', 1, 'purchase', $3, $4, $5)`,
        [B, ITEM, id, o.taxable, U]
      );
      await createPurchaseLedgerEntries({
        businessId: B,
        purchaseId: id,
        purchaseNumber: billNo,
        purchaseDate: o.date,
        grandTotal: grand,
        supplierId: SUPP,
        isCashPurchase: false,
        branchId: BR,
        poolClient: c,
        taxableValue: o.taxable,
        cgstTotal: half,
        sgstTotal: half,
        itcEligible: true,
        itcClaimDate: o.date,
      });
      await c.query(`UPDATE suppliers SET current_balance = current_balance + $1 WHERE id = $2`, [grand, SUPP]);
    });
    return { id, grand, tax: 2 * half };
  }

  const pay = (purchaseId: string, amount: number, date: string, tds?: { amount: number; section: string }) =>
    call(
      postPayment(
        req('/api/payments', 'POST', {
          type: 'payable',
          reference_type: 'purchase',
          reference_id: purchaseId,
          amount,
          payment_mode: 'cash',
          payment_date: date,
          created_by: U,
          ...(tds ? { tds_amount: tds.amount, tds_section: tds.section } : {}),
        })
      )
    );
  const deduct = (purchaseId: string, base: number, date: string) =>
    call(
      postTdsDeduct(
        req('/api/tds/deduct', 'POST', {
          purchase_id: purchaseId,
          tds_category_id: CAT,
          payment_amount: base,
          transaction_date: date,
        }),
        { params: {} } as never
      )
    );
  const del = (purchaseId: string) =>
    call(deletePurchase(req(`/api/purchases/${purchaseId}`, 'DELETE', { reason: 'Entered twice' }), { params: { id: purchaseId } }));
  const cancel = (purchaseId: string) =>
    call(cancelPurchaseRoute(req(`/api/purchases/${purchaseId}/cancel`, 'POST', { reason: 'Wrong bill' }), { params: { id: purchaseId } }));
  const registerIds = async (query = '') =>
    (await call(getTdsTransactions(req(`/api/tds/transactions${query}`, 'GET'), { params: {} } as never))).json.transactions.map(
      (t: { id: string }) => t.id
    );

  beforeAll(async () => {
    pool = getPool();
    // 325 must apply cleanly and be a no-op when applied again.
    await tx((c) => c.query(migration325));
    await tx((c) => c.query(migration325));

    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `Phase26 ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    const phone = Date.now().toString().slice(-8);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true), ($4, $2, 'Clerk', $5, false)`,
      [U, B, `91${phone}`, U2, `92${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance) VALUES ($1, $2, 'Asha Traders', '27', 0)`,
      [CUST, B]
    );
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
        await withLedgerDelete(c, 'tenant_purge', U, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  beforeEach(() => {
    authorizeMock.mockReset().mockResolvedValue(undefined);
    softDeleteMock.mockReset().mockResolvedValue(true);
  });

  afterEach(async () => {
    await expectBusinessBalanced();
  });

  test('migration 325: status columns and constraints exist; cancelled + deposited is impossible', async () => {
    const cols = (
      await pool.query(
        `SELECT column_name, column_default, is_nullable FROM information_schema.columns
          WHERE table_name = 'tds_transactions' AND column_name IN ('status', 'cancelled_at', 'cancelled_by', 'cancellation_reason')`
      )
    ).rows;
    expect(cols.map((c) => c.column_name).sort()).toEqual(['cancellation_reason', 'cancelled_at', 'cancelled_by', 'status']);
    expect(cols.find((c) => c.column_name === 'status')?.is_nullable).toBe('NO');
    const cons = (
      await pool.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'tds_transactions'::regclass
            AND conname IN ('tds_transactions_status_check', 'tds_transactions_cancelled_not_deposited')`
      )
    ).rows.map((r) => r.conname);
    expect(cons.sort()).toEqual(['tds_transactions_cancelled_not_deposited', 'tds_transactions_status_check']);

    const insert = (status: string, deposited: boolean) =>
      pool.query(
        `INSERT INTO tds_transactions (business_id, supplier_id, tds_category_id, section_code, payment_amount, tds_rate,
            tds_amount, net_payment_amount, transaction_date, financial_year, quarter, is_deposited, status)
         VALUES ($1, $2, $3, '194C', 100, 1, 1, 99, '2026-09-01', '2026-2027', 'Q2', $4, $5) RETURNING id`,
        [B, SUPP, CAT, deposited, status]
      );
    await expect(insert('cancelled', true)).rejects.toThrow(/tds_transactions_cancelled_not_deposited/);
    await expect(insert('void', false)).rejects.toThrow(/tds_transactions_status_check/);
    const ok = (await insert('active', true)).rows[0].id;
    await expect(pool.query(`UPDATE tds_transactions SET status = 'cancelled' WHERE id = $1`, [ok])).rejects.toThrow(
      /tds_transactions_cancelled_not_deposited/
    );
    await pool.query(`DELETE FROM tds_transactions WHERE id = $1`, [ok]);
  });

  describe('P0-1 draft purchase delete restores the supplier balance', () => {
    test('draft + payment', async () => {
      const X = await supplierBalance();
      const p = await makeDraftPurchase({ taxable: 1000, date: '2026-09-02' });
      const r = await pay(p.id, 400, '2026-09-03');
      expect(r.status).toBe(201);
      const payId = r.json.payment.id;
      expect(await supplierBalance()).toBeCloseTo(X - 400, 2);
      await expectSupplierMatchesGl();

      const out = await del(p.id);
      expect(out.status).toBe(200);
      expect(out.json.supplier_balance_restored).toBe(400);

      expect(await supplierBalance()).toBeCloseTo(X, 2);
      expectFullyReversed(await lines('payment', payId));
      expect((await pool.query(`SELECT deleted_at FROM payments WHERE id = $1`, [payId])).rows[0].deleted_at).not.toBeNull();
      expect((await pool.query(`SELECT deleted_at FROM purchases WHERE id = $1`, [p.id])).rows[0].deleted_at).not.toBeNull();
      await expectSupplierMatchesGl();
    });

    test('draft + TDS (deducted on its own)', async () => {
      const X = await supplierBalance();
      const p = await makeDraftPurchase({ taxable: 5000, date: '2026-09-04' });
      const r = await deduct(p.id, 5000, '2026-09-04');
      expect(r.status).toBe(201);
      const tdsId = r.json.tds_transaction.id;
      expect(Number(r.json.tds_transaction.tds_amount)).toBe(50);
      expect(await supplierBalance()).toBeCloseTo(X - 50, 2);
      await expectSupplierMatchesGl();

      const out = await del(p.id);
      expect(out.status).toBe(200);
      expect(out.json.supplier_balance_restored).toBe(50);

      expect(await supplierBalance()).toBeCloseTo(X, 2);
      expectFullyReversed(await lines('tds', tdsId));
      const row = await tdsRow(tdsId);
      expect(row.status).toBe('cancelled');
      expect(row.cancelled_by).toBe(U);
      expect(row.cancelled_at).not.toBeNull();
      await expectSupplierMatchesGl();
    });

    test('draft + payment with TDS + separate TDS deduction (hard-delete business)', async () => {
      softDeleteMock.mockResolvedValue(false);
      const X = await supplierBalance();
      const p = await makeDraftPurchase({ taxable: 10000, date: '2026-09-05' });
      const r1 = await pay(p.id, 3000, '2026-09-06', { amount: 30, section: '194C' });
      expect(r1.status).toBe(201);
      const payId = r1.json.payment.id;
      const r2_ = await deduct(p.id, 2000, '2026-09-07');
      expect(r2_.status).toBe(201);
      expect(await supplierBalance()).toBeCloseTo(X - 3000 - 30 - 20, 2);
      await expectSupplierMatchesGl();
      const tdsIds = await tdsRowsOfPurchase(p.id);
      expect(tdsIds).toHaveLength(2);
      const doc = (await pool.query(`SELECT paid_amount, tds_deducted FROM purchases WHERE id = $1`, [p.id])).rows[0];
      expect(Number(doc.paid_amount)).toBe(3000);
      expect(Number(doc.tds_deducted)).toBe(50);

      const out = await del(p.id);
      expect(out.status).toBe(200);
      expect(out.json.mode).toBe('deleted');
      // Payment-embedded TDS is counted once (through its TDS row), not again through the payment.
      expect(out.json.supplier_balance_restored).toBe(3050);

      expect(await supplierBalance()).toBeCloseTo(X, 2);
      expectFullyReversed(await lines('payment', payId));
      expectFullyReversed(await lines('tds', r2_.json.tds_transaction.id));
      for (const id of tdsIds) expect((await tdsRow(id)).status).toBe('cancelled');
      expect((await pool.query(`SELECT 1 FROM purchases WHERE id = $1`, [p.id])).rows).toHaveLength(0);
      expect((await pool.query(`SELECT 1 FROM payments WHERE id = $1`, [payId])).rows).toHaveLength(0);
      await expectSupplierMatchesGl();
    });
  });

  describe('P0-2 TDS rows are cancelled, never deleted', () => {
    test('TDS deducted on a final bill: cancel keeps the row (cancelled), reverses the voucher, reports exclude it', async () => {
      const X = await supplierBalance();
      const p = await makeFinalPurchase({ taxable: 3000, date: '2026-09-08' });
      const r = await deduct(p.id, 3000, '2026-09-08');
      expect(r.status).toBe(201);
      const tdsId = r.json.tds_transaction.id;
      const voucherBefore = await lines('tds', tdsId);
      expect(voucherBefore).toHaveLength(2);
      expect(await registerIds()).toContain(tdsId);
      const summaryBefore = (await call(getTdsSummary(req('/api/tds/reports/summary?financial_year=2026-2027&quarter=Q2', 'GET'), { params: {} } as never))).json;

      const out = await cancel(p.id);
      expect(out.status).toBe(200);

      const row = await tdsRow(tdsId);
      expect(row).toBeDefined();
      expect(row.status).toBe('cancelled');
      expect(row.cancelled_by).toBe(U);
      expect(row.cancellation_reason).toBe('Wrong bill');
      expect(row.purchase_id).toBe(p.id);

      const after = await lines('tds', tdsId);
      for (const l of voucherBefore) expect(after.find((a) => a.id === l.id)?.reversed).toBe(true);
      expect(after.filter((l) => l.is_reversal)).toHaveLength(2);
      expectFullyReversed(after);

      expect(await registerIds()).not.toContain(tdsId);
      expect(await registerIds('?status=cancelled')).toContain(tdsId);
      const summaryAfter = (await call(getTdsSummary(req('/api/tds/reports/summary?financial_year=2026-2027&quarter=Q2', 'GET'), { params: {} } as never))).json;
      expect(Number(summaryAfter.summary?.total_tds_amount ?? 0)).toBeCloseTo(Number(summaryBefore.summary.total_tds_amount) - 30, 2);

      expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [p.id])).rows[0].status).toBe('cancelled');
      expect(await supplierBalance()).toBeCloseTo(X, 2);
      await expectSupplierMatchesGl();
    });

    test('deposited TDS cannot be cancelled; deposit never picks up cancelled rows', async () => {
      const p = await makeFinalPurchase({ taxable: 4000, date: '2026-06-10' });
      const r = await deduct(p.id, 4000, '2026-06-10');
      expect(r.status).toBe(201);
      const tdsId = r.json.tds_transaction.id;

      const cancelledEarlier = (
        await pool.query(
          `INSERT INTO tds_transactions (business_id, supplier_id, tds_category_id, section_code, payment_amount, tds_rate,
              tds_amount, net_payment_amount, transaction_date, financial_year, quarter, status, cancelled_at)
           VALUES ($1, $2, $3, '194C', 100, 1, 1, 99, '2026-06-11', '2026-2027', 'Q1', 'cancelled', NOW()) RETURNING id`,
          [B, SUPP, CAT]
        )
      ).rows[0].id;

      const dep = await call(
        postTdsDeposit(
          req('/api/tds/payments', 'POST', {
            financial_year: '2026-2027',
            quarter: 'Q1',
            challan_number: `CH-${tag}`,
            challan_date: '2026-07-05',
            deposit_date: '2026-07-05',
            total_tds_amount: 40,
          }),
          { params: {} } as never
        )
      );
      expect(dep.status).toBe(201);
      expect((await tdsRow(tdsId)).is_deposited).toBe(true);
      const skipped = await tdsRow(cancelledEarlier);
      expect(skipped.is_deposited).toBe(false);
      expect(skipped.status).toBe('cancelled');

      const supplierBefore = await supplierBalance();
      const voucherBefore = await lines('tds', tdsId);
      const out = await cancel(p.id);
      expect(out.status).toBe(409);
      expect(out.json.code).toBe('BILL_TDS_DEPOSITED');
      const row = await tdsRow(tdsId);
      expect(row.status).toBe('active');
      expect(row.is_deposited).toBe(true);
      expect(await lines('tds', tdsId)).toEqual(voucherBefore);
      expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [p.id])).rows[0].status).toBe('final');
      expect(await supplierBalance()).toBeCloseTo(supplierBefore, 2);
    });
  });

  test('P1: a final bill with a live payment (with TDS) is not cancelled; nothing is reversed', async () => {
    const p = await makeFinalPurchase({ taxable: 2000, date: '2026-09-09' });
    const r = await pay(p.id, 1000, '2026-09-10', { amount: 20, section: '194C' });
    expect(r.status).toBe(201);
    const payId = r.json.payment.id;
    const [tdsId] = await tdsRowsOfPurchase(p.id);
    const supplierBefore = await supplierBalance();
    const billBefore = await lines('purchase', p.id);
    const payBefore = await lines('payment', payId);
    const cash = (
      await pool.query(
        `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS v FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND a.account_code = '1101'`,
        [B]
      )
    ).rows[0].v;

    const out = await cancel(p.id);
    expect(out.status).toBe(409);
    expect(out.json.code).toBe('PURCHASE_HAS_PAYMENTS');

    const viaDelete = await del(p.id);
    expect(viaDelete.status).toBe(409);
    expect(viaDelete.json.code).toBe('PURCHASE_HAS_PAYMENTS');

    const doc = (await pool.query(`SELECT status, paid_amount, deleted_at FROM purchases WHERE id = $1`, [p.id])).rows[0];
    expect(doc.status).toBe('final');
    expect(doc.deleted_at).toBeNull();
    expect(Number(doc.paid_amount)).toBe(1000);
    expect((await pool.query(`SELECT deleted_at FROM payments WHERE id = $1`, [payId])).rows[0].deleted_at).toBeNull();
    expect((await tdsRow(tdsId)).status).toBe('active');
    expect(await lines('purchase', p.id)).toEqual(billBefore);
    expect(await lines('payment', payId)).toEqual(payBefore);
    expect(active(payBefore)).toHaveLength(payBefore.length);
    const reversals = await pool.query(
      `SELECT 1 FROM ledger_entry_reversals WHERE business_id = $1 AND voucher_id = ANY($2::uuid[])`,
      [B, [p.id, payId]]
    );
    expect(reversals.rows).toHaveLength(0);
    expect(
      (
        await pool.query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS v FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
            WHERE l.business_id = $1 AND a.account_code = '1101'`,
          [B]
        )
      ).rows[0].v
    ).toBeCloseTo(cash, 2);
    expect(await supplierBalance()).toBeCloseTo(supplierBefore, 2);
    await expectSupplierMatchesGl();
  });

  test('P0-3: Rule 37 reversal of a cancelled bill is reversed too; history kept, no ITC residue', async () => {
    const X = await supplierBalance();
    const gen3b = new GSTR3BGenerator();
    const sepBefore = (await gen3b.generate({ business_id: B, month: 9, year: 2026 })).itc_details;

    const p = await makeFinalPurchase({ taxable: 5000, date: '2026-01-10', itcAvailed: true });
    const posted = await tx(async (c) => {
      const rows = await listRule37Exposure(c, { businessId: B, asOn: '2026-09-20' });
      const row = rows.find((x) => x.purchase_id === p.id)!;
      expect(row.status).toBe('overdue');
      return syncRule37ForBill(c, { businessId: B, row, entryDate: '2026-09-20' });
    });
    expect(posted.reversed).toBe(900);
    const r37 = (
      await pool.query<{ voucher_id: string }>(
        `SELECT DISTINCT voucher_id FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = $2 AND reference_number = $3`,
        [B, RULE37_REVERSAL, `RULE37|${p.id}`]
      )
    ).rows.map((r) => r.voucher_id);
    expect(r37).toHaveLength(1);
    const r37Before = await lines(RULE37_REVERSAL, r37[0]);
    expect(net(r37Before)).toEqual({ '1110': -450, '1111': -450, '1114': 900 });
    const sepWithR37 = (await gen3b.generate({ business_id: B, month: 9, year: 2026 })).itc_details;
    expect(r2(sepWithR37.itc_reversed.cgst - sepBefore.itc_reversed.cgst)).toBe(450);

    const out = await cancel(p.id);
    expect(out.status).toBe(200);

    const r37After = await lines(RULE37_REVERSAL, r37[0]);
    for (const l of r37Before) expect(r37After.find((a) => a.id === l.id)?.reversed).toBe(true);
    expectFullyReversed(r37After);
    expectFullyReversed(await lines('purchase', p.id));

    const itcResidue = (
      await pool.query(
        `SELECT a.account_code, SUM(l.debit - l.credit)::float8 AS v
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND a.account_code IN ('1110', '1111', '1112', '1114')
            AND ((l.voucher_type = 'purchase' AND l.voucher_id = $2) OR l.reference_number = $3)
          GROUP BY a.account_code`,
        [B, p.id, `RULE37|${p.id}`]
      )
    ).rows;
    for (const r of itcResidue) expect(r2(r.v)).toBe(0);

    await tx(async (c) => {
      const rows = await listRule37Exposure(c, { businessId: B, asOn: '2026-09-25' });
      expect(rows.find((x) => x.purchase_id === p.id)).toBeUndefined();
    });
    const sepAfter = (await gen3b.generate({ business_id: B, month: 9, year: 2026 })).itc_details;
    expect(sepAfter.itc_reversed).toEqual(sepBefore.itc_reversed);
    expect(sepAfter.net_itc).toEqual(sepBefore.net_itc);
    const jan2b = await new GSTR2BGenerator().generate({ business_id: B, month: 1, year: 2026 });
    expect(jan2b.summary.total_itc_available ?? 0).toBe(0);
    expect(jan2b.summary.purchase_count).toBe(0);

    expect(await supplierBalance()).toBeCloseTo(X, 2);
    await expectSupplierMatchesGl();
  });

  test('P0-4: GSTR-2B / GSTR-9 8A / GSTR-3B take only active bills', async () => {
    const g2b = new GSTR2BGenerator();
    const g3b = new GSTR3BGenerator();
    const julyBefore3b = (await g3b.generate({ business_id: B, month: 7, year: 2026 })).itc_details.net_itc;

    const activeBill = await makeFinalPurchase({ taxable: 1000, date: '2026-07-05', itcAvailed: true });
    const cancelled = await makeFinalPurchase({ taxable: 2000, date: '2026-07-06', itcAvailed: true });
    const legacyDeleted = await makeFinalPurchase({ taxable: 3000, date: '2026-07-07', itcAvailed: true });
    const draft = await makeDraftPurchase({ taxable: 4000, date: '2026-07-08' });
    await pool.query(`UPDATE purchases SET itc_availed = true WHERE id = $1`, [draft.id]);

    const withCancelled = await g2b.generate({ business_id: B, month: 7, year: 2026 });
    expect(withCancelled.summary.total_itc_available).toBeCloseTo(activeBill.tax + cancelled.tax + legacyDeleted.tax, 2);
    const julyWith3b = (await g3b.generate({ business_id: B, month: 7, year: 2026 })).itc_details.net_itc;
    expect(r2(julyWith3b.cgst - julyBefore3b.cgst)).toBeCloseTo((activeBill.tax + cancelled.tax + legacyDeleted.tax) / 2, 2);

    const out = await cancel(cancelled.id);
    expect(out.status).toBe(200);
    // Legacy soft delete: a final bill hidden with deleted_at only (postings reversed as a cancel would).
    await tx(async (c) => {
      await cancelFinalPurchase(c, { businessId: B, purchaseId: legacyDeleted.id, userId: U, reason: 'legacy', warehouseModeEnabled: false });
      await c.query(`UPDATE purchases SET status = 'final', deleted_at = NOW() WHERE id = $1`, [legacyDeleted.id]);
    });
    // A cancelled bill that somehow lost deleted_at filtering must still be excluded by status alone.
    expect((await pool.query(`SELECT status, deleted_at FROM purchases WHERE id = $1`, [cancelled.id])).rows[0]).toEqual({
      status: 'cancelled',
      deleted_at: null,
    });

    const july2b = await g2b.generate({ business_id: B, month: 7, year: 2026 });
    expect(july2b.summary.purchase_count).toBe(1);
    expect(july2b.summary.total_itc_available).toBeCloseTo(activeBill.tax, 2);

    const julyAfter3b = (await g3b.generate({ business_id: B, month: 7, year: 2026 })).itc_details.net_itc;
    expect(r2(julyAfter3b.cgst - julyBefore3b.cgst)).toBeCloseTo(activeBill.tax / 2, 2);
    expect(r2(julyAfter3b.sgst - julyBefore3b.sgst)).toBeCloseTo(activeBill.tax / 2, 2);

    // No GSTR-2B imported: 8A falls back to active registered non-RCM bills in the books, by tax head.
    const heads = async (status: string) =>
      (
        await pool.query(
          `SELECT COALESCE(SUM(pi.igst_amount), 0)::float8 AS igst, COALESCE(SUM(pi.cgst_amount), 0)::float8 AS cgst,
                  COALESCE(SUM(pi.sgst_amount), 0)::float8 AS sgst
             FROM purchases p JOIN purchase_items pi ON pi.purchase_id = p.id
            WHERE p.business_id = $1 AND p.status = $2 AND p.deleted_at IS NULL AND NOT p.is_reverse_charge
              AND LENGTH(COALESCE(p.supplier_gstin, '')) >= 15 AND COALESCE(p.itc_eligible, true)
              AND p.bill_date BETWEEN '2026-04-01' AND '2027-03-31'`,
          [B, status]
        )
      ).rows[0];
    const returned = (
      await pool.query(
        `SELECT COALESCE(SUM(pr.cgst_total), 0)::float8 AS cgst, COALESCE(SUM(pr.sgst_total), 0)::float8 AS sgst
           FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
          WHERE pr.business_id = $1 AND p.status = 'final' AND p.deleted_at IS NULL
            AND COALESCE(pr.status, 'final') <> 'cancelled' AND pr.return_date BETWEEN '2026-04-01' AND '2027-03-31'`,
        [B]
      )
    ).rows[0];
    const active = await heads('final');
    const gstr9 = await new GSTR9Generator().generate({ business_id: B, financial_year: 2026 });
    const t8a = gstr9.table_8.A;
    expect(r2(t8a.igst)).toBeCloseTo(r2(active.igst), 2);
    expect(r2(t8a.cgst)).toBeCloseTo(r2(active.cgst - returned.cgst), 2);
    expect(r2(t8a.sgst)).toBeCloseTo(r2(active.sgst - returned.sgst), 2);
    expect(gstr9.validation.warnings.some((w) => w.startsWith('Table 8A: no GSTR-2B imported'))).toBe(true);
    const cancelledHeads = await heads('cancelled');
    expect(r2(cancelledHeads.cgst + cancelledHeads.sgst)).toBeGreaterThanOrEqual(r2(cancelled.tax));
  });

  describe('P1: invoice cancel uses only the authenticated identity', () => {
    async function makeInvoice() {
      const id = randomUUID();
      const no = `INV-${tag}-${id.slice(0, 4)}`;
      await tx(async (c) => {
        await c.query(
          `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
              place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
              paid_amount, balance_amount, payment_status, branch_id)
           VALUES ($1, $2, $3, $4, '2026-09-12', 'final', 'tax_invoice', '27', 1000, 180, 90, 90, 0, 1180, 0, 1180, 'unpaid', $5)`,
          [id, B, CUST, no, BR]
        );
        await createInvoiceLedgerEntries({
          businessId: B,
          invoiceId: id,
          invoiceNumber: no,
          invoiceDate: '2026-09-12',
          grandTotal: 1180,
          customerId: CUST,
          isCashSale: false,
          branchId: BR,
          taxableValue: 1000,
          cgstTotal: 90,
          sgstTotal: 90,
          poolClient: c,
        });
        await c.query(`UPDATE customers SET current_balance = current_balance + 1180 WHERE id = $1`, [CUST]);
      });
      return id;
    }
    const cancelInvoice = (id: string, body: unknown, user: string | null) =>
      call(cancelInvoiceRoute(req(`/api/invoices/${id}/cancel`, 'PATCH', body, user), { params: { id } }));

    test('body cancelled_by is ignored: authorization, audit and reversal use the session user', async () => {
      const id = await makeInvoice();
      const out = await cancelInvoice(id, { reason: 'Duplicate', cancelled_by: U }, U2);
      expect(out.status).toBe(200);

      expect(authorizeMock).toHaveBeenCalledWith(U2, 'invoices', 'cancel', expect.objectContaining({ resourceId: id }));
      expect(authorizeMock.mock.calls.some((c) => c[0] === U)).toBe(false);
      const inv = (await pool.query(`SELECT status, cancellation_details FROM invoices WHERE id = $1`, [id])).rows[0];
      expect(inv.status).toBe('cancelled');
      expect(inv.cancellation_details.cancelled_by).toBe(U2);
      const links = (
        await pool.query(`SELECT DISTINCT created_by FROM ledger_entry_reversals WHERE business_id = $1 AND voucher_id = $2`, [B, id])
      ).rows;
      expect(links).toEqual([{ created_by: U2 }]);
    });

    test('a user denied by PBAC cannot cancel by naming another user in the body', async () => {
      const id = await makeInvoice();
      authorizeMock.mockImplementation(async (userId: string) => {
        if (userId !== U) throw new AuthorizationError('Not allowed', 'FORBIDDEN');
      });
      const out = await cancelInvoice(id, { reason: 'x', cancelled_by: U }, U2);
      expect(out.status).toBe(403);
      expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [id])).rows[0].status).toBe('final');
    });

    test('no authenticated session: 401 even with cancelled_by in the body', async () => {
      const id = await makeInvoice();
      const out = await cancelInvoice(id, { reason: 'x', cancelled_by: U, business_id: B }, null);
      expect(out.status).toBe(401);
      expect(authorizeMock).not.toHaveBeenCalled();
      expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [id])).rows[0].status).toBe('final');
    });
  });
});
