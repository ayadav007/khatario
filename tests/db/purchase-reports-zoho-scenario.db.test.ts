/**
 * Purchase reports against the scenario run in Zoho Books (Tandoor Studio, prefix QA-PR,
 * docs/qa/reports-zoho-vs-khatario/04-purchase-reports.md). Documents are created through the real
 * purchase / cancel / purchase-return routes. Runs only when PHASE2_TEST_DATABASE_URL points at a
 * disposable database.
 *
 * Zoho, 1-30 Sep 2026 (QA-PR documents only):
 *   Purchases by Vendor  Vendor KA  2 bills, 1 vendor credit  6,360 / 7,114.80 with tax  (P1 + P3 less VC1)
 *                        Vendor MH  1 bill                     1,800 / 2,124 with tax
 *   Purchases by Item    Widget qty 9  5,160  avg 573.33  |  Gadget qty 10  3,000  avg 300
 *   Bill Details         P2 balance 1,124 after a 1,000 payment; voided P4 and the August bill P5 are
 *                        excluded from the purchase figures.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
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
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  assertReportAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/backdate-controls', () => ({
  ...jest.requireActual('@/lib/backdate-controls'),
  hasBackdateApprovalPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => null),
  getUserAgent: jest.fn(() => null),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postPurchase } from '@/app/api/purchases/route';
import { POST as cancelPurchase } from '@/app/api/purchases/[id]/cancel/route';
import { POST as postReturn } from '@/app/api/purchase-returns/route';
import { GET as supplierWise } from '@/app/api/reports/purchase/supplier-wise/route';
import { GET as itemWise } from '@/app/api/reports/purchase/item-wise/route';
import { GET as summary } from '@/app/api/reports/purchase/summary/route';
import { GET as invoiceWise } from '@/app/api/reports/purchase/invoice-wise/route';
import { GET as returnsReport } from '@/app/api/reports/purchase/returns/route';
import { GET as creditReport } from '@/app/api/reports/purchase/credit/route';
import { GET as taxWise } from '@/app/api/reports/purchase/tax-wise/route';

d('Purchase reports vs Zoho scenario (real DB)', () => {
  jest.setTimeout(180000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const BR2 = randomUUID();
  const U = randomUUID();
  const KA = randomUUID();
  const MH = randomUUID();
  const WIDGET = randomUUID();
  const GADGET = randomUUID();
  const tag = B.slice(0, 8);
  const bill: Record<string, string> = {};
  const SEP = 'from_date=2026-09-01&to_date=2026-09-30';

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

  const req = (p: string, method = 'GET', body?: unknown) =>
    new NextRequest(`http://localhost${p}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-authenticated-user-id': U, 'x-authenticated-business-id': B },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };

  const widget = (quantity: number, extra: Record<string, unknown> = {}) => ({
    item_id: WIDGET, item_name: 'QA-PR Widget', hsn_sac: '847130', unit: 'PCS', quantity, unit_price: 600, tax_rate: 18, ...extra,
  });
  const gadget = (quantity: number) => ({
    item_id: GADGET, item_name: 'QA-PR Gadget', hsn_sac: '847130', unit: 'PCS', quantity, unit_price: 300, tax_rate: 5,
  });

  async function purchase(
    key: string,
    supplier: string,
    state: string,
    date: string,
    items: unknown[],
    { status = 'final', branch = BR, paid = 0 }: { status?: string; branch?: string; paid?: number } = {}
  ) {
    const res = await call(
      postPurchase(
        req('/api/purchases', 'POST', {
          branch_id: branch, supplier_id: supplier, bill_number: `QA-PR-${key}-${tag}`, bill_date: date, due_date: date,
          items, status, paid_amount: paid, supplier_state_code: state, place_of_supply_state_code: '29',
          backdate_reason: 'Zoho comparison scenario',
        })
      )
    );
    if (res.status !== 201 && res.status !== 200) throw new Error(`purchase ${key}: ${res.status} ${JSON.stringify(res.json)}`);
    const id = res.json.purchase?.id ?? res.json.id;
    bill[key] = id;
    return id as string;
  }

  const report = (fn: (r: NextRequest) => Promise<Response>, p: string) => call(fn(req(p)));
  const byId = (rows: any[], key: string, id: string) => rows.find((r) => r[key] === id);

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '29AAGCQ4321A1ZS', '29', 'regular')`,
      [B, `PurchRpt ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $3, 'Main', '29', true, true, true), ($2, $3, 'Second', '29', false, false, true)`,
      [BR, BR2, B]
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`, [
      U,
      B,
      `93${Date.now().toString().slice(-8)}`,
    ]);
    await pool.query(`UPDATE users SET auth_session_version = 1 WHERE id = $1`, [U]).catch(() => {});
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1, $3, 'QA-PR Vendor KA', '29', '29AAACQ1234P1Z5', 0), ($2, $3, 'QA-PR Vendor MH', '27', '27AAACQ5678R1ZH', 0)`,
      [KA, MH, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1, $3, 'QA-PR Widget', 'goods', 'PCS', 1200, 600, 18, '847130'),
              ($2, $3, 'QA-PR Gadget', 'goods', 'PCS', 600, 300, 5, '847130')`,
      [WIDGET, GADGET, B]
    );

    await purchase('P1', KA, '29', '2026-09-04', [widget(5, { discount_percent: 10 }), gadget(10)]);
    await purchase('P2', MH, '27', '2026-09-10', [widget(3)], { paid: 1000 });
    await purchase('P3', KA, '29', '2026-09-18', [widget(2)]);
    await purchase('P4-VOID', KA, '29', '2026-09-21', [gadget(4)]);
    const cancelled = await call(
      cancelPurchase(req(`/api/purchases/${bill['P4-VOID']}/cancel`, 'POST', { reason: 'Void' }), { params: { id: bill['P4-VOID'] } })
    );
    expect(cancelled.status).toBe(200);
    await purchase('P5-AUG', MH, '27', '2026-08-28', [widget(1)]);

    const ret = await call(
      postReturn(
        req('/api/purchase-returns', 'POST', {
          purchase_id: bill.P1, return_number: `QA-PR-VC1-${tag}`, return_date: '2026-09-24', reason: 'Damaged',
          items: [{ item_id: WIDGET, item_name: 'QA-PR Widget', qty: 1 }],
        })
      )
    );
    if (ret.status !== 201 && ret.status !== 200) throw new Error(`purchase return: ${ret.status} ${JSON.stringify(ret.json)}`);

    // Not in the Zoho scenario: a draft bill (Zoho's API cannot draft one) and a second-branch bill.
    await purchase('P6-DRAFT', KA, '29', '2026-09-19', [widget(7)], { status: 'draft' });
    await purchase('BR2-P1', KA, '29', '2026-09-15', [gadget(2)], { branch: BR2 });
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

  test('bill and return totals match the Zoho documents', async () => {
    const rows = (
      await pool.query(
        `SELECT bill_number, subtotal::float8, tax_total::float8, grand_total::float8, balance_amount::float8 FROM purchases WHERE business_id = $1`,
        [B]
      )
    ).rows;
    const by = Object.fromEntries(rows.map((r) => [r.bill_number.replace(`-${tag}`, ''), r]));
    expect(by['QA-PR-P1']).toMatchObject({ subtotal: 5700, tax_total: 636, grand_total: 6336, balance_amount: 5698.8 });
    expect(by['QA-PR-P2']).toMatchObject({ subtotal: 1800, tax_total: 324, grand_total: 2124, balance_amount: 1124 });
    expect(by['QA-PR-P3']).toMatchObject({ subtotal: 1200, tax_total: 216, grand_total: 1416 });
    const ret = (await pool.query(`SELECT subtotal::float8, tax_total::float8, grand_total::float8 FROM purchase_returns WHERE business_id = $1`, [B])).rows[0];
    expect(ret).toEqual({ subtotal: 540, tax_total: 97.2, grand_total: 637.2 });
  });

  test('purchases by vendor is net of returns and excludes draft, void and out-of-range bills', async () => {
    const res = await report(supplierWise, `/api/reports/purchase/supplier-wise?${SEP}&branch_id=${BR}`);
    expect(res.status).toBe(200);
    expect(byId(res.json.suppliers, 'supplier_id', KA)).toMatchObject({
      supplier_name: 'QA-PR Vendor KA',
      bill_count: 2,
      return_count: 1,
      bill_purchases: 6900,
      return_purchases: 540,
      purchases: 6360,
      purchases_with_tax: 7114.8,
      tax: 754.8,
    });
    // A return against a bill reduces that bill's balance; Zoho keeps it as an open vendor credit.
    // Either way the vendor is owed 7,752 - 637.20.
    expect(byId(res.json.suppliers, 'supplier_id', KA).balance_due).toBeCloseTo(7114.8, 2);
    expect(byId(res.json.suppliers, 'supplier_id', MH)).toMatchObject({
      bill_count: 1, purchases: 1800, purchases_with_tax: 2124, paid: 1000, balance_due: 1124,
    });
    expect(res.json.suppliers).toHaveLength(2);
    expect(res.json.totals).toMatchObject({ bill_count: 3, purchases: 8160, purchases_with_tax: 9238.8 });
  });

  test('purchases by item nets returned quantity and value, excluding GST', async () => {
    const res = await report(itemWise, `/api/reports/purchase/item-wise?${SEP}&branch_id=${BR}`);
    expect(res.status).toBe(200);
    expect(byId(res.json.items, 'item_id', WIDGET)).toMatchObject({
      item_name: 'QA-PR Widget',
      quantity_purchased: 10,
      quantity_returned: 1,
      quantity: 9,
      amount: 5160,
      average_cost: 573.33,
      discount: 300,
    });
    expect(byId(res.json.items, 'item_id', GADGET)).toMatchObject({ quantity: 10, amount: 3000, average_cost: 300 });
    expect(res.json.items).toHaveLength(2);
    expect(res.json.totals).toMatchObject({ quantity: 19, amount: 8160 });
  });

  test('purchase summary nets returns by day and reconciles to the ledger stock and purchase debits', async () => {
    const res = await report(summary, `/api/reports/purchase/summary?${SEP}&period=day&branch_id=${BR}`);
    expect(res.status).toBe(200);
    const day = Object.fromEntries(res.json.summary.map((r: any) => [r.period, r]));
    expect(day['2026-09-04']).toMatchObject({ bill_count: 1, purchases: 5700, tax: 636 });
    expect(day['2026-09-24']).toMatchObject({ bill_count: 0, return_count: 1, return_purchases: 540, purchases: -540, purchases_with_tax: -637.2 });
    expect(day['2026-09-21']).toBeUndefined();
    expect(day['2026-09-19']).toBeUndefined();
    expect(res.json.totals).toMatchObject({ purchases: 8160, tax: 1078.8, purchases_with_tax: 9238.8 });

    // Goods bills capitalise their taxable value to stock; returns credit it back.
    const ledger = (
      await pool.query(
        `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS net
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.branch_id = $2 AND a.account_type = 'asset'
            AND (a.account_code = '1300' OR a.account_name ILIKE '%inventory%' OR a.account_name ILIKE '%stock%')
            AND l.entry_date BETWEEN '2026-09-01' AND '2026-09-30'`,
        [B, BR]
      )
    ).rows[0].net;
    expect(ledger).toBeCloseTo(res.json.totals.purchases, 2);

    const month = await report(summary, `/api/reports/purchase/summary?${SEP}&period=month&branch_id=${BR}`);
    expect(month.json.summary).toEqual([expect.objectContaining({ period: '2026-09-01', purchases: 8160, bill_count: 3 })]);
  });

  test('bill details lists every bill with its status; totals cover posted bills only', async () => {
    const res = await report(invoiceWise, `/api/reports/purchase/invoice-wise?${SEP}&branch_id=${BR}`);
    expect(res.status).toBe(200);
    const statuses = Object.fromEntries(res.json.purchases.map((p: any) => [p.bill_number.replace(`-${tag}`, ''), p.status]));
    expect(statuses).toEqual({
      'QA-PR-P1': 'final', 'QA-PR-P2': 'final', 'QA-PR-P3': 'final', 'QA-PR-P4-VOID': 'cancelled', 'QA-PR-P6-DRAFT': 'draft',
    });
    expect(res.json.totals).toMatchObject({
      total_bills: 3, draft_count: 1, cancelled_count: 1, total_purchases: 8700, total_tax: 1176, total_purchases_with_tax: 9876,
      total_paid: 1000, total_pending: 8238.8,
    });
    const drafts = await report(invoiceWise, `/api/reports/purchase/invoice-wise?${SEP}&branch_id=${BR}&status=draft`);
    expect(drafts.json.purchases.map((p: any) => p.status)).toEqual(['draft']);
    expect((await report(invoiceWise, `/api/reports/purchase/invoice-wise?${SEP}&status=paid`)).status).toBe(400);
  });

  test('returns, credit purchases and tax-wise reports', async () => {
    const ret = await report(returnsReport, `/api/reports/purchase/returns?${SEP}&branch_id=${BR}`);
    expect(ret.status).toBe(200);
    expect(ret.json.totals).toMatchObject({ total_returns: 1, total_purchases: 540, total_tax: 97.2, total_amount: 637.2 });

    const credit = await report(creditReport, `/api/reports/purchase/credit?${SEP}&branch_id=${BR}`);
    expect(credit.status).toBe(200);
    const numbers = credit.json.creditPurchases.map((p: any) => p.bill_number.replace(`-${tag}`, '')).sort();
    expect(numbers).toEqual(['QA-PR-P1', 'QA-PR-P2', 'QA-PR-P3']);
    const p2 = credit.json.creditPurchases.find((p: any) => p.id === bill.P2);
    expect(p2).toMatchObject({ balance_amount: 1124, status_category: 'overdue' });

    const tax = await report(taxWise, `/api/reports/purchase/tax-wise?${SEP}&branch_id=${BR}`);
    expect(tax.status).toBe(200);
    const r18 = tax.json.taxWise.find((r: any) => r.tax_rate === 18);
    const r5 = tax.json.taxWise.find((r: any) => r.tax_rate === 5);
    expect(r18).toMatchObject({ total_quantity: 9, total_taxable_value: 5160, total_igst: 324, total_tax: 928.8 });
    expect(r5).toMatchObject({ total_quantity: 10, total_taxable_value: 3000, total_cgst: 75, total_sgst: 75, total_tax: 150 });
    expect(tax.json.totals).toMatchObject({ total_taxable_value: 8160, total_tax: 1078.8 });
  });

  test('no branch_id covers every branch; branch_id narrows to one', async () => {
    const all = await report(supplierWise, `/api/reports/purchase/supplier-wise?${SEP}`);
    expect(byId(all.json.suppliers, 'supplier_id', KA)).toMatchObject({ bill_count: 3, purchases: 6960 });
    const second = await report(summary, `/api/reports/purchase/summary?${SEP}&period=month&branch_id=${BR2}`);
    expect(second.json.totals).toMatchObject({ bill_count: 1, purchases: 600 });
    const items = await report(itemWise, `/api/reports/purchase/item-wise?${SEP}&branch_id=ALL`);
    expect(byId(items.json.items, 'item_id', GADGET)).toMatchObject({ quantity: 12, amount: 3600 });
  });

  test('invalid parameters are rejected', async () => {
    expect((await report(supplierWise, `/api/reports/purchase/supplier-wise?from_date=2026-09-30&to_date=2026-09-01`)).status).toBe(400);
    expect((await report(summary, `/api/reports/purchase/summary?from_date=30-09-2026`)).status).toBe(400);
    expect((await report(summary, `/api/reports/purchase/summary?period=year`)).status).toBe(400);
  });
});
