/**
 * F-008: short and damaged goods on a received Supplier Hub bill, per business setting.
 * Wholesaler W bills retailer R for 10 oil tins at 100 + 18% GST (1180).
 * - keep (default): all 10 go into stock; the receipt records the damaged tin and R's later
 *   purchase return takes it out once.
 * - auto_return: receiving raises debit note DN-<bill> for short + damaged through the same code
 *   as POST /api/purchase-returns, so stock, supplier balance, ledger and GST move together,
 *   and a later manual return cannot take the same tins out again.
 * Writes only after current_database() is kh_phase2_test on port 5433:
 *   npx jest tests/db/supplier-bill-shortfall.db.test.ts --runInBand
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

function readEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[match[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing supplier bill tests: database host is not local');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
  process.env.DB_SSL = 'false';
}

forceDisposableDatabase();

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
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
// WhatsApp to the supplier is queued, never flushed, in tests.
jest.mock('@/lib/supplier-hub-whatsapp', () => ({
  queueHubWhatsApp: jest.fn().mockResolvedValue(undefined),
  scheduleHubWhatsAppFlush: jest.fn(),
  flushHubWhatsApp: jest.fn().mockResolvedValue({ sent: 0, skipped: 0 }),
}));
jest.mock('@/lib/platform-whatsapp-send', () => ({
  lookupTenantWhatsAppPhone: jest.fn().mockResolvedValue(null),
  sendPlatformEventWhatsApp: jest.fn().mockResolvedValue({ sent: false, skipped: 'test' }),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as convertInvoice } from '@/app/api/invoices/[id]/convert-to-purchase/route';
import { POST as postReturn } from '@/app/api/purchase-returns/route';
import { GET as getMode, PATCH as patchMode } from '@/app/api/settings/receipt-shortfall/route';
import { GET as incomingBillGET } from '@/app/api/purchases/incoming-bills/[invoiceId]/route';
import { GET as trialBalance } from '@/app/api/reports/trial-balance/route';

const migration = (file: string) =>
  fs.readFileSync(path.join(__dirname, '../../database/migrations', file), 'utf8');

describe('Supplier Hub receipt: short and damaged goods (F-008, kh_phase2_test)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const [R, W] = [randomUUID(), randomUUID()];
  const [UR, UW] = [randomUUID(), randomUUID()];
  const [BR_R, BR_W] = [randomUUID(), randomUUID()];
  const SUP = randomUUID(); // R's supplier record for W
  const CUST = randomUUID(); // W's customer record for R
  const [ITEM_R, ITEM_W] = [randomUUID(), randomUUID()];

  const headers = (user: string, biz: string) => ({
    'content-type': 'application/json',
    'x-authenticated-user-id': user,
    'x-authenticated-business-id': biz,
    'x-authenticated-session-version': '1',
  });
  const req = (method: string, url: string, body?: object) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: headers(UR, R),
      body: body ? JSON.stringify(body) : undefined,
    });

  async function assertDb(client: Pool | PoolClient) {
    const info = (
      await client.query<{ db: string; port: number; addr: string }>(
        `SELECT current_database() AS db, inet_server_port() AS port, inet_server_addr()::text AS addr`
      )
    ).rows[0];
    const addr = info.addr || '';
    const local = addr.startsWith('127.') || addr.startsWith('::1') || addr === '';
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !local) {
      throw new Error(`Refusing to mutate ${info.db} on ${info.addr}:${info.port}`);
    }
  }

  /** W's final bill to R: 10 tins at 100, CGST 9% + SGST 9%. */
  async function billTenTins(number: string): Promise<{ invoiceId: string; lineId: string }> {
    const invoiceId = randomUUID();
    const lineId = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '29', 1000, 180, 90, 90, 0, 1180, 0, 1180, 'unpaid', $5)`,
      [invoiceId, W, CUST, number, BR_W]
    );
    await pool.query(
      `INSERT INTO invoice_items (id, invoice_id, item_id, item_name, hsn_sac, quantity, unit, unit_price,
          tax_rate, tax_amount, taxable_value, cgst_amount, sgst_amount, igst_amount, line_total, sort_order)
       VALUES ($1, $2, $3, 'Groundnut Oil Tin 15L', '1508', 10, 'PCS', 100, 18, 180, 1000, 90, 90, 0, 1180, 0)`,
      [lineId, invoiceId, ITEM_W]
    );
    return { invoiceId, lineId };
  }

  const stockOf = async () =>
    Number(
      (
        await pool.query(`SELECT quantity FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`, [
          R,
          BR_R,
          ITEM_R,
        ])
      ).rows[0]?.quantity
    );
  const supplierBalance = async () =>
    Number((await pool.query(`SELECT current_balance FROM suppliers WHERE id = $1`, [SUP])).rows[0].current_balance);
  const expectTrialBalanceBalanced = async () => {
    const qs = new URLSearchParams({ as_on_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });
    const res = await trialBalance(
      new NextRequest(`http://localhost/api/reports/trial-balance?${qs}`, { headers: headers(UR, R) })
    );
    expect(res.status).toBe(200);
    const tb: any = await res.json();
    expect(tb.totals.total_debit).toBeCloseTo(tb.totals.total_credit, 2);
    expect(tb.is_balanced).toBe(true);
    return tb;
  };
  const convert = (invoiceId: string, body: object) =>
    convertInvoice(req('POST', `/api/invoices/${invoiceId}/convert-to-purchase`, body), { params: { id: invoiceId } });

  beforeAll(async () => {
    pool = getPool();
    await assertDb(pool);
    for (const file of [
      '389_purchase_source_invoice.sql',
      '390_supplier_hub_links.sql',
      '391_supplier_item_links.sql',
      '392_supplier_bill_receipts.sql',
      '393_supply_orders.sql',
      '428_supplier_hub_money_notices.sql',
      '429_hub_backup_standing_variants.sql',
    ]) {
      await pool.query(migration(file));
    }
    for (const [biz, user, branch, name, gstin] of [
      [R, UR, BR_R, `QA Retailer ${tag}`, `29AAACR${1000 + Math.floor(Math.random() * 9000)}A1Z5`],
      [W, UW, BR_W, `QA Wholesale ${tag}`, null],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '29', 'regular')`,
        [biz, name, gstin]
      );
      await pool.query(
        `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
         VALUES ($1, $2, 'Main', '29', true, true, true)`,
        [branch, biz]
      );
      await pool.query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
        [user, biz, `9${randomUUID().replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`]
      );
      await pool.query(`UPDATE users SET auth_session_version = 1, is_active = true WHERE id = $1`, [user]);
      await pool.query(`SELECT create_default_chart_of_accounts($1)`, [biz]);
      await pool.query(`SELECT ensure_standard_account_heads($1)`, [biz]);
      await pool.query(
        `INSERT INTO business_settings (business_id, warehouses_enabled, inventory_model)
         VALUES ($1, false, 'perpetual')
         ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = false, inventory_model = 'perpetual'`,
        [biz]
      );
    }
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, linked_business_id, approval_status, current_balance)
       VALUES ($1, $2, 'QA Wholesale', '29', $3, 'approved', 0)`,
      [SUP, R, W]
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, linked_business_id) VALUES ($1, $2, 'QA Retailer', '29', $3)`,
      [CUST, W, R]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, item_type, tax_rate, hsn_sac, current_stock, is_active)
       VALUES ($1, $2, 'Groundnut Oil Tin 15L', 'PCS', 'goods', 18, '1508', 0, true),
              ($3, $4, 'Groundnut Oil Tin 15L', 'PCS', 'goods', 18, '1508', 500, true)`,
      [ITEM_R, R, ITEM_W, W]
    );
    await pool.query(`INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 0)`, [
      R,
      BR_R,
      ITEM_R,
    ]);
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assertDb(client);
      await client.query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[R, W]]);
      await withLedgerDelete(client, 'tenant_purge', UR, async () => {
        await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[R, W]]);
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
      await closePool();
    }
  });

  it('the setting defaults to keep and only takes keep or auto_return', async () => {
    expect(await (await getMode(req('GET', '/api/settings/receipt-shortfall'))).json()).toEqual({ mode: 'keep' });
    const bad = await patchMode(req('PATCH', '/api/settings/receipt-shortfall', { mode: 'hold' }));
    expect(bad.status).toBe(400);
  });

  it('keep: all billed tins go into stock and a later purchase return takes the damaged one out once', async () => {
    const { invoiceId, lineId } = await billTenTins(`KEEP-${tag}`);
    const detail = await (
      await incomingBillGET(req('GET', `/api/purchases/incoming-bills/${invoiceId}`), { params: { invoiceId } })
    ).json();
    expect(detail.shortfall_mode).toBe('keep');

    const res = await convert(invoiceId, { received: { [lineId]: { damaged_qty: 1, note: 'dented' } } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.shortfall_mode).toBe('keep');
    expect(body.purchase_return).toBeNull();
    expect(body.receipt.status).toBe('received_with_issues');
    expect(await stockOf()).toBe(10);
    expect(await supplierBalance()).toBe(1180);
    const returns = await pool.query(`SELECT id FROM purchase_returns WHERE purchase_id = $1`, [body.purchase.id]);
    expect(returns.rows).toHaveLength(0);

    // The receipt's damaged tin, returned by hand later.
    const manual = await postReturn(
      req('POST', '/api/purchase-returns', {
        purchase_id: body.purchase.id,
        return_number: `PR-KEEP-${tag}`,
        return_date: new Date().toISOString().slice(0, 10),
        items: [{ item_id: ITEM_R, qty: 1 }],
      })
    );
    expect(manual.status).toBe(201);
    expect(await stockOf()).toBe(9);
    expect(await supplierBalance()).toBe(1062);
    await expectTrialBalanceBalanced();
  });

  it('auto_return: receiving raises the debit note for short + damaged; stock, balance, GST and ledger move together', async () => {
    const saved = await patchMode(req('PATCH', '/api/settings/receipt-shortfall', { mode: 'auto_return' }));
    expect(await saved.json()).toEqual({ mode: 'auto_return' });
    expect(await (await getMode(req('GET', '/api/settings/receipt-shortfall'))).json()).toEqual({ mode: 'auto_return' });

    const { invoiceId, lineId } = await billTenTins(`AUTO-${tag}`);
    const detail = await (
      await incomingBillGET(req('GET', `/api/purchases/incoming-bills/${invoiceId}`), { params: { invoiceId } })
    ).json();
    expect(detail.shortfall_mode).toBe('auto_return');

    const stockBefore = await stockOf();
    const balanceBefore = await supplierBalance();
    const res = await convert(invoiceId, {
      received: { [lineId]: { short_qty: 1, damaged_qty: 1, note: 'one tin leaking' } },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.shortfall_mode).toBe('auto_return');
    expect(body.purchase_return).toMatchObject({ return_number: `DN-AUTO-${tag}`, purchase_id: body.purchase.id });

    // The purchase still matches the bill; the debit note takes 2 tins (200 + 36 GST) back.
    const purchaseLine = await pool.query(`SELECT quantity FROM purchase_items WHERE purchase_id = $1`, [body.purchase.id]);
    expect(Number(purchaseLine.rows[0].quantity)).toBe(10);
    const dn = (
      await pool.query(
        `SELECT pr.subtotal, pr.cgst_total, pr.sgst_total, pr.igst_total, pr.grand_total, pr.status, pr.supplier_id,
                pri.item_id, pri.qty
           FROM purchase_returns pr JOIN purchase_return_items pri ON pri.return_id = pr.id
          WHERE pr.id = $1`,
        [body.purchase_return.id]
      )
    ).rows;
    expect(dn).toHaveLength(1);
    expect(dn[0]).toMatchObject({ status: 'final', supplier_id: SUP, item_id: ITEM_R });
    expect(Number(dn[0].qty)).toBe(2);
    expect(Number(dn[0].subtotal)).toBe(200);
    expect(Number(dn[0].cgst_total)).toBe(18);
    expect(Number(dn[0].sgst_total)).toBe(18);
    expect(Number(dn[0].igst_total)).toBe(0);
    expect(Number(dn[0].grand_total)).toBe(236);

    expect((await stockOf()) - stockBefore).toBe(8);
    expect((await supplierBalance()) - balanceBefore).toBe(944);
    const bill = await pool.query(`SELECT balance_amount FROM purchases WHERE id = $1`, [body.purchase.id]);
    expect(Number(bill.rows[0].balance_amount)).toBe(944);
    // The debit note's own voucher balances, with 36 of input GST reversed.
    const voucher = (
      await pool.query(
        `SELECT SUM(l.debit)::float8 AS dr, SUM(l.credit)::float8 AS cr,
                SUM(CASE WHEN a.account_name ILIKE '%input%gst%' OR a.account_name ILIKE '%input%cgst%'
                           OR a.account_name ILIKE '%input%sgst%' THEN l.credit - l.debit ELSE 0 END)::float8 AS itc
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_id = $2`,
        [R, body.purchase_return.id]
      )
    ).rows[0];
    expect(voucher.dr).toBeGreaterThan(0);
    expect(voucher.dr).toBeCloseTo(voucher.cr, 2);
    expect(voucher.itc).toBeCloseTo(36, 2);
    await expectTrialBalanceBalanced();

    // The supplier is told the debit note was raised, and gets the money notice for it.
    const note = await pool.query(
      `SELECT message FROM notifications WHERE business_id = $1 AND reference_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [W, invoiceId]
    );
    expect(note.rows[0].message).toContain(`Debit note DN-AUTO-${tag} has been raised`);
    const notice = await pool.query(
      `SELECT amount FROM supplier_hub_money_notices WHERE kind = 'debit_note' AND source_id = $1`,
      [body.purchase_return.id]
    );
    expect(Number(notice.rows[0]?.amount)).toBe(236);

    // A second conversion is still refused, and adds no second debit note.
    const again = await convert(invoiceId, {
      received: { [lineId]: { short_qty: 1, damaged_qty: 1 } },
    });
    expect(again.status).toBe(400);
    expect((await again.json()).purchase_id).toBe(body.purchase.id);
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM purchase_returns WHERE purchase_id = $1`, [body.purchase.id]);
    expect(count.rows[0].n).toBe(1);

    // The 2 tins are already returned: a manual return can only take the 8 that arrived.
    const twice = await postReturn(
      req('POST', '/api/purchase-returns', {
        purchase_id: body.purchase.id,
        return_number: `PR-AUTO-${tag}`,
        return_date: new Date().toISOString().slice(0, 10),
        items: [{ item_id: ITEM_R, qty: 9 }],
      })
    );
    expect(twice.status).toBe(400);
    expect((await twice.json()).code).toBe('RETURN_EXCEEDS_PURCHASED');
    expect((await stockOf()) - stockBefore).toBe(8);
  });

  it('auto_return with nothing short or damaged raises no debit note', async () => {
    const { invoiceId } = await billTenTins(`FULL-${tag}`);
    const stockBefore = await stockOf();
    const res = await convert(invoiceId, {});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.purchase_return).toBeNull();
    expect(body.receipt.status).toBe('received');
    expect((await stockOf()) - stockBefore).toBe(10);
  });
});
