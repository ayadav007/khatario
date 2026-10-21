/**
 * Phase 2B Table 8A books estimate. Inserts are rolled back.
 * Writes only after current_database() is kh_phase2_test on port 5433.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';

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
    throw new Error('Refusing purchase tests: database host is not local');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

import { getPool, closePool } from '@/lib/db';
import { computeTable8A } from '@/lib/gst/gstr9-table8a';

const GSTIN = '27ABCDE1234F1Z5';

describe('phase 2B Table 8A books charges', () => {
  jest.setTimeout(60000);
  let c: PoolClient;

  async function assertDb() {
    const info = (
      await c.query<{ db: string; port: number; addr: string }>(
        `SELECT current_database() AS db, inet_server_port() AS port, inet_server_addr()::text AS addr`
      )
    ).rows[0];
    const addr = info.addr || '';
    const local = addr.startsWith('127.') || addr.startsWith('::1') || addr === '';
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !local) {
      throw new Error(`Refusing to mutate ${info.db} on ${info.addr}:${info.port}`);
    }
  }

  async function business(): Promise<string> {
    const id = randomUUID();
    const branch = randomUUID();
    const supplier = randomUUID();
    await c.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [id, `T8B ${id.slice(0, 8)}`]
    );
    await c.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [branch, id]
    );
    await c.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance) VALUES ($1, $2, 'Mill', '27', $3, 0)`,
      [supplier, id, GSTIN]
    );
    return id;
  }

  async function bill(
    businessId: string,
    opts: { date: string; taxable: number; cgst: number; sgst: number; igst?: number }
  ) {
    const id = randomUUID();
    const supplier = (await c.query<{ id: string }>(`SELECT id FROM suppliers WHERE business_id = $1`, [businessId])).rows[0].id;
    const branch = (await c.query<{ id: string }>(`SELECT id FROM branches WHERE business_id = $1`, [businessId])).rows[0].id;
    const tax = opts.cgst + opts.sgst + (opts.igst || 0);
    await c.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, supplier_gstin)
       VALUES ($1,$2,$3,$4,$5,'final','27',false,true,$6,$7,$8,$9,$10,$11,0,$11,'unpaid',$12,$13)`,
      [id, businessId, supplier, `B-${id.slice(0, 8)}`, opts.date, opts.taxable, tax, opts.cgst, opts.sgst, opts.igst || 0,
        opts.taxable + tax, branch, GSTIN]
    );
    await c.query(
      `INSERT INTO purchase_items (purchase_id, item_name, quantity, unit_price, taxable_value, tax_rate, tax_amount,
          cgst_amount, sgst_amount, igst_amount, line_total)
       VALUES ($1, 'Goods', 1, $2, $2, 18, $3, $4, $5, $6, $7)`,
      [id, opts.taxable, tax, opts.cgst, opts.sgst, opts.igst || 0, opts.taxable + tax]
    );
    return id;
  }

  async function charge(
    businessId: string,
    purchaseId: string,
    opts: { classification: 'incidental_to_goods' | 'independent_service'; taxable: number; cgst: number; sgst: number; igst?: number }
  ) {
    const tax = opts.cgst + opts.sgst + (opts.igst || 0);
    await c.query(
      `INSERT INTO purchase_charges (
         purchase_id, business_id, purpose, classification, hsn_sac, tax_rate,
         taxable_value, cgst_amount, sgst_amount, igst_amount, tax_amount
       ) VALUES ($1,$2,$3,$4,'9965',18,$5,$6,$7,$8,$9)`,
      [purchaseId, businessId, opts.classification, opts.classification, opts.taxable, opts.cgst, opts.sgst, opts.igst || 0, tax]
    );
  }

  async function ret(
    businessId: string,
    purchaseId: string,
    opts: { taxable: number; cgst: number; sgst: number; igst?: number; status?: string }
  ) {
    const supplier = (await c.query<{ id: string }>(`SELECT id FROM suppliers WHERE business_id = $1`, [businessId])).rows[0].id;
    const branch = (await c.query<{ id: string }>(`SELECT id FROM branches WHERE business_id = $1`, [businessId])).rows[0].id;
    const tax = opts.cgst + opts.sgst + (opts.igst || 0);
    await c.query(
      `INSERT INTO purchase_returns (business_id, supplier_id, purchase_id, return_number, return_date, subtotal,
          tax_total, cgst_total, sgst_total, igst_total, grand_total, branch_id, status)
       VALUES ($1,$2,$3,$4,'2026-08-20',$5,$6,$7,$8,$9,$10,$11,$12)`,
      [businessId, supplier, purchaseId, `PR-${randomUUID().slice(0, 8)}`, opts.taxable, tax, opts.cgst, opts.sgst,
        opts.igst || 0, opts.taxable + tax, branch, opts.status ?? 'final']
    );
  }

  beforeAll(async () => {
    c = await getPool().connect();
    await c.query('BEGIN');
    await assertDb();
  });

  afterAll(async () => {
    if (!c) return;
    try {
      await c.query('ROLLBACK');
    } finally {
      c.release();
      await closePool();
    }
  });

  test('a goods-only bill and a historical bill without charge rows use item totals', async () => {
    const goods = await business();
    await bill(goods, { date: '2026-08-05', taxable: 1000, cgst: 90, sgst: 90 });
    const historical = await business();
    const old = await bill(historical, { date: '2026-08-05', taxable: 3000, cgst: 270, sgst: 270 });
    await ret(historical, old, { taxable: 1000, cgst: 90, sgst: 90 });

    const goodsReport = await computeTable8A(c, goods, 2026);
    expect(goodsReport.A.taxable_value).toBeCloseTo(1000, 2);
    expect(goodsReport.A.cgst).toBeCloseTo(90, 2);
    expect(goodsReport.A.sgst).toBeCloseTo(90, 2);

    const oldReport = await computeTable8A(c, historical, 2026);
    expect(oldReport.A.taxable_value).toBeCloseTo(2000, 2);
    expect(oldReport.A.cgst).toBeCloseTo(180, 2);
    expect(oldReport.warnings[0]).toContain('internal books estimate');
    expect(oldReport.warnings[0]).toContain('not the authoritative portal Table 8A');
  });

  test('incidental freight is added once and a refunded return removes that freight once', async () => {
    const id = await business();
    const purchaseId = await bill(id, { date: '2026-08-05', taxable: 10000, cgst: 900, sgst: 900 });
    await charge(id, purchaseId, { classification: 'incidental_to_goods', taxable: 1000, cgst: 90, sgst: 90 });
    await ret(id, purchaseId, { taxable: 4400, cgst: 396, sgst: 396 });

    const report = await computeTable8A(c, id, 2026);
    expect(report.A.taxable_value).toBeCloseTo(6600, 2);
    expect(report.A.cgst).toBeCloseTo(594, 2);
    expect(report.A.sgst).toBeCloseTo(594, 2);
  });

  test('an unrefunded return leaves the incidental freight in the books estimate', async () => {
    const id = await business();
    const purchaseId = await bill(id, { date: '2026-08-05', taxable: 10000, cgst: 900, sgst: 900 });
    await charge(id, purchaseId, { classification: 'incidental_to_goods', taxable: 1000, cgst: 90, sgst: 90 });
    await ret(id, purchaseId, { taxable: 4000, cgst: 360, sgst: 360 });

    const report = await computeTable8A(c, id, 2026);
    expect(report.A.taxable_value).toBeCloseTo(7000, 2);
    expect(report.A.cgst).toBeCloseTo(630, 2);
    expect(report.A.sgst).toBeCloseTo(630, 2);
  });

  test('an independent service charge is included once and a cancelled return is ignored', async () => {
    const id = await business();
    const purchaseId = await bill(id, { date: '2026-08-05', taxable: 2000, cgst: 180, sgst: 180 });
    await charge(id, purchaseId, { classification: 'independent_service', taxable: 500, cgst: 45, sgst: 45 });
    await ret(id, purchaseId, { taxable: 500, cgst: 45, sgst: 45, status: 'cancelled' });

    const report = await computeTable8A(c, id, 2026);
    expect(report.A.taxable_value).toBeCloseTo(2500, 2);
    expect(report.A.cgst).toBeCloseTo(225, 2);
    expect(report.A.sgst).toBeCloseTo(225, 2);
  });

  test('a portal month stays on GSTR-2B and does not add that month’s purchase charges', async () => {
    const id = await business();
    const purchaseId = await bill(id, { date: '2026-05-12', taxable: 10000, cgst: 900, sgst: 900 });
    await charge(id, purchaseId, { classification: 'incidental_to_goods', taxable: 1000, cgst: 90, sgst: 90 });
    const imp = randomUUID();
    await c.query(
      `INSERT INTO gstr2b_imports (id, business_id, filing_period, import_date, file_hash, total_invoices)
       VALUES ($1, $2, '2026-05', '2026-06-20T10:00:00Z', $3, 1)`,
      [imp, id, randomUUID().replace(/-/g, '')]
    );
    await c.query(
      `INSERT INTO gstr2b_invoices (import_id, business_id, filing_period, supplier_gstin, invoice_number, invoice_date,
          document_type, taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, itc_eligibility, reverse_charge)
       VALUES ($1, $2, '2026-05', $3, 'S-1', '2026-05-03', 'invoice', 500, 0, 45, 45, 0, 'eligible', 'N')`,
      [imp, id, GSTIN]
    );

    const report = await computeTable8A(c, id, 2026);
    expect(report.portal_periods).toContain('2026-05');
    expect(report.books_periods).not.toContain('2026-05');
    expect(report.A.taxable_value).toBeCloseTo(500, 2);
    expect(report.A.cgst).toBeCloseTo(45, 2);
    expect(report.A.sgst).toBeCloseTo(45, 2);
  });
});
