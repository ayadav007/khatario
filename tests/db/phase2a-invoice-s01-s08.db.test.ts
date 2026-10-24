/**
 * Phase 2A S01–S08. Posts invoices through POST /api/invoices.
 * Connects only after current_database() is kh_phase2_test on localhost.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
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
import { computeLineGst } from '@/lib/invoices/line-gst';
import { getClosingStockLockedCutoffDate } from '@/lib/closing-stock-period-lock';
import { getInventoryModel, weightedAverageCosts } from '@/lib/inventory/cogs-posting';
import {
  InvoiceCreateServiceError,
  createInvoiceInTransaction,
} from '@/lib/invoices/invoice-create-service';
import { POST as postInvoice } from '@/app/api/invoices/route';
import { GET as getInvoice } from '@/app/api/invoices/[id]/route';
import { DELETE as deleteItem } from '@/app/api/items/[id]/route';

const TAX_RATE = 18;
const QTY = 2;
const UNIT_PRICE = 100;
const PURCHASE_PRICE = 40;
const INVOICE_DATE = '2026-10-15';
/** Calendar date stored on the locked snapshot. The lock comment says documents on or before this date are blocked. */
const LOCK_DATE = '2026-10-15';

describe('Phase 2A sales invoice S01–S08 (kh_phase2_test)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const CUST = randomUUID();
  const FOREIGN = randomUUID();
  const ITEM = randomUUID();
  const DELETED = randomUUID();
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

  function req(body: unknown) {
    return new NextRequest('http://localhost/api/invoices?user_id=spoof&business_id=spoof', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'spoof',
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

  function line(itemId: string, name: string) {
    return {
      item_id: itemId,
      item_name: name,
      quantity: QTY,
      unit: 'NOS',
      unit_price: UNIT_PRICE,
      tax_rate: TAX_RATE,
      hsn_sac: '847130',
    };
  }

  async function counts() {
    const row = (
      await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM invoices WHERE business_id = ANY($1::uuid[])) AS invoices,
           (SELECT COUNT(*)::int FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.business_id = ANY($1::uuid[])) AS item_lines,
           (SELECT COUNT(*)::int FROM stock_movements WHERE business_id = ANY($1::uuid[])) AS movements,
           (SELECT COUNT(*)::int FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])) AS ledger,
           (SELECT COUNT(*)::int FROM payments WHERE business_id = ANY($1::uuid[])) AS payments,
           (SELECT COALESCE(current_balance, 0)::float8 FROM customers WHERE id = $2) AS cust,
           (SELECT COALESCE(current_balance, 0)::float8 FROM customers WHERE id = $3) AS foreign_cust,
           (SELECT COALESCE(quantity, 0)::float8 FROM branch_item_stock WHERE business_id = $4 AND branch_id = $5 AND item_id = $6) AS stock,
           (SELECT COALESCE(quantity, 0)::float8 FROM branch_item_stock WHERE business_id = $4 AND branch_id = $5 AND item_id = $7) AS deleted_stock`,
        [[B, B2], CUST, FOREIGN, B, BR, ITEM, DELETED]
      )
    ).rows[0];
    return row as {
      invoices: number;
      item_lines: number;
      movements: number;
      ledger: number;
      payments: number;
      cust: number;
      foreign_cust: number;
      stock: number;
      deleted_stock: number;
    };
  }

  async function ledgerByCode(voucherId: string) {
    const rows = (
      await pool.query<{ account_code: string; debit: string; credit: string }>(
        `SELECT a.account_code, SUM(l.debit)::text AS debit, SUM(l.credit)::text AS credit
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_id = $2
          GROUP BY a.account_code
          ORDER BY a.account_code`,
        [B, voucherId]
      )
    ).rows;
    const map = new Map<string, { debit: number; credit: number }>();
    for (const row of rows) {
      map.set(row.account_code, { debit: Number(row.debit), credit: Number(row.credit) });
    }
    return map;
  }

  async function expectedCost(): Promise<{ model: 'periodic' | 'perpetual'; amount: number }> {
    const model = await getInventoryModel(pool, B);
    if (model !== 'perpetual') return { model, amount: 0 };
    const rates = await weightedAverageCosts(pool, B, [ITEM], INVOICE_DATE, BR);
    const rate = rates.get(ITEM) ?? 0;
    return { model, amount: Math.round(QTY * rate * 100) / 100 };
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string | null; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test') {
      throw new Error(`Refusing to mutate database ${info.db}`);
    }
    if (info.port !== 5433 || (info.addr !== '::1/128' && info.addr !== '127.0.0.1/32' && info.addr !== '127.0.0.1')) {
      throw new Error('Refusing to mutate a database that is not the local disposable server');
    }

    const gst = `27AABCU${tag.slice(0, 4).toUpperCase()}C1Z5`;
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type)
       VALUES ($1,$2,$3,'27','Maharashtra','regular'), ($4,$5,$6,'29','Karnataka','regular')`,
      [B, `Phase2A ${tag}`, gst, B2, `Phase2A-b ${tag}`, `29AABCU${tag.slice(0, 4).toUpperCase()}D1Z5`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1,$2,'Main','27',true,true,true)`,
      [BR, B]
    );
    const phone = `${Date.now()}`.slice(-9);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1,$2,'Clerk',$3,true)`,
      [A, B, `9${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, phone)
       VALUES ($1,$2,'Asha','27',0,$3), ($4,$5,'Other','29',100,$6)`,
      [CUST, B, `7${phone}`, FOREIGN, B2, `6${phone}`]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,'Widget','goods','NOS',$3,$4,$5,'847130'),
              ($6,$2,'Old widget','goods','NOS',$3,$4,$5,'847130')`,
      [ITEM, B, UNIT_PRICE, PURCHASE_PRICE, TAX_RATE, DELETED]
    );
    await pool.query(`UPDATE items SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [DELETED]);
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity)
       VALUES ($1,$2,$3,10), ($1,$2,$4,10)`,
      [B, BR, ITEM, DELETED]
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled) VALUES ($1, false)
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = false`,
      [B]
    );
    await pool.query(`UPDATE business_settings SET inventory_model = 'perpetual' WHERE business_id = $1`, [B]).catch(() => {});
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, B2]]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[B, B2]]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  beforeEach(async () => {
    await pool.query(`UPDATE branch_item_stock SET quantity = 10 WHERE business_id = $1 AND item_id = ANY($2::uuid[])`, [B, [ITEM, DELETED]]);
    await pool.query(`UPDATE customers SET current_balance = 0, state_code = '27' WHERE id = $1`, [CUST]);
    await pool.query(`UPDATE customers SET current_balance = 100 WHERE id = $1`, [FOREIGN]);
    await pool.query(`DELETE FROM closing_stock_snapshot_headers WHERE business_id = $1`, [B]).catch(() => {});
  });

  test('S01 final invoice without payments posts lines, stock, balance and a balanced ledger', async () => {
    const before = await counts();
    const tax = computeLineGst({ quantity: QTY, unit_price: UNIT_PRICE, tax_rate: TAX_RATE }, true, false);
    const cost = await expectedCost();
    const res = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: INVOICE_DATE,
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(ITEM, 'Widget')],
      }))
    );
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    const header = (
      await pool.query(
        `SELECT status, customer_id, business_id, paid_amount::float8 AS paid, balance_amount::float8 AS balance,
                subtotal::float8 AS subtotal, cgst_total::float8 AS cgst, sgst_total::float8 AS sgst,
                igst_total::float8 AS igst, tax_total::float8 AS tax, grand_total::float8 AS grand
           FROM invoices WHERE id = $1`,
        [id]
      )
    ).rows[0];
    expect(header).toMatchObject({
      status: 'final',
      customer_id: CUST,
      business_id: B,
      paid: 0,
      balance: tax.lineTotal,
      subtotal: tax.taxable,
      cgst: tax.cgst,
      sgst: tax.sgst,
      igst: 0,
      tax: tax.taxAmount,
      grand: tax.lineTotal,
    });
    const items = (
      await pool.query(
        `SELECT quantity::float8 AS qty, cgst_amount::float8 AS cgst, sgst_amount::float8 AS sgst, igst_amount::float8 AS igst
           FROM invoice_items WHERE invoice_id = $1`,
        [id]
      )
    ).rows;
    expect(items).toEqual([{ qty: QTY, cgst: tax.cgst, sgst: tax.sgst, igst: 0 }]);
    const movement = (
      await pool.query(
        `SELECT type, quantity::float8 AS qty, reference_type FROM stock_movements WHERE reference_id = $1 AND business_id = $2`,
        [id, B]
      )
    ).rows;
    expect(movement).toEqual([{ type: 'out', qty: QTY, reference_type: 'invoice' }]);
    const after = await counts();
    expect(after.stock).toBe(before.stock - QTY);
    expect(after.cust).toBe(before.cust + tax.lineTotal);
    expect(after.foreign_cust).toBe(before.foreign_cust);
    expect(after.payments).toBe(before.payments);
    const books = await ledgerByCode(id);
    expect(books.get('1103')).toEqual({ debit: tax.lineTotal, credit: 0 });
    expect(books.get('4101')).toEqual({ debit: 0, credit: tax.taxable });
    expect(books.get('2150')).toEqual({ debit: 0, credit: tax.cgst });
    expect(books.get('2151')).toEqual({ debit: 0, credit: tax.sgst });
    expect(books.get('2152')).toBeUndefined();
    if (cost.model === 'perpetual' && cost.amount > 0) {
      expect(books.get('5104')).toEqual({ debit: cost.amount, credit: 0 });
      expect(books.get('1104')).toEqual({ debit: 0, credit: cost.amount });
    } else {
      expect(books.get('5104')).toBeUndefined();
    }
    let debit = 0;
    let credit = 0;
    for (const row of books.values()) {
      debit += row.debit;
      credit += row.credit;
    }
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
  });

  test('S02 draft invoice does not change stock, customer balance or ledger', async () => {
    const before = await counts();
    const res = await call(
      postInvoice(req({
        status: 'draft',
        document_type: 'tax_invoice',
        invoice_date: INVOICE_DATE,
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(ITEM, 'Widget')],
      }))
    );
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    const header = (await pool.query(`SELECT status FROM invoices WHERE id = $1 AND business_id = $2`, [id, B])).rows[0];
    expect(header.status).toBe('draft');
    const after = await counts();
    expect(after.stock).toBe(before.stock);
    expect(after.cust).toBe(before.cust);
    expect(after.movements).toBe(before.movements);
    expect(after.ledger).toBe(before.ledger);
    expect(after.payments).toBe(before.payments);
    expect(await ledgerByCode(id)).toEqual(new Map());
  });

  test('S03 locked closing-stock date returns 409 and writes nothing', async () => {
    await pool.query(
      `INSERT INTO closing_stock_snapshot_headers
         (business_id, financial_year, snapshot_date, valuation_method, is_locked, created_by)
       VALUES ($1, '2026-27', $2, 'weighted_avg', true, $3)`,
      [B, LOCK_DATE, A]
    );
    const before = await counts();
    const res = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: LOCK_DATE,
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(ITEM, 'Widget')],
      }))
    );
    const after = await counts();
    expect(await getClosingStockLockedCutoffDate(B)).toBe(LOCK_DATE);
    expect({
      status: res.status,
      code: res.json.code ?? null,
      invoiceDelta: after.invoices - before.invoices,
      stockDelta: after.stock - before.stock,
      movementDelta: after.movements - before.movements,
      ledgerDelta: after.ledger - before.ledger,
      balanceDelta: after.cust - before.cust,
      paymentDelta: after.payments - before.payments,
    }).toEqual({
      status: 409,
      code: 'CLOSING_STOCK_PERIOD_LOCKED',
      invoiceDelta: 0,
      stockDelta: 0,
      movementDelta: 0,
      ledgerDelta: 0,
      balanceDelta: 0,
      paymentDelta: 0,
    });
  });

  test('S03 a date before the locked snapshot is rejected without writes', async () => {
    await pool.query(
      `INSERT INTO closing_stock_snapshot_headers
         (business_id, financial_year, snapshot_date, valuation_method, is_locked, created_by)
       VALUES ($1, '2026-27', $2, 'weighted_avg', true, $3)`,
      [B, LOCK_DATE, A]
    );
    const before = await counts();
    const blocked = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: '2026-10-14',
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(ITEM, 'Widget')],
      }))
    );
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe('CLOSING_STOCK_PERIOD_LOCKED');
    expect(await counts()).toEqual(before);
  });

  test('S04 customer from another business is rejected without writes', async () => {
    const before = await counts();
    const http = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: INVOICE_DATE,
        business_id: B2,
        customer_id: FOREIGN,
        branch_id: BR,
        place_of_supply_state_code: '29',
        items: [line(ITEM, 'Widget')],
      }))
    );
    let serviceCode: string | null = null;
    let serviceStatus: number | null = null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await createInvoiceInTransaction(client, {
          business_id: B,
          created_by: A,
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: FOREIGN,
          branch_id: BR,
          place_of_supply_state_code: '29',
          items: [line(ITEM, 'Widget')],
        });
      } catch (e) {
        if (e instanceof InvoiceCreateServiceError) {
          serviceCode = e.code ?? null;
          serviceStatus = e.statusCode;
        } else {
          throw e;
        }
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const after = await counts();
    expect(JSON.stringify(http.json)).not.toContain(FOREIGN);
    expect({
      httpStatus: http.status,
      httpCode: http.json.code ?? null,
      httpError: http.json.error ?? null,
      serviceCode,
      serviceStatus,
      invoiceDelta: after.invoices - before.invoices,
      stockDelta: after.stock - before.stock,
      ledgerDelta: after.ledger - before.ledger,
      balanceDelta: after.cust - before.cust,
      foreignBalanceDelta: after.foreign_cust - before.foreign_cust,
    }).toEqual({
      httpStatus: 400,
      httpCode: 'CUSTOMER_NOT_FOUND',
      httpError: 'Customer not found',
      serviceCode: 'CUSTOMER_NOT_FOUND',
      serviceStatus: 400,
      invoiceDelta: 0,
      stockDelta: 0,
      ledgerDelta: 0,
      balanceDelta: 0,
      foreignBalanceDelta: 0,
    });
  });

  test('S05 soft-deleted item returns 409 PRODUCT_DELETED and writes nothing', async () => {
    const before = await counts();
    const http = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: INVOICE_DATE,
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(DELETED, 'Old widget')],
      }))
    );
    let serviceCode: string | null = null;
    let serviceStatus: number | null = null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await createInvoiceInTransaction(client, {
          business_id: B,
          created_by: A,
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: INVOICE_DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          items: [line(DELETED, 'Old widget')],
        });
      } catch (e) {
        if (e instanceof InvoiceCreateServiceError) {
          serviceCode = e.code ?? null;
          serviceStatus = e.statusCode;
        } else {
          throw e;
        }
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const after = await counts();
    expect({
      httpStatus: http.status,
      httpCode: http.json.code ?? null,
      serviceCode,
      serviceStatus,
      invoiceDelta: after.invoices - before.invoices,
      stockDelta: after.deleted_stock - before.deleted_stock,
      movementDelta: after.movements - before.movements,
      ledgerDelta: after.ledger - before.ledger,
      balanceDelta: after.cust - before.cust,
    }).toEqual({
      httpStatus: 409,
      httpCode: 'PRODUCT_DELETED',
      serviceCode: 'PRODUCT_DELETED',
      serviceStatus: 409,
      invoiceDelta: 0,
      stockDelta: 0,
      movementDelta: 0,
      ledgerDelta: 0,
      balanceDelta: 0,
    });
  });

  test('S06 intra-state supply splits CGST and SGST and leaves IGST at zero', async () => {
    const tax = computeLineGst({ quantity: QTY, unit_price: UNIT_PRICE, tax_rate: TAX_RATE }, true, false);
    const res = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: INVOICE_DATE,
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(ITEM, 'Widget')],
      }))
    );
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    const header = (
      await pool.query(
        `SELECT cgst_total::float8 AS cgst, sgst_total::float8 AS sgst, igst_total::float8 AS igst, grand_total::float8 AS grand
           FROM invoices WHERE id = $1 AND business_id = $2`,
        [id, B]
      )
    ).rows[0];
    expect(header).toEqual({ cgst: tax.cgst, sgst: tax.sgst, igst: 0, grand: tax.lineTotal });
    expect(tax.cgst).toBeGreaterThan(0);
    expect(tax.sgst).toBe(tax.cgst);
    const books = await ledgerByCode(id);
    expect(books.get('2150')?.credit).toBe(tax.cgst);
    expect(books.get('2151')?.credit).toBe(tax.sgst);
    expect(books.get('2152')).toBeUndefined();
  });

  test('S07 inter-state supply posts IGST and leaves CGST and SGST at zero', async () => {
    await pool.query(`UPDATE customers SET state_code = '29' WHERE id = $1 AND business_id = $2`, [CUST, B]);
    const tax = computeLineGst({ quantity: QTY, unit_price: UNIT_PRICE, tax_rate: TAX_RATE }, false, false);
    const res = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: INVOICE_DATE,
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '29',
        items: [line(ITEM, 'Widget')],
      }))
    );
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    const header = (
      await pool.query(
        `SELECT cgst_total::float8 AS cgst, sgst_total::float8 AS sgst, igst_total::float8 AS igst, grand_total::float8 AS grand
           FROM invoices WHERE id = $1 AND business_id = $2`,
        [id, B]
      )
    ).rows[0];
    expect(header).toEqual({ cgst: 0, sgst: 0, igst: tax.igst, grand: tax.lineTotal });
    expect(tax.igst).toBeGreaterThan(0);
    const books = await ledgerByCode(id);
    expect(books.get('2152')?.credit).toBe(tax.igst);
    expect(books.get('2150')).toBeUndefined();
    expect(books.get('2151')).toBeUndefined();
  });

  test('S08 cash sale without a customer debits cash and does not change customer balances', async () => {
    const before = await counts();
    const tax = computeLineGst({ quantity: QTY, unit_price: UNIT_PRICE, tax_rate: TAX_RATE }, true, false);
    const res = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: INVOICE_DATE,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(ITEM, 'Widget')],
      }))
    );
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    const header = (
      await pool.query(`SELECT customer_id, paid_amount::float8 AS paid, grand_total::float8 AS grand FROM invoices WHERE id = $1`, [id])
    ).rows[0];
    expect(header.customer_id).toBeNull();
    expect(header.grand).toBe(tax.lineTotal);
    const after = await counts();
    expect(after.cust).toBe(before.cust);
    expect(after.foreign_cust).toBe(before.foreign_cust);
    expect(after.payments).toBe(before.payments);
    const books = await ledgerByCode(id);
    expect(books.get('1101')).toEqual({ debit: tax.lineTotal, credit: 0 });
    expect(books.get('1103')).toBeUndefined();
    expect(books.get('4101')?.credit).toBe(tax.taxable);
  });

  test('S03 the day after a locked snapshot can still be posted', async () => {
    await pool.query(
      `INSERT INTO closing_stock_snapshot_headers
         (business_id, financial_year, snapshot_date, valuation_method, is_locked, created_by)
       VALUES ($1, '2026-27', $2, 'weighted_avg', true, $3)`,
      [B, LOCK_DATE, A]
    );
    const before = await counts();
    const allowed = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: '2026-10-16',
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(ITEM, 'Widget')],
      }))
    );
    expect(allowed.status).toBe(201);
    const after = await counts();
    expect(after.invoices).toBe(before.invoices + 1);
    expect(after.stock).toBe(before.stock - QTY);
    expect(after.cust).toBe(before.cust + 236);
    expect(after.movements).toBe(before.movements + 1);
    expect(after.ledger).toBeGreaterThan(before.ledger);
  });

  test('soft-deleted item keeps prior invoice lines and is unchanged by a rejected resale', async () => {
    const hist = randomUUID();
    const histName = `Hist ${tag}`;
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,$3,'goods','NOS',$4,$5,$6,'847130')`,
      [hist, B, histName, UNIT_PRICE, PURCHASE_PRICE, TAX_RATE]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,10)`,
      [B, BR, hist]
    );

    const created = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: '2026-10-17',
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(hist, histName)],
      }))
    );
    expect(created.status).toBe(201);
    const invoiceId = created.json.invoice.id as string;
    const storedLine = (
      await pool.query(
        `SELECT item_name, hsn_sac, quantity::float8 AS qty, line_total::float8 AS line_total
           FROM invoice_items WHERE invoice_id = $1`,
        [invoiceId]
      )
    ).rows[0];

    const removed = await call(
      deleteItem(
        new NextRequest(`http://localhost/api/items/${hist}`, {
          method: 'DELETE',
          headers: {
            'content-type': 'application/json',
            'x-authenticated-user-id': A,
            'x-authenticated-business-id': B,
            'x-user-id': A,
          },
          body: JSON.stringify({}),
        }),
        { params: { id: hist } }
      )
    );
    expect(removed.status).toBe(200);
    const afterDelete = (
      await pool.query<{ name: string; gone: boolean }>(
        `SELECT name, deleted_at IS NOT NULL AS gone FROM items WHERE id = $1 AND business_id = $2`,
        [hist, B]
      )
    ).rows[0];
    expect(afterDelete).toEqual({ name: histName, gone: true });

    const viewed = await call(
      getInvoice(
        new NextRequest(`http://localhost/api/invoices/${invoiceId}?user_id=${A}&business_id=${B}`, {
          headers: {
            'x-authenticated-user-id': A,
            'x-authenticated-business-id': B,
            'x-user-id': A,
          },
        }),
        { params: { id: invoiceId } }
      )
    );
    expect(viewed.status).toBe(200);
    const viewedLine = viewed.json.invoice.items[0];
    expect(viewedLine.item_name).toBe(storedLine.item_name);
    expect(viewedLine.hsn_sac).toBe(storedLine.hsn_sac);
    expect(Number(viewedLine.quantity)).toBe(Number(storedLine.qty));
    expect(Number(viewedLine.line_total)).toBe(Number(storedLine.line_total));

    const reportLine = (
      await pool.query(
        `SELECT ii.item_name, ii.quantity::float8 AS qty
           FROM invoice_items ii
           INNER JOIN invoices i ON i.id = ii.invoice_id AND i.deleted_at IS NULL
          WHERE i.business_id = $1 AND i.id = $2 AND i.status = 'final'`,
        [B, invoiceId]
      )
    ).rows[0];
    expect(reportLine).toEqual({ item_name: storedLine.item_name, qty: Number(storedLine.qty) });

    const listed = (
      await pool.query<{ id: string }>(
        `SELECT id FROM items WHERE business_id = $1 AND deleted_at IS NULL AND (is_active IS NULL OR is_active = true)`,
        [B]
      )
    ).rows.map((row) => row.id);
    expect(listed).toContain(ITEM);
    expect(listed).not.toContain(hist);

    const beforeRetry = await counts();
    const deletedAt = (
      await pool.query<{ deleted_at: string }>(`SELECT deleted_at::text AS deleted_at FROM items WHERE id = $1`, [hist])
    ).rows[0].deleted_at;
    const retry = await call(
      postInvoice(req({
        status: 'final',
        document_type: 'tax_invoice',
        invoice_date: '2026-10-17',
        customer_id: CUST,
        branch_id: BR,
        place_of_supply_state_code: '27',
        items: [line(hist, histName)],
      }))
    );
    expect(retry.status).toBe(409);
    expect(retry.json.code).toBe('PRODUCT_DELETED');
    const still = (
      await pool.query<{ name: string; deleted_at: string }>(
        `SELECT name, deleted_at::text AS deleted_at FROM items WHERE id = $1 AND business_id = $2`,
        [hist, B]
      )
    ).rows[0];
    expect(still).toEqual({ name: histName, deleted_at: deletedAt });
    const afterRetry = await counts();
    expect(afterRetry.invoices).toBe(beforeRetry.invoices);
    expect(afterRetry.movements).toBe(beforeRetry.movements);
    expect(afterRetry.ledger).toBe(beforeRetry.ledger);
  });
});
