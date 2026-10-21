/**
 * Phase 1 sales freight. Posts through POST /api/invoices.
 * Connects only after current_database() is kh_phase2_test on localhost.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

function readEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing invoice tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing invoice tests: local database credentials are missing');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

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
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { GSTR1Generator } from '@/lib/gst/gstr1';
import { POST as postInvoice } from '@/app/api/invoices/route';
import { GET as getInvoice } from '@/app/api/invoices/[id]/route';
import { POST as convertProforma } from '@/app/api/invoices/[id]/convert-to-tax-invoice/route';
import { POST as convertOrder } from '@/app/api/sales-orders/[id]/convert/route';
import { POST as convertEstimate } from '@/app/api/estimates/[id]/convert/route';
import { createCreditNoteInTransaction } from '@/lib/credit-notes/create-credit-note';
import { runRecurringInvoices } from '@/lib/invoices/recurring';
import { loadOrderLineRefs } from '@/lib/fulfilment/parcel-items';
import { salesByItem } from '@/lib/reports/sales-reports';

const INVOICE_DATE = '2026-10-09';

describe('Phase 1 sales invoice charges (kh_phase2_test)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const CUST = randomUUID();
  const ITEM = randomUUID();
  const ITEM5 = randomUUID();
  const tag = B.slice(0, 8);

  function req(body: unknown) {
    return new NextRequest('http://localhost/api/invoices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-authenticated-user-id': A,
        'x-authenticated-business-id': B,
      },
      body: JSON.stringify(body),
    });
  }

  async function call(res: Response | Promise<Response>) {
    const r = await res;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json: json as Record<string, any> };
  }

  function goods(itemId: string, price: number, rate: number, name: string) {
    return {
      item_id: itemId,
      item_name: name,
      quantity: 1,
      unit: 'NOS',
      unit_price: price,
      tax_rate: rate,
      hsn_sac: '6109',
    };
  }

  async function invoiceCount() {
    const row = (
      await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`,
        [B]
      )
    ).rows[0];
    return row.n;
  }

  async function header(id: string) {
    return (
      await pool.query(
        `SELECT subtotal::float8 AS subtotal, additional_charges::float8 AS additional_charges,
                tax_total::float8 AS tax, cgst_total::float8 AS cgst, sgst_total::float8 AS sgst,
                igst_total::float8 AS igst, grand_total::float8 AS grand, balance_amount::float8 AS balance,
                COALESCE(charges_included, false) AS charges_included
           FROM invoices WHERE id = $1 AND business_id = $2`,
        [id, B]
      )
    ).rows[0];
  }

  async function ledger(voucherId: string) {
    const rows = (
      await pool.query<{ account_code: string; debit: string; credit: string }>(
        `SELECT a.account_code, SUM(l.debit)::text AS debit, SUM(l.credit)::text AS credit
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_id = $2
          GROUP BY a.account_code`,
        [B, voucherId]
      )
    ).rows;
    const map = new Map<string, { debit: number; credit: number }>();
    for (const row of rows) map.set(row.account_code, { debit: Number(row.debit), credit: Number(row.credit) });
    return map;
  }

  async function gstrTaxable(rate: number) {
    const data = await new GSTR1Generator().generate({
      business_id: B,
      from_date: INVOICE_DATE,
      to_date: INVOICE_DATE,
    });
    const rows = (data.b2cs || []).filter((r) => Number(r.rate) === rate);
    return rows.reduce((sum, r) => sum + Number(r.taxable_value), 0);
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string | null; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.db}`);
    if (info.port !== 5433 || (info.addr !== '::1/128' && info.addr !== '127.0.0.1/32' && info.addr !== '127.0.0.1')) {
      throw new Error('Refusing to mutate a database that is not the local disposable server');
    }
    const gst = `27AABCU${tag.slice(0, 4).toUpperCase()}C1Z5`;
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type)
       VALUES ($1,$2,$3,'27','Maharashtra','regular')`,
      [B, `Phase1 freight ${tag}`, gst]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1,$2,'Main','27',true,true,true)`,
      [BR, B]
    );
    const phone = `${Date.now()}`.slice(-9);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1,$2,'Clerk',$3,true)`,
      [A, B, `8${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, phone)
       VALUES ($1,$2,'Asha','27',0,$3)`,
      [CUST, B, `7${phone}`]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,'Cotton','goods','NOS',10000,4000,18,'6109'),
              ($3,$2,'Thread','goods','NOS',5000,1000,5,'5208')`,
      [ITEM, B, ITEM5]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,100), ($1,$2,$4,100)`,
      [B, BR, ITEM, ITEM5]
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled) VALUES ($1, false)
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = false`,
      [B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await withLedgerDelete(c, 'tenant_purge', A, async () => {
        await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
      });
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
      await closePool();
    }
  });

  test('a bare additional charge is rejected and writes nothing', async () => {
    const before = await invoiceCount();
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          additional_charges: 1000,
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('CHARGE_UNCLASSIFIED');
    expect(await invoiceCount()).toBe(before);
  });

  test('freight that follows the goods is in the saved total, the ledger, the customer and GSTR-1', async () => {
    const beforeTaxable = await gstrTaxable(18);
    const beforeBalance = Number(
      (await pool.query(`SELECT current_balance::float8 AS b FROM customers WHERE id = $1`, [CUST])).rows[0].b
    );
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    const saved = await header(id);
    expect(saved.subtotal).toBeCloseTo(11000, 2);
    expect(saved.tax).toBeCloseTo(1980, 2);
    expect(saved.cgst).toBeCloseTo(990, 2);
    expect(saved.sgst).toBeCloseTo(990, 2);
    expect(saved.igst).toBeCloseTo(0, 2);
    expect(saved.grand).toBeCloseTo(12980, 2);
    expect(saved.balance).toBeCloseTo(12980, 2);
    expect(saved.charges_included).toBe(true);
    const lines = (
      await pool.query(
        `SELECT taxable_value::float8 AS taxable, tax_amount::float8 AS tax
           FROM invoice_items WHERE invoice_id = $1`,
        [id]
      )
    ).rows;
    expect(lines.reduce((s, r) => s + Number(r.taxable), 0)).toBeCloseTo(11000, 2);
    const books = await ledger(id);
    expect(books.get('1103')).toEqual({ debit: 12980, credit: 0 });
    expect(books.get('4101')).toEqual({ debit: 0, credit: 11000 });
    expect(books.get('2150')).toEqual({ debit: 0, credit: 990 });
    expect(books.get('2151')).toEqual({ debit: 0, credit: 990 });
    const balance = Number(
      (await pool.query(`SELECT current_balance::float8 AS b FROM customers WHERE id = $1`, [CUST])).rows[0].b
    );
    expect(balance - beforeBalance).toBeCloseTo(12980, 2);
    expect((await gstrTaxable(18)) - beforeTaxable).toBeCloseTo(11000, 2);
  });

  test('freight on two rates is split by taxable value, not blended into one rate', async () => {
    const before5 = await gstrTaxable(5);
    const before18 = await gstrTaxable(18);
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM5, 5000, 5, 'Thread'), goods(ITEM, 5000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    const saved = await header(id);
    expect(saved.subtotal).toBeCloseTo(11000, 2);
    expect(saved.tax).toBeCloseTo(1265, 2);
    expect(saved.grand).toBeCloseTo(12265, 2);
    const lines = (
      await pool.query<{ tax_rate: string; taxable: string }>(
        `SELECT tax_rate::text, taxable_value::text AS taxable FROM invoice_items WHERE invoice_id = $1 ORDER BY tax_rate::numeric`,
        [id]
      )
    ).rows;
    expect(lines.map((r) => ({ rate: Number(r.tax_rate), taxable: Number(r.taxable) }))).toEqual([
      { rate: 5, taxable: 5500 },
      { rate: 18, taxable: 5500 },
    ]);
    expect((await gstrTaxable(5)) - before5).toBeCloseTo(5500, 2);
    expect((await gstrTaxable(18)) - before18).toBeCloseTo(5500, 2);
  });

  test('an inter-state freight charge is IGST on the goods rate', async () => {
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '29',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(201);
    const saved = await header(res.json.invoice.id);
    expect(saved.igst).toBeCloseTo(1980, 2);
    expect(saved.cgst).toBeCloseTo(0, 2);
    expect(saved.sgst).toBeCloseTo(0, 2);
    expect(saved.grand).toBeCloseTo(12980, 2);
    const books = await ledger(res.json.invoice.id);
    expect(books.get('2152')).toEqual({ debit: 0, credit: 1980 });
    expect(books.get('2150')).toBeUndefined();
  });

  test('a separate supply keeps its own rate and is not taxed at the goods rate', async () => {
    const before18 = await gstrTaxable(18);
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [
            {
              purpose: 'Installation',
              amount: 1000,
              classification: 'separate_supply',
              hsn_sac: '9987',
              tax_rate: 18,
            },
          ],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(201);
    const saved = await header(res.json.invoice.id);
    expect(saved.subtotal).toBeCloseTo(11000, 2);
    expect(saved.tax).toBeCloseTo(1980, 2);
    expect(saved.grand).toBeCloseTo(12980, 2);
    expect((await gstrTaxable(18)) - before18).toBeCloseTo(11000, 2);
  });

  test('a separate supply without a rate or HSN is rejected', async () => {
    const before = await invoiceCount();
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Installation', amount: 1000, classification: 'separate_supply' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('CHARGE_SEPARATE_INCOMPLETE');
    expect(await invoiceCount()).toBe(before);
  });

  test('an already posted invoice is not retaxed in GSTR-1', async () => {
    const before = await gstrTaxable(18);
    const oldId = randomUUID();
    await pool.query(
      `INSERT INTO invoices (
         id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, payment_status,
         place_of_supply_state_code, subtotal, additional_charges, tax_total, cgst_total, sgst_total, igst_total,
         grand_total, balance_amount, document_type
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'final','unpaid','27',10000,1000,1800,900,900,0,12800,12800,'tax_invoice'
       )`,
      [oldId, B, BR, CUST, `OLD-${tag}`, INVOICE_DATE]
    );
    await pool.query(
      `INSERT INTO invoice_items (
         invoice_id, item_id, item_name, hsn_sac, quantity, unit, unit_price, tax_rate, tax_amount,
         taxable_value, cgst_amount, sgst_amount, igst_amount, line_total
       ) VALUES ($1,$2,'Cotton','6109',1,'NOS',10000,18,1800,10000,900,900,0,11800)`,
      [oldId, ITEM]
    );
    expect((await gstrTaxable(18)) - before).toBeCloseTo(10000, 2);
    const saved = await header(oldId);
    expect(saved.grand).toBeCloseTo(12800, 2);
    expect(saved.subtotal).toBeCloseTo(10000, 2);
    const oldNote = randomUUID();
    await pool.query(
      `INSERT INTO credit_notes (
         id, business_id, branch_id, customer_id, invoice_id, credit_note_number, credit_note_date,
         subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,10000,1800,900,900,0,11800,'active')`,
      [oldNote, B, BR, CUST, oldId, `OLD-CN-${tag}`, INVOICE_DATE]
    );
    expect(Number((await pool.query(`SELECT grand_total::float8 AS g FROM credit_notes WHERE id = $1`, [oldNote])).rows[0].g)).toBe(11800);
  });

  test('ordinary installation at 5 percent under heading 9987 is rejected', async () => {
    const before = await invoiceCount();
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Installation', amount: 1000, classification: 'separate_supply', hsn_sac: '9987', tax_rate: 5 }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_GST_RATE');
    expect(await invoiceCount()).toBe(before);
  });

  test('a draft re-save keeps freight classification and totals', async () => {
    const created = await call(
      postInvoice(
        req({
          status: 'draft',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          notes: 'first',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(created.status).toBe(201);
    const id = created.json.invoice.id as string;
    const loaded = await getInvoice(
      new NextRequest(`http://localhost/api/invoices/${id}`, {
        headers: { 'x-authenticated-user-id': A, 'x-authenticated-business-id': B },
      }),
      { params: { id } }
    );
    const body = await loaded.json();
    expect(body.invoice.charges[0].classification).toBe('follows_goods');
    const again = await call(
      postInvoice(
        req({
          id,
          status: 'draft',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          notes: 'edited',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(again.status).toBeLessThan(300);
    const saved = await header(id);
    expect(saved.subtotal).toBeCloseTo(11000, 2);
    expect(saved.grand).toBeCloseTo(12980, 2);
    const rows = (
      await pool.query(
        `SELECT quantity::float8 AS quantity, COALESCE(charge_line, false) AS charge_line
           FROM invoice_items WHERE invoice_id = $1`,
        [id]
      )
    ).rows;
    expect(rows).toEqual([{ quantity: 1, charge_line: false }]);
    const charges = await pool.query(`SELECT classification FROM invoice_charges WHERE invoice_id = $1`, [id]);
    expect(charges.rows.map((r) => r.classification)).toEqual(['follows_goods']);
  });

  test('inclusive prices, export, bill of supply and a registered customer keep one taxable value', async () => {
    const inclusive = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          prices_include_gst: true,
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 11800, 18, 'Cotton')],
        })
      )
    );
    expect(inclusive.status).toBe(201);
    expect((await header(inclusive.json.invoice.id)).grand).toBeCloseTo(12980, 2);

    const exported = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          is_export: true,
          export_type: 'wop',
          place_of_supply_state_code: '96',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(exported.status).toBe(201);
    const exportHeader = await header(exported.json.invoice.id);
    expect(exportHeader.subtotal).toBeCloseTo(11000, 2);
    expect(exportHeader.tax).toBeCloseTo(0, 2);
    expect(exportHeader.grand).toBeCloseTo(11000, 2);

    const supply = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'bill_of_supply',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(supply.status).toBe(201);
    expect((await header(supply.json.invoice.id)).tax).toBeCloseTo(0, 2);
    expect((await header(supply.json.invoice.id)).subtotal).toBeCloseTo(11000, 2);

    const b2bId = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, gstin, current_balance, phone)
       VALUES ($1,$2,'Registered','27','27AAPFU0939F1ZV',0,$3)`,
      [b2bId, B, `6${Date.now().toString().slice(-9)}`]
    );
    const beforeB2b = (await new GSTR1Generator().generate({ business_id: B, from_date: INVOICE_DATE, to_date: INVOICE_DATE })).b2b.length;
    const b2b = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: b2bId,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM5, 5000, 5, 'Thread'), goods(ITEM, 5000, 18, 'Cotton')],
        })
      )
    );
    expect(b2b.status).toBe(201);
    const gstr = await new GSTR1Generator().generate({ business_id: B, from_date: INVOICE_DATE, to_date: INVOICE_DATE });
    const mine = gstr.b2b.filter((row) => row.invoice_id === b2b.json.invoice.id);
    expect(mine.map((row) => ({ rate: Number(row.rate), taxable: Number(row.taxable_value) }))).toEqual([
      { rate: 5, taxable: 5500 },
      { rate: 18, taxable: 5500 },
    ]);
    expect(gstr.b2b.length).toBeGreaterThan(beforeB2b);
  });

  test('a credit note reverses apportioned freight in the books and GSTR-1', async () => {
    const beforeBalance = Number((await pool.query(`SELECT current_balance::float8 AS b FROM customers WHERE id = $1`, [CUST])).rows[0].b);
    const beforeTaxable = await gstrTaxable(18);
    const stockBefore = Number((await pool.query(`SELECT quantity::float8 AS q FROM branch_item_stock WHERE item_id = $1 AND branch_id = $2`, [ITEM, BR])).rows[0].q);
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(201);
    const invoiceId = res.json.invoice.id as string;
    const client = await pool.connect();
    let noteId = '';
    try {
      await client.query('BEGIN');
      const note = await createCreditNoteInTransaction(client, {
        businessId: B,
        branchId: BR,
        userId: A,
        customerId: CUST,
        invoiceId,
        creditNoteNumber: `CN-${tag}-${Date.now().toString().slice(-6)}`,
        creditNoteDate: INVOICE_DATE,
        placeOfSupplyStateCode: '27',
        items: [{ item_id: ITEM, item_name: 'Cotton', qty: 1, unit_price: 10000, tax_rate: 18 }],
      });
      noteId = note.id;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const note = (await pool.query(`SELECT subtotal::float8 AS subtotal, tax_total::float8 AS tax, grand_total::float8 AS grand FROM credit_notes WHERE id = $1`, [noteId])).rows[0];
    expect(note.subtotal).toBeCloseTo(11000, 2);
    expect(note.tax).toBeCloseTo(1980, 2);
    expect(note.grand).toBeCloseTo(12980, 2);
    const books = await ledger(noteId);
    expect(books.get('1103')).toEqual({ debit: 0, credit: 12980 });
    expect(books.get('4101')).toEqual({ debit: 11000, credit: 0 });
    expect(books.get('2150')).toEqual({ debit: 990, credit: 0 });
    expect(books.get('2151')).toEqual({ debit: 990, credit: 0 });
    const balance = Number((await pool.query(`SELECT current_balance::float8 AS b FROM customers WHERE id = $1`, [CUST])).rows[0].b);
    expect(balance - beforeBalance).toBeCloseTo(0, 2);
    expect((await gstrTaxable(18)) - beforeTaxable).toBeCloseTo(0, 2);
    const stockAfter = Number((await pool.query(`SELECT quantity::float8 AS q FROM branch_item_stock WHERE item_id = $1 AND branch_id = $2`, [ITEM, BR])).rows[0].q);
    expect(stockAfter).toBeCloseTo(stockBefore, 3);
    const old = (await pool.query(`SELECT grand_total::float8 AS g FROM credit_notes WHERE credit_note_number = $1`, [`OLD-CN-${tag}`])).rows[0];
    expect(old.g).toBe(11800);
  });

  test('an unclassified order or estimate is not marked converted', async () => {
    const orderId = randomUUID();
    await pool.query(
      `INSERT INTO sales_orders (
         id, business_id, branch_id, customer_id, order_number, order_date, status,
         subtotal, tax_total, grand_total, additional_charges, place_of_supply_state_code
       ) VALUES ($1,$2,$3,$4,$5,$6,'confirmed',10000,1800,12800,1000,'27')`,
      [orderId, B, BR, CUST, `SO-${tag}`, INVOICE_DATE]
    );
    await pool.query(
      `INSERT INTO sales_order_items (sales_order_id, item_id, item_name, qty, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Cotton',1,10000,18,11800)`,
      [orderId, ITEM]
    );
    const rejected = await call(
      convertOrder(
        new NextRequest(`http://localhost/api/sales-orders/${orderId}/convert`, {
          method: 'POST',
          headers: { 'x-authenticated-user-id': A, 'x-authenticated-business-id': B, 'content-type': 'application/json' },
          body: JSON.stringify({ invoice_date: INVOICE_DATE }),
        }),
        { params: { id: orderId } }
      )
    );
    expect(rejected.status).toBe(400);
    expect(rejected.json.code).toBe('CHARGE_UNCLASSIFIED');
    const order = (await pool.query(`SELECT status, converted_invoice_id FROM sales_orders WHERE id = $1`, [orderId])).rows[0];
    expect(order.status).toBe('confirmed');
    expect(order.converted_invoice_id).toBeNull();

    await pool.query(
      `UPDATE sales_orders SET charge_classification = 'follows_goods', additional_charges_label = 'Freight' WHERE id = $1`,
      [orderId]
    );
    const accepted = await call(
      convertOrder(
        new NextRequest(`http://localhost/api/sales-orders/${orderId}/convert`, {
          method: 'POST',
          headers: { 'x-authenticated-user-id': A, 'x-authenticated-business-id': B, 'content-type': 'application/json' },
          body: JSON.stringify({ invoice_date: INVOICE_DATE }),
        }),
        { params: { id: orderId } }
      )
    );
    expect(accepted.status).toBe(201);
    expect((await header(accepted.json.invoice.id)).grand).toBeCloseTo(12980, 2);

    const estimateId = randomUUID();
    await pool.query(
      `INSERT INTO estimates (
         id, business_id, customer_id, estimate_number, estimate_date, status,
         subtotal, tax_total, grand_total, additional_charges
       ) VALUES ($1,$2,$3,$4,$5,'sent',10000,1800,12800,1000)`,
      [estimateId, B, CUST, `EST-${tag}`, INVOICE_DATE]
    );
    await pool.query(
      `INSERT INTO estimate_items (estimate_id, item_id, description, qty, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Cotton',1,10000,18,11800)`,
      [estimateId, ITEM]
    );
    const estimateRejected = await call(
      convertEstimate(
        new NextRequest(`http://localhost/api/estimates/${estimateId}/convert`, {
          method: 'POST',
          headers: { 'x-authenticated-user-id': A, 'x-authenticated-business-id': B, 'content-type': 'application/json' },
          body: JSON.stringify({ invoice_date: INVOICE_DATE }),
        }),
        { params: { id: estimateId } }
      )
    );
    expect(estimateRejected.status).toBe(400);
    expect(estimateRejected.json.code).toBe('CHARGE_UNCLASSIFIED');
    expect((await pool.query(`SELECT status, converted_invoice_id FROM estimates WHERE id = $1`, [estimateId])).rows[0].converted_invoice_id).toBeNull();

    await pool.query(
      `UPDATE estimates SET charge_classification = 'follows_goods', additional_charges_label = 'Freight' WHERE id = $1`,
      [estimateId]
    );
    const estimateConverted = await call(
      convertEstimate(
        new NextRequest(`http://localhost/api/estimates/${estimateId}/convert`, {
          method: 'POST',
          headers: { 'x-authenticated-user-id': A, 'x-authenticated-business-id': B, 'content-type': 'application/json' },
          body: JSON.stringify({ invoice_date: INVOICE_DATE }),
        }),
        { params: { id: estimateId } }
      )
    );
    expect(estimateConverted.status).toBe(200);
    const estimateInvoice = await header(estimateConverted.json.invoice.id);
    expect(estimateInvoice.subtotal).toBeCloseTo(11000, 2);
    expect(estimateInvoice.grand).toBeCloseTo(12980, 2);
  });

  test('a recurring run recalculates classified freight once', async () => {
    const recurringId = randomUUID();
    await pool.query(
      `INSERT INTO recurring_invoices (
         id, business_id, customer_id, branch_id, frequency, interval_value, start_date, next_run_date,
         items, charges, created_by, auto_finalize
       ) VALUES ($8,$1,$2,$3,'monthly',1,$4,$4,$5::jsonb,$6::jsonb,$7,true)`,
      [
        B,
        CUST,
        BR,
        INVOICE_DATE,
        JSON.stringify([{ item_id: ITEM, item_name: 'Cotton', quantity: 1, unit_price: 10000, tax_rate: 18, hsn_sac: '6109' }]),
        JSON.stringify([{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }]),
        A,
        recurringId,
      ]
    );
    const summary = await runRecurringInvoices(pool, { today: INVOICE_DATE, businessId: B, recurringId });
    expect(summary[0].error).toBeUndefined();
    expect(summary[0].created).toHaveLength(1);
    const saved = await header(summary[0].created[0].invoice_id);
    expect(saved.subtotal).toBeCloseTo(11000, 2);
    expect(saved.grand).toBeCloseTo(12980, 2);
    const charges = await pool.query(`SELECT COUNT(*)::int AS n FROM invoice_charges WHERE invoice_id = $1`, [summary[0].created[0].invoice_id]);
    expect(charges.rows[0].n).toBe(1);
  });

  test('a separate supply is not a parcel line or a physical quantity', async () => {
    const res = await call(
      postInvoice(
        req({
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Installation', amount: 1000, classification: 'separate_supply', hsn_sac: '9987', tax_rate: 18 }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(res.status).toBe(201);
    if (res.status !== 201) throw new Error(JSON.stringify(res.json));
    const id = res.json.invoice.id as string;
    const lines = await loadOrderLineRefs(pool, B, { kind: 'invoice', id });
    expect(lines.map((line) => line.name)).toEqual(['Cotton']);
    expect(lines[0].quantity).toBe(1);
    const report = await salesByItem({ businessId: B, userId: A, fromDate: INVOICE_DATE, toDate: INVOICE_DATE, branchId: BR });
    const installation = report.items.find((row) => row.item_name === 'Installation');
    const cotton = report.items.find((row) => row.item_id === ITEM);
    expect(installation?.quantity_sold).toBe(0);
    expect(installation?.amount).toBeGreaterThan(0);
    expect(cotton?.quantity_sold).toBeGreaterThan(0);
  });

  test('a classified proforma converts without dropping or doubling the charge', async () => {
    const created = await call(
      postInvoice(
        req({
          status: 'draft',
          document_type: 'proforma_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'follows_goods' }],
          items: [goods(ITEM, 10000, 18, 'Cotton')],
        })
      )
    );
    expect(created.status).toBe(201);
    const proformaId = created.json.invoice.id as string;
    const converted = await call(
      convertProforma(
        new NextRequest(`http://localhost/api/invoices/${proformaId}/convert-to-tax-invoice`, {
          method: 'POST',
          headers: { 'x-authenticated-user-id': A, 'x-authenticated-business-id': B, 'content-type': 'application/json' },
          body: JSON.stringify({ invoice_date: INVOICE_DATE }),
        }),
        { params: { id: proformaId } }
      )
    );
    expect(converted.status).toBe(200);
    const saved = await header(converted.json.invoice_id);
    expect(saved.subtotal).toBeCloseTo(11000, 2);
    expect(saved.grand).toBeCloseTo(12980, 2);
    const chargeCount = await pool.query(`SELECT COUNT(*)::int AS n FROM invoice_charges WHERE invoice_id = $1`, [converted.json.invoice_id]);
    expect(chargeCount.rows[0].n).toBe(1);
  });
});
