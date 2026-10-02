/**
 * Sales reports against the scenario run in Zoho Books (Tandoor Studio, prefix QA-SR,
 * docs/qa/reports-zoho-vs-khatario/03-sales-reports.md). Documents are created through the real
 * invoice / cancel / credit-note routes. Runs only when PHASE2_TEST_DATABASE_URL points at a
 * disposable database.
 *
 * Zoho, 1-30 Sep 2026 (QA-SR documents only):
 *   Sales by Customer  Cust KA  1 invoice  3,800 / 4,224 with tax  (S1 less CN1)
 *                      Cust MH  1 invoice  2,000 / 2,360 with tax
 *   Sales by Item      Widget qty 4  3,800  avg 950  |  Gadget qty 4  2,000  avg 500
 *   Draft S3, voided S4 and the August invoice S5 are excluded.
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
import { POST as postInvoice } from '@/app/api/invoices/route';
import { PATCH as cancelInvoice } from '@/app/api/invoices/[id]/cancel/route';
import { POST as postCreditNote } from '@/app/api/credit-notes/route';
import { GET as partyWise } from '@/app/api/reports/sales/party-wise/route';
import { GET as itemWise } from '@/app/api/reports/sales/item-wise/route';
import { GET as summary } from '@/app/api/reports/sales/summary/route';
import { GET as invoiceWise } from '@/app/api/reports/sales/invoice-wise/route';

d('Sales reports vs Zoho scenario (real DB)', () => {
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
  const inv: Record<string, string> = {};
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
    item_id: WIDGET, item_name: 'QA-SR Widget', hsn_sac: '847130', unit: 'PCS', quantity, unit_price: 1000, tax_rate: 18, ...extra,
  });
  const gadget = (quantity: number) => ({
    item_id: GADGET, item_name: 'QA-SR Gadget', hsn_sac: '847130', unit: 'PCS', quantity, unit_price: 500, tax_rate: 5,
  });

  async function invoice(key: string, customer: string, pos: string, date: string, items: unknown[], status = 'final', branch = BR) {
    const res = await call(
      postInvoice(
        req('/api/invoices', 'POST', {
          branch_id: branch, customer_id: customer, invoice_date: date, due_date: date, items, status,
          document_type: 'tax_invoice', place_of_supply_state_code: pos, reference_number: `QA-SR-${key}`,
          backdate_reason: 'Zoho comparison scenario',
        })
      )
    );
    if (res.status !== 201 && res.status !== 200) throw new Error(`invoice ${key}: ${res.status} ${JSON.stringify(res.json)}`);
    const id = res.json.invoice?.id ?? res.json.id;
    inv[key] = id;
    return id as string;
  }

  const report = (fn: (r: NextRequest) => Promise<Response>, p: string) => call(fn(req(p)));
  const byId = (rows: any[], key: string, id: string) => rows.find((r) => r[key] === id);

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '29AAGCQ4321A1ZS', '29', 'regular')`,
      [B, `SalesRpt ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $3, 'Main', '29', true, true, true), ($2, $3, 'Second', '29', false, false, true)`,
      [BR, BR2, B]
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`, [
      U,
      B,
      `94${Date.now().toString().slice(-8)}`,
    ]);
    await pool.query(`UPDATE users SET auth_session_version = 1 WHERE id = $1`, [U]).catch(() => {});
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance)
       VALUES ($1, $3, 'QA-SR Cust KA', '29', 0), ($2, $3, 'QA-SR Cust MH', '27', 0)`,
      [KA, MH, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1, $3, 'QA-SR Widget', 'goods', 'PCS', 1000, 600, 18, '847130'),
              ($2, $3, 'QA-SR Gadget', 'goods', 'PCS', 500, 300, 5, '847130')`,
      [WIDGET, GADGET, B]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity)
       VALUES ($1, $2, $4, 100), ($1, $2, $5, 100), ($1, $3, $4, 100), ($1, $3, $5, 100)`,
      [B, BR, BR2, WIDGET, GADGET]
    );

    await invoice('S1', KA, '29', '2026-09-05', [widget(3, { discount_percent: 10 }), gadget(4)]);
    await invoice('S2', MH, '27', '2026-09-12', [widget(2)]);
    await invoice('S3-DRAFT', KA, '29', '2026-09-20', [widget(5)], 'draft');
    await invoice('S4-VOID', KA, '29', '2026-09-22', [gadget(10)]);
    const cancelled = await call(cancelInvoice(req(`/api/invoices/${inv['S4-VOID']}/cancel`, 'PATCH', { reason: 'Void' }), { params: { id: inv['S4-VOID'] } }));
    expect(cancelled.status).toBe(200);
    await invoice('S5-AUG', MH, '27', '2026-08-25', [widget(1)]);

    const cn = await call(
      postCreditNote(
        req('/api/credit-notes', 'POST', {
          branch_id: BR, customer_id: KA, invoice_id: inv.S1, credit_note_number: `QA-SR-CN1-${tag}`,
          credit_note_date: '2026-09-25', reason: 'Sales return',
          items: [{ item_id: WIDGET, item_name: 'QA-SR Widget', hsn_sac: '847130', qty: 1, unit_price: 900, tax_rate: 18 }],
        })
      )
    );
    if (cn.status !== 201 && cn.status !== 200) throw new Error(`credit note: ${cn.status} ${JSON.stringify(cn.json)}`);

    // Not in the Zoho scenario: a second-branch sale to exercise the branch filter.
    await invoice('BR2-S1', KA, '29', '2026-09-15', [gadget(1)], 'final', BR2);
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

  test('invoice and credit note totals match the Zoho documents', async () => {
    const rows = (
      await pool.query(`SELECT reference_number, subtotal::float8, tax_total::float8, grand_total::float8 FROM invoices WHERE business_id = $1`, [B])
    ).rows;
    const by = Object.fromEntries(rows.map((r) => [r.reference_number, r]));
    expect(by['QA-SR-S1']).toMatchObject({ subtotal: 4700, tax_total: 586, grand_total: 5286 });
    expect(by['QA-SR-S2']).toMatchObject({ subtotal: 2000, tax_total: 360, grand_total: 2360 });
    const cn = (await pool.query(`SELECT subtotal::float8, tax_total::float8, grand_total::float8 FROM credit_notes WHERE business_id = $1`, [B])).rows[0];
    expect(cn).toEqual({ subtotal: 900, tax_total: 162, grand_total: 1062 });
  });

  test('sales by customer is net of credit notes and excludes draft, void and out-of-range invoices', async () => {
    const res = await report(partyWise, `/api/reports/sales/party-wise?${SEP}&branch_id=${BR}`);
    expect(res.status).toBe(200);
    expect(byId(res.json.parties, 'customer_id', KA)).toMatchObject({
      customer_name: 'QA-SR Cust KA',
      invoice_count: 1,
      credit_note_count: 1,
      invoice_sales: 4700,
      credit_note_sales: 900,
      sales: 3800,
      sales_with_tax: 4224,
      tax: 424,
    });
    expect(byId(res.json.parties, 'customer_id', MH)).toMatchObject({ invoice_count: 1, sales: 2000, sales_with_tax: 2360 });
    expect(res.json.parties).toHaveLength(2);
    expect(res.json.totals).toMatchObject({ invoice_count: 2, sales: 5800, sales_with_tax: 6584, tax: 784 });
  });

  test('sales by item nets returned quantity and value, excluding GST', async () => {
    const res = await report(itemWise, `/api/reports/sales/item-wise?${SEP}&branch_id=${BR}`);
    expect(res.status).toBe(200);
    expect(byId(res.json.items, 'item_id', WIDGET)).toMatchObject({
      item_name: 'QA-SR Widget',
      quantity_invoiced: 5,
      quantity_returned: 1,
      quantity_sold: 4,
      amount: 3800,
      average_price: 950,
      discount: 300,
    });
    expect(byId(res.json.items, 'item_id', GADGET)).toMatchObject({ quantity_sold: 4, amount: 2000, average_price: 500 });
    expect(res.json.items).toHaveLength(2);
    expect(res.json.totals).toMatchObject({ quantity_sold: 8, amount: 5800 });
  });

  test('sales summary nets credit notes by day and its total equals the Sales ledger movement', async () => {
    const res = await report(summary, `/api/reports/sales/summary?${SEP}&period=day&branch_id=${BR}`);
    expect(res.status).toBe(200);
    const day = Object.fromEntries(res.json.summary.map((r: any) => [r.period, r]));
    expect(day['2026-09-05']).toMatchObject({ invoice_count: 1, invoice_sales: 4700, sales: 4700 });
    expect(day['2026-09-12']).toMatchObject({ invoice_count: 1, sales: 2000, tax: 360 });
    expect(day['2026-09-25']).toMatchObject({ invoice_count: 0, credit_note_count: 1, credit_note_sales: 900, sales: -900, sales_with_tax: -1062 });
    expect(day['2026-09-22']).toBeUndefined();
    expect(res.json.totals).toMatchObject({ sales: 5800, tax: 784, sales_with_tax: 6584 });

    const ledger = (
      await pool.query(
        `SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS net
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.branch_id = $2 AND a.account_code = '4101'
            AND l.entry_date BETWEEN '2026-09-01' AND '2026-09-30'`,
        [B, BR]
      )
    ).rows[0].net;
    expect(ledger).toBeCloseTo(res.json.totals.sales, 2);

    const month = await report(summary, `/api/reports/sales/summary?${SEP}&period=month&branch_id=${BR}`);
    expect(month.json.summary).toEqual([expect.objectContaining({ period: '2026-09-01', sales: 5800, invoice_count: 2 })]);
  });

  test('invoice details lists every invoice with its status; totals cover posted invoices only', async () => {
    const res = await report(invoiceWise, `/api/reports/sales/invoice-wise?${SEP}&branch_id=${BR}`);
    expect(res.status).toBe(200);
    const statuses = Object.fromEntries(res.json.invoices.map((i: any) => [i.reference_number, i.status]));
    expect(statuses).toEqual({ 'QA-SR-S1': 'final', 'QA-SR-S2': 'final', 'QA-SR-S3-DRAFT': 'draft', 'QA-SR-S4-VOID': 'cancelled' });
    expect(res.json.totals).toMatchObject({
      total_invoices: 2, draft_count: 1, cancelled_count: 1, total_sales: 6700, total_tax: 946, total_sales_with_tax: 7646,
    });
    const drafts = await report(invoiceWise, `/api/reports/sales/invoice-wise?${SEP}&branch_id=${BR}&status=draft`);
    expect(drafts.json.invoices.map((i: any) => i.reference_number)).toEqual(['QA-SR-S3-DRAFT']);
    expect((await report(invoiceWise, `/api/reports/sales/invoice-wise?${SEP}&status=paid`)).status).toBe(400);
  });

  test('no branch_id covers every branch; branch_id narrows to one', async () => {
    const all = await report(partyWise, `/api/reports/sales/party-wise?${SEP}`);
    expect(byId(all.json.parties, 'customer_id', KA)).toMatchObject({ invoice_count: 2, sales: 4300 });
    const second = await report(summary, `/api/reports/sales/summary?${SEP}&period=month&branch_id=${BR2}`);
    expect(second.json.totals).toMatchObject({ invoice_count: 1, sales: 500 });
    const items = await report(itemWise, `/api/reports/sales/item-wise?${SEP}&branch_id=ALL`);
    expect(byId(items.json.items, 'item_id', GADGET)).toMatchObject({ quantity_sold: 5, amount: 2500 });
  });

  test('invalid dates are rejected', async () => {
    expect((await report(partyWise, `/api/reports/sales/party-wise?from_date=2026-09-30&to_date=2026-09-01`)).status).toBe(400);
    expect((await report(summary, `/api/reports/sales/summary?from_date=30-09-2026`)).status).toBe(400);
    expect((await report(summary, `/api/reports/sales/summary?period=year`)).status).toBe(400);
  });
});
