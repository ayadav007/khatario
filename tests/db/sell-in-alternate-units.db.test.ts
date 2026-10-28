/**
 * Selling in an item's alternate units (migration 438): 5 BOX of 12 bills 5 boxes and moves 60
 * pieces of stock; cancelling, crediting and converting put back or move the right base quantity.
 * Posts through the real routes and services. Connects only after current_database() is
 * kh_phase2_test on localhost.
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
    throw new Error('Refusing alternate-unit tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing alternate-unit tests: local database credentials are missing');
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
import { PATCH as finalizeInvoice } from '@/app/api/invoices/[id]/finalize/route';
import { POST as convertOrder } from '@/app/api/sales-orders/[id]/convert/route';
import { POST as postSalesOrder } from '@/app/api/sales-orders/route';
import { PATCH as cancelCreditNote } from '@/app/api/credit-notes/[id]/cancel/route';
import { POST as resolveRoute } from '@/app/api/pricing/resolve/route';
import { cancelPostedInvoiceInTransaction } from '@/lib/invoices/cancel-final-invoice';
import { createCreditNoteInTransaction, CreditNoteCreateError } from '@/lib/credit-notes/create-credit-note';
import { resolvePrices } from '@/lib/pricing/resolve-price';
import { salesByItem } from '@/lib/reports/sales-reports';
import { baseQty, resolveSaleUnits, SaleUnitError } from '@/lib/items/item-units';

const DATE = '2026-10-20';

describe('Selling in alternate units (kh_phase2_test)', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const CUST = randomUUID();
  const SOAP = randomUUID(); // PCS, BOX = 12
  const RICE = randomUUID(); // KGS, BAG = 50 with its own price
  const KIT = randomUUID(); // bundle with a BOX unit
  const LEVEL = randomUUID();
  const tag = B.slice(0, 8);
  const headers = {
    'content-type': 'application/json',
    'x-authenticated-user-id': A,
    'x-authenticated-business-id': B,
    'x-authenticated-session-version': '1',
  };

  function req(url: string, method: string, body: unknown) {
    return new NextRequest(`http://localhost${url}`, { method, headers, body: JSON.stringify(body) });
  }

  async function call(res: Response | Promise<Response>) {
    const r = await res;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json: json as Record<string, any> };
  }

  function soapLine(quantity: number, unit: string, price: number, extra: Record<string, unknown> = {}) {
    return { item_id: SOAP, item_name: 'Soap', quantity, unit, unit_price: price, tax_rate: 18, hsn_sac: '3401', ...extra };
  }

  async function invoice(items: unknown[], status: 'final' | 'draft' = 'final') {
    return call(
      postInvoice(
        req('/api/invoices', 'POST', {
          status,
          document_type: 'tax_invoice',
          invoice_date: DATE,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          items,
        })
      )
    );
  }

  async function stock(itemId = SOAP) {
    const row = (
      await pool.query(`SELECT quantity::float8 AS q FROM branch_item_stock WHERE item_id = $1 AND branch_id = $2`, [itemId, BR])
    ).rows[0];
    return Number(row?.q ?? 0);
  }

  async function setStock(qty: number, itemId = SOAP) {
    await pool.query(`UPDATE branch_item_stock SET quantity = $3 WHERE item_id = $1 AND branch_id = $2`, [itemId, BR, qty]);
    await pool.query(`UPDATE items SET current_stock = $2 WHERE id = $1`, [itemId, qty]);
  }

  async function lines(invoiceId: string) {
    return (
      await pool.query(
        `SELECT quantity::float8 AS quantity, unit, unit_factor::float8 AS unit_factor, unit_price::float8 AS unit_price,
                taxable_value::float8 AS taxable
           FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
        [invoiceId]
      )
    ).rows;
  }

  async function withTx<T>(fn: (c: any) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  let cnSeq = 0;
  function creditNote(invoiceId: string, items: any[]) {
    return withTx((c) =>
      createCreditNoteInTransaction(c, {
        businessId: B,
        branchId: BR,
        userId: A,
        customerId: CUST,
        invoiceId,
        creditNoteNumber: `CN-${tag}-${++cnSeq}`,
        creditNoteDate: DATE,
        placeOfSupplyStateCode: '27',
        items,
      })
    );
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string | null }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.db}`);
    if (info.addr !== '::1/128' && info.addr !== '127.0.0.1/32' && info.addr !== '127.0.0.1') {
      throw new Error('Refusing to mutate a database that is not the local disposable server');
    }
    const gst = `27AABCU${tag.slice(0, 4).toUpperCase()}C1Z5`;
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type)
       VALUES ($1,$2,$3,'27','Maharashtra','regular')`,
      [B, `Alt units ${tag}`, gst]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1,$2,'Main','27',true,true,true)`,
      [BR, B]
    );
    const phone = `${Date.now()}`.slice(-9);
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1,$2,'Clerk',$3,true)`, [
      A,
      B,
      `8${phone}`,
    ]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(`INSERT INTO price_levels (id, business_id, name) VALUES ($1,$2,'Wholesale')`, [LEVEL, B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, phone, price_level_id)
       VALUES ($1,$2,'Asha','27',0,$3,$4)`,
      [CUST, B, `7${phone}`, LEVEL]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, uqc, selling_price, purchase_price, mrp, tax_rate, hsn_sac, current_stock)
       VALUES ($1,$2,'Soap','goods','PCS','PCS',10,6,12,18,'3401',500),
              ($3,$2,'Rice','goods','KGS','KGS',40,30,NULL,5,'1006',500)`,
      [SOAP, B, RICE]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, tax_rate, hsn_sac, is_bundle)
       VALUES ($1,$2,'Gift kit','goods','PCS',100,18,'3401',true)`,
      [KIT, B]
    );
    await pool.query(
      `INSERT INTO item_units (business_id, item_id, unit, factor_to_base, selling_price)
       VALUES ($1,$2,'BOX',12,NULL), ($1,$3,'BAG',50,1800), ($1,$4,'BOX',6,NULL)`,
      [B, SOAP, RICE, KIT]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,500), ($1,$2,$4,500)`,
      [B, BR, SOAP, RICE]
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

  test('baseQty multiplies by the stored factor and treats old rows as factor 1', () => {
    expect(baseQty({ quantity: 5, unit_factor: 12 })).toBe(60);
    expect(baseQty({ qty: '2.5', unit_factor: '50' })).toBe(125);
    expect(baseQty({ quantity: 7 })).toBe(7);
  });

  test('a final invoice of 5 BOX bills 5 boxes and takes 60 pieces out of stock', async () => {
    await setStock(500);
    const res = await invoice([soapLine(5, 'box', 100)]);
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    expect(await lines(id)).toEqual([{ quantity: 5, unit: 'BOX', unit_factor: 12, unit_price: 100, taxable: 500 }]);
    expect(await stock()).toBeCloseTo(440, 3);
    const moved = (
      await pool.query(
        `SELECT SUM(quantity)::float8 AS q FROM stock_movements WHERE reference_type = 'invoice' AND reference_id = $1`,
        [id]
      )
    ).rows[0].q;
    expect(moved).toBeCloseTo(60, 3);
  });

  test('stock is checked in pieces: 50 on hand cannot cover 5 BOX', async () => {
    await setStock(50);
    const res = await invoice([soapLine(5, 'BOX', 100)]);
    expect(res.status).toBe(400);
    expect(res.json.requested_quantity).toBe(60);
    expect(await stock()).toBeCloseTo(50, 3);
    await setStock(500);
  });

  test('a factor sent by the client is ignored, and an unknown unit counts as the base unit', async () => {
    await setStock(500);
    const spoof = await invoice([soapLine(1, 'BOX', 100, { unit_factor: 1000 })]);
    expect(spoof.status).toBe(201);
    expect((await lines(spoof.json.invoice.id))[0].unit_factor).toBe(12);
    expect(await stock()).toBeCloseTo(488, 3);
    const unknown = await invoice([soapLine(3, 'DOZEN', 10)]);
    expect(unknown.status).toBe(201);
    expect((await lines(unknown.json.invoice.id))[0]).toMatchObject({ unit: 'DOZEN', unit_factor: 1 });
    expect(await stock()).toBeCloseTo(485, 3);
  });

  test('a bundle cannot be sold in an alternate unit', async () => {
    const res = await invoice([{ item_id: KIT, item_name: 'Gift kit', quantity: 1, unit: 'BOX', unit_price: 600, tax_rate: 18 }]);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_SALE_UNIT');
    await expect(resolveSaleUnits(pool, B, [{ item_id: KIT, unit: 'BOX' }])).rejects.toBeInstanceOf(SaleUnitError);
  });

  test('a draft in boxes moves stock only when finalised, by the base quantity', async () => {
    await setStock(500);
    const draft = await invoice([soapLine(2, 'BOX', 100)], 'draft');
    expect(draft.status).toBe(201);
    const id = draft.json.invoice.id as string;
    expect(await stock()).toBeCloseTo(500, 3);
    const fin = await call(finalizeInvoice(req(`/api/invoices/${id}/finalize`, 'PATCH', {}), { params: { id } }));
    expect(fin.status).toBe(200);
    expect(await stock()).toBeCloseTo(476, 3);
  });

  test('cancelling puts 60 back, even after the box was changed to 10', async () => {
    await setStock(500);
    const res = await invoice([soapLine(5, 'BOX', 100)]);
    const id = res.json.invoice.id as string;
    expect(await stock()).toBeCloseTo(440, 3);
    await pool.query(`UPDATE item_units SET factor_to_base = 10 WHERE item_id = $1 AND unit = 'BOX'`, [SOAP]);
    try {
      await withTx((c) => cancelPostedInvoiceInTransaction(c, { invoiceId: id, businessId: B, userId: A, reason: 'test' }));
    } finally {
      await pool.query(`UPDATE item_units SET factor_to_base = 12 WHERE item_id = $1 AND unit = 'BOX'`, [SOAP]);
    }
    expect(await stock()).toBeCloseTo(500, 3);
  });

  test('a credit note in boxes brings back pieces, pools against the invoice in pieces, and its cancel takes them out', async () => {
    await setStock(500);
    const res = await invoice([soapLine(5, 'BOX', 100)]);
    const id = res.json.invoice.id as string;
    expect(await stock()).toBeCloseTo(440, 3);

    const first = await creditNote(id, [{ item_id: SOAP, item_name: 'Soap', qty: 2, unit: 'BOX', unit_price: 100, tax_rate: 18 }]);
    expect(await stock()).toBeCloseTo(464, 3);
    const cnLine = (
      await pool.query(
        `SELECT qty::float8 AS qty, unit, unit_factor::float8 AS unit_factor, (line_total - tax_amount)::float8 AS taxable
           FROM credit_note_items WHERE credit_note_id = $1`,
        [first.id]
      )
    ).rows[0];
    expect(cnLine).toEqual({ qty: 2, unit: 'BOX', unit_factor: 12, taxable: 200 });

    // 3 boxes (36 pieces) are still open: 4 boxes are too many.
    await expect(
      creditNote(id, [{ item_id: SOAP, item_name: 'Soap', qty: 4, unit: 'BOX', unit_price: 100, tax_rate: 18 }])
    ).rejects.toMatchObject({ code: 'RETURN_EXCEEDS_INVOICED' });
    expect(await stock()).toBeCloseTo(464, 3);

    // The same 36 pieces credited loose close the invoice line.
    const loose = await creditNote(id, [{ item_id: SOAP, item_name: 'Soap', qty: 36, unit: 'PCS', unit_price: 8.33, tax_rate: 18 }]);
    expect(await stock()).toBeCloseTo(500, 3);
    const looseTaxable = Number(
      (await pool.query(`SELECT subtotal::float8 AS s FROM credit_notes WHERE id = $1`, [loose.id])).rows[0].s
    );
    expect(looseTaxable).toBeCloseTo(300, 2);

    const cancelled = await call(
      cancelCreditNote(req(`/api/credit-notes/${first.id}/cancel`, 'PATCH', { reason: 'test' }), { params: { id: first.id } })
    );
    expect(cancelled.status).toBe(200);
    expect(await stock()).toBeCloseTo(476, 3);
  });

  test('a credit note error is a CreditNoteCreateError', async () => {
    const res = await invoice([soapLine(1, 'BOX', 100)]);
    await expect(
      creditNote(res.json.invoice.id, [{ item_id: SOAP, item_name: 'Soap', qty: 13, unit: 'PCS', unit_price: 8, tax_rate: 18 }])
    ).rejects.toBeInstanceOf(CreditNoteCreateError);
  });

  test('a sales order in boxes keeps its factor and converts to an invoice that takes 60 pieces', async () => {
    await setStock(500);
    const created = await call(
      postSalesOrder(
        req('/api/sales-orders', 'POST', {
          customer_id: CUST,
          branch_id: BR,
          order_number: `SO-${tag}`,
          order_date: DATE,
          status: 'confirmed',
          place_of_supply_state_code: '27',
          subtotal: 500,
          tax_total: 90,
          grand_total: 590,
          items: [{ item_id: SOAP, item_name: 'Soap', qty: 5, unit: 'Box', unit_price: 100, tax_rate: 18, line_total: 590 }],
        })
      )
    );
    expect(created.status).toBe(201);
    const orderId = created.json.salesOrder.id as string;
    const soLine = (
      await pool.query(`SELECT unit, unit_factor::float8 AS f FROM sales_order_items WHERE sales_order_id = $1`, [orderId])
    ).rows[0];
    expect(soLine).toEqual({ unit: 'BOX', f: 12 });

    // The box changes after the order: the order's box still bills.
    await pool.query(`UPDATE item_units SET factor_to_base = 10 WHERE item_id = $1 AND unit = 'BOX'`, [SOAP]);
    let converted;
    try {
      converted = await call(
        convertOrder(req(`/api/sales-orders/${orderId}/convert`, 'POST', { invoice_date: DATE }), { params: { id: orderId } })
      );
    } finally {
      await pool.query(`UPDATE item_units SET factor_to_base = 12 WHERE item_id = $1 AND unit = 'BOX'`, [SOAP]);
    }
    expect(converted.status).toBe(201);
    const invoiceId = (await pool.query(`SELECT converted_invoice_id FROM sales_orders WHERE id = $1`, [orderId])).rows[0]
      .converted_invoice_id as string;
    expect(await lines(invoiceId)).toEqual([{ quantity: 5, unit: 'BOX', unit_factor: 12, unit_price: 100, taxable: 500 }]);
    expect(await stock()).toBeCloseTo(440, 3);
  });

  test('the resolver prices a box at 12 pieces, a bag at its own price, and counts slabs in pieces', async () => {
    await pool.query(
      `INSERT INTO price_level_rates (business_id, price_level_id, item_id, min_qty, price)
       VALUES ($1,$2,$3,0,9), ($1,$2,$3,36,8)`,
      [B, LEVEL, SOAP]
    );
    try {
      const [cashBox, cashBag] = await resolvePrices(
        pool,
        B,
        null,
        [
          { itemId: SOAP, qty: 1, unit: 'BOX' },
          { itemId: RICE, qty: 1, unit: 'BAG' },
        ],
        DATE
      );
      expect(cashBox).toMatchObject({ price: 120, catalogPrice: 120, unit: 'BOX', unitFactor: 12, costPrice: 72, mrp: 144 });
      expect(cashBag).toMatchObject({ price: 1800, unit: 'BAG', unitFactor: 50, costPrice: 1500 });

      const [twoBoxes, threeBoxes, loose] = await resolvePrices(
        pool,
        B,
        CUST,
        [
          { itemId: SOAP, qty: 2, unit: 'BOX' },
          { itemId: SOAP, qty: 3, unit: 'BOX' },
          { itemId: SOAP, qty: 3 },
        ],
        DATE
      );
      expect(twoBoxes).toMatchObject({ price: 108, priceSource: 'level' });
      expect(threeBoxes).toMatchObject({ price: 96, priceSource: 'level' });
      expect(loose).toMatchObject({ price: 9, unitFactor: 1, unit: 'PCS' });
      // Last rate to this customer was a box at 100: per box it reads 100, loose it reads 8.33.
      expect(twoBoxes.lastSale?.exclusivePrice).toBeCloseTo(100, 2);

      const viaRoute = await call(
        resolveRoute(req('/api/pricing/resolve', 'POST', { date: DATE, lines: [{ item_id: SOAP, qty: 1, unit: 'BOX' }] }))
      );
      expect(viaRoute.status).toBe(200);
      expect(viaRoute.json.lines[0]).toMatchObject({ price: 120, unitFactor: 12 });
    } finally {
      await pool.query(`DELETE FROM price_level_rates WHERE price_level_id = $1`, [LEVEL]);
    }
  });

  test('item-wise sales and the GSTR-1 HSN summary count pieces, one row per HSN', async () => {
    const report = await salesByItem({ businessId: B, userId: A, fromDate: DATE, toDate: DATE, branchId: BR });
    const soap = report.items.find((r) => r.item_id === SOAP)!;
    const sold = Number(
      (
        await pool.query(
          `SELECT SUM(ii.quantity * ii.unit_factor)::float8 AS q FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE i.business_id = $1 AND i.status = 'final' AND ii.item_id = $2`,
          [B, SOAP]
        )
      ).rows[0].q
    );
    const credited = Number(
      (
        await pool.query(
          `SELECT COALESCE(SUM(cni.qty * cni.unit_factor), 0)::float8 AS q FROM credit_note_items cni
             JOIN credit_notes cn ON cn.id = cni.credit_note_id
            WHERE cn.business_id = $1 AND cn.status = 'active' AND cni.item_id = $2`,
          [B, SOAP]
        )
      ).rows[0].q
    );
    expect(soap.quantity_invoiced).toBeCloseTo(sold, 3);
    expect(soap.quantity_returned).toBeCloseTo(credited, 3);
    expect(soap.unit).toBe('PCS');

    const gstr1 = await new GSTR1Generator().generate({ business_id: B, from_date: DATE, to_date: DATE });
    // Boxes and pieces share one PCS row; the 3 DOZEN sold under a unit the item does not know
    // keep their own row, as before.
    const hsn = ((gstr1 as any).hsn || []).filter((h: any) => h.hsn_sac === '3401');
    expect(hsn.map((h: any) => h.uqc).sort()).toEqual(['DOZ', 'PCS']);
    const pcs = hsn.find((h: any) => h.uqc === 'PCS');
    expect(pcs.total_quantity).toBeCloseTo(sold - credited - 3, 3);
  });
});
