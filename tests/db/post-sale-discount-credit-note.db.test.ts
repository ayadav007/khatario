/**
 * Post-sale discount credit notes (migration 443, s.15(3)(b) CGST Act as substituted by Finance
 * Act 2026): one GST credit note over a period of supplies, no invoice link, no items, no stock.
 * Posts through the real service and routes. Connects only after current_database() is
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
    throw new Error('Refusing discount-note tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing discount-note tests: local database credentials are missing');
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
import { POST as postCreditNote } from '@/app/api/credit-notes/route';
import { createCreditNoteInTransaction, CreditNoteCreateError, type CreateCreditNoteInput } from '@/lib/credit-notes/create-credit-note';

const NOTE_DATE = '2026-10-29';
const FROM = '2026-10-01';
const TO = '2026-10-28';

describe('Post-sale discount credit notes (kh_phase2_test)', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const CUST = randomUUID();
  const SOAP = randomUUID(); // 18%
  const RICE = randomUUID(); // 5%
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

  async function invoice(invoice_date: string, items: unknown[], extra: Record<string, unknown> = {}) {
    const res = await call(
      postInvoice(
        req('/api/invoices', 'POST', {
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date,
          customer_id: CUST,
          branch_id: BR,
          place_of_supply_state_code: '27',
          items,
          ...extra,
        })
      )
    );
    if (res.status !== 201) throw new Error(`invoice ${invoice_date}: ${res.status} ${JSON.stringify(res.json)}`);
    return res.json.invoice as { id: string; invoice_number: string; grand_total: string };
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
  function note(overrides: Partial<CreateCreditNoteInput>) {
    return withTx((c) =>
      createCreditNoteInTransaction(c, {
        businessId: B,
        branchId: BR,
        userId: A,
        customerId: CUST,
        creditNoteNumber: `CN-${tag}-${++cnSeq}`,
        creditNoteDate: NOTE_DATE,
        placeOfSupplyStateCode: '27',
        noteType: 'post_sale_discount',
        supplyPeriodFrom: FROM,
        supplyPeriodTo: TO,
        items: [{ description: 'Oct volume scheme 2%', qty: 1, unit_price: 40, tax_rate: 18 }],
        ...overrides,
      })
    );
  }

  async function failsWith(p: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CreditNoteCreateError);
    expect((caught as CreditNoteCreateError).code).toBe(code);
  }

  async function customerBalance() {
    return Number((await pool.query(`SELECT current_balance::float8 AS b FROM customers WHERE id = $1`, [CUST])).rows[0].b);
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
      [B, `Discount notes ${tag}`, gst]
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
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, gstin, current_balance, phone)
       VALUES ($1,$2,'Asha Traders','27',$3,0,$4)`,
      [CUST, B, `27AAFCA${tag.slice(0, 4).toUpperCase()}D1Z3`, `7${phone}`]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, uqc, selling_price, purchase_price, tax_rate, hsn_sac, current_stock)
       VALUES ($1,$2,'Soap','goods','PCS','PCS',10,6,18,'3401',1000),
              ($3,$2,'Rice','goods','KGS','KGS',40,30,5,'1006',1000)`,
      [SOAP, B, RICE]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,1000), ($1,$2,$4,1000)`,
      [B, BR, SOAP, RICE]
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled) VALUES ($1, false)
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = false`,
      [B]
    );
    // Supplies in the month: ₹2,000 taxable at 18% and ₹500 at 5%.
    await invoice('2026-10-05', [
      { item_id: SOAP, item_name: 'Soap', quantity: 100, unit: 'PCS', unit_price: 10, tax_rate: 18, hsn_sac: '3401' },
      { item_id: RICE, item_name: 'Rice', quantity: 12.5, unit: 'KGS', unit_price: 40, tax_rate: 5, hsn_sac: '1006' },
    ]);
    await invoice('2026-10-20', [
      { item_id: SOAP, item_name: 'Soap', quantity: 100, unit: 'PCS', unit_price: 10, tax_rate: 18, hsn_sac: '3401' },
    ]);
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
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await closePool();
    }
  });

  let discountNoteId = '';

  test('a 2% quarter discount posts as one GST credit note: no invoice, no stock, GST reversed, customer owes less', async () => {
    const before = await customerBalance();
    const cn = await note({});
    discountNoteId = cn.id;

    const row = (
      await pool.query(
        `SELECT note_type, invoice_id, supply_period_from::text AS pf, supply_period_to::text AS pt,
                original_invoice_date::text AS oid, subtotal::float8 AS subtotal, cgst_total::float8 AS cgst,
                sgst_total::float8 AS sgst, igst_total::float8 AS igst, grand_total::float8 AS grand, customer_gstin
           FROM credit_notes WHERE id = $1`,
        [cn.id]
      )
    ).rows[0];
    expect(row.note_type).toBe('post_sale_discount');
    expect(row.invoice_id).toBeNull();
    expect(row.pf).toBe(FROM);
    expect(row.pt).toBe(TO);
    expect(row.oid).toBe(FROM);
    expect(row.subtotal).toBe(40);
    expect(row.cgst).toBe(3.6);
    expect(row.sgst).toBe(3.6);
    expect(row.igst).toBe(0);
    expect(row.grand).toBe(47.2);
    expect(row.customer_gstin).toMatch(/^27/);

    const lines = (
      await pool.query(
        `SELECT item_id, description, qty::float8 AS qty, unit_price::float8 AS price, tax_rate::float8 AS rate, restocked
           FROM credit_note_items WHERE credit_note_id = $1`,
        [cn.id]
      )
    ).rows;
    expect(lines).toEqual([
      { item_id: null, description: 'Oct volume scheme 2%', qty: 1, price: 40, rate: 18, restocked: false },
    ]);

    const moves = await pool.query(
      `SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_type = 'credit_note' AND reference_id = $1`,
      [cn.id]
    );
    expect(moves.rows[0].n).toBe(0);
    expect(await customerBalance()).toBeCloseTo(before - 47.2, 2);

    const ledger = (
      await pool.query(
        `SELECT a.account_code AS code, l.debit::float8 AS debit, l.credit::float8 AS credit, l.narration
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.voucher_type = 'credit_note' AND l.voucher_id = $1
          ORDER BY a.account_code`,
        [cn.id]
      )
    ).rows;
    const byCode = Object.fromEntries(ledger.map((l) => [l.code, l]));
    expect(byCode['4101']).toMatchObject({ debit: 40, credit: 0 });
    expect(byCode['4101'].narration).toMatch(/Post-sale discount/);
    expect(byCode['1103']).toMatchObject({ debit: 0, credit: 47.2 });
    const outputGstDebits = ledger.filter((l) => l.code !== '4101' && l.code !== '1103').reduce((s, l) => s + l.debit, 0);
    expect(outputGstDebits).toBeCloseTo(7.2, 2);
  });

  test('GSTR-1 lists the discount note under CDNR with no original invoice', async () => {
    const gstr1 = await new GSTR1Generator().generate({ business_id: B, from_date: NOTE_DATE, to_date: NOTE_DATE });
    const rows = (gstr1 as any).cdn.filter((r: any) => r.document_id === discountNoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      note_type: 'C',
      original_invoice_number: null,
      tax_rate: 18,
      taxable_value: 40,
      cgst_amount: 3.6,
      sgst_amount: 3.6,
    });
    expect(rows[0].gstin_uin_recipient).toMatch(/^27/);
    expect(rows[0].original_invoice_date).toBeTruthy();
  });

  test('a discount note refuses an invoice link, a missing or late period, items and blank descriptions', async () => {
    const inv = (await pool.query(`SELECT id FROM invoices WHERE business_id = $1 ORDER BY invoice_date LIMIT 1`, [B])).rows[0];
    await failsWith(note({ invoiceId: inv.id }), 'DISCOUNT_NOTE_HAS_INVOICE');
    await failsWith(note({ supplyPeriodFrom: null, supplyPeriodTo: null }), 'DISCOUNT_PERIOD_INVALID');
    await failsWith(note({ supplyPeriodFrom: TO, supplyPeriodTo: FROM }), 'DISCOUNT_PERIOD_INVALID');
    await failsWith(note({ supplyPeriodTo: '2026-10-30' }), 'DISCOUNT_PERIOD_INVALID');
    await failsWith(
      note({ items: [{ item_id: SOAP, item_name: 'Soap', description: 'Soap', qty: 1, unit_price: 40, tax_rate: 18 }] }),
      'DISCOUNT_LINE_HAS_ITEM'
    );
    await failsWith(note({ items: [{ description: '  ', qty: 1, unit_price: 40, tax_rate: 18 }] }), 'DESCRIPTION_REQUIRED');
  });

  test('the s.34(2) deadline runs from the first day of the covered period', async () => {
    // FY 2026-27 ends 31 Mar 2027, so 30 Nov 2027 is the last date; 5 Dec 2027 is late.
    await failsWith(note({ creditNoteDate: '2027-12-05' }), 'CREDIT_NOTE_TIME_BARRED');
  });

  test('the discount at a rate is capped at the customer’s sales at that rate in the period, net of earlier discount notes', async () => {
    // 18%: ₹2,000 sold, ₹40 already discounted → ₹1,960 left.
    await failsWith(note({ items: [{ description: 'Too much', qty: 1, unit_price: 1961, tax_rate: 18 }] }), 'DISCOUNT_EXCEEDS_SALES');
    // 5%: ₹500 sold, nothing discounted yet.
    await failsWith(note({ items: [{ description: 'Too much', qty: 1, unit_price: 501, tax_rate: 5 }] }), 'DISCOUNT_EXCEEDS_SALES');
    // A rate the customer never bought at.
    await failsWith(note({ items: [{ description: 'No sales', qty: 1, unit_price: 1, tax_rate: 0 }] }), 'DISCOUNT_EXCEEDS_SALES');
    // Up to what is left is fine, with a rate split across two lines (₹100 at 5% stays open).
    const ok = await note({
      items: [
        { description: 'Soap scheme', qty: 1, unit_price: 1000, tax_rate: 18 },
        { description: 'Soap scheme, late Oct', qty: 1, unit_price: 960, tax_rate: 18 },
        { description: 'Rice scheme', qty: 1, unit_price: 400, tax_rate: 5 },
      ],
    });
    expect(Number(ok.subtotal)).toBe(2360);
  });

  test('a sales return to a GSTIN customer still needs its invoice, and an item-less return line needs a description', async () => {
    await failsWith(
      note({ noteType: 'sales_return', supplyPeriodFrom: null, supplyPeriodTo: null, items: [{ description: 'x', qty: 1, unit_price: 10, tax_rate: 18 }] }),
      'ORIGINAL_INVOICE_REQUIRED'
    );
    const inv = (await pool.query(`SELECT id FROM invoices WHERE business_id = $1 ORDER BY invoice_date LIMIT 1`, [B])).rows[0];
    await failsWith(
      note({
        noteType: 'sales_return',
        supplyPeriodFrom: null,
        supplyPeriodTo: null,
        invoiceId: inv.id,
        items: [{ description: '', qty: 1, unit_price: 10, tax_rate: 18 }],
      }),
      'DESCRIPTION_REQUIRED'
    );
  });

  test('the POST route accepts the discount fields and the next invoice spends the credit', async () => {
    const res = await call(
      postCreditNote(
        req('/api/credit-notes', 'POST', {
          customer_id: CUST,
          branch_id: BR,
          credit_note_number: `CN-${tag}-route`,
          credit_note_date: NOTE_DATE,
          note_type: 'post_sale_discount',
          supply_period_from: FROM,
          supply_period_to: TO,
          reason: 'Late Oct rate difference',
          items: [{ description: 'Late Oct rate difference', qty: 1, unit_price: 0.5, tax_rate: 5 }],
        })
      )
    );
    if (res.status !== 201) throw new Error(`credit note route: ${res.status} ${JSON.stringify(res.json)}`);
    expect(res.json.creditNote).toMatchObject({ note_type: 'post_sale_discount' });

    const inv = await invoice('2026-10-29', [
      { item_id: SOAP, item_name: 'Soap', quantity: 10, unit: 'PCS', unit_price: 10, tax_rate: 18, hsn_sac: '3401' },
    ], { customer_credit_amount: 47.2 });
    const applied = await pool.query(
      `SELECT amount::float8 AS amount FROM credit_note_applications WHERE credit_note_id = $1 AND invoice_id = $2 AND reversed_at IS NULL`,
      [discountNoteId, inv.id]
    );
    expect(applied.rows).toEqual([{ amount: 47.2 }]);
  });
});
