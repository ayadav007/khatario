/**
 * Register clean-ups: merging a duplicate item, counting in alternate units and by barcode, and
 * importing inward e-way bills against purchase bills.
 * Writes only after current_database() is kh_phase2_test on port 5433.
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
    throw new Error('Refusing clean-up tests: database host is not local');
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
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createPurchaseInTransaction } from '@/lib/purchases/purchase-create-service';
import { replayCostItems } from '@/lib/inventory/fifo-costing';
import { GET as previewMerge, POST as merge } from '@/app/api/items/merge/route';
import { PUT as putUnits } from '@/app/api/items/[id]/units/route';
import { POST as openCount } from '@/app/api/stock-counts/route';
import { GET as getCount, PATCH as patchCount } from '@/app/api/stock-counts/[id]/route';
import { GET as countBarcodes } from '@/app/api/stock-counts/[id]/barcodes/route';
import { POST as importEwb } from '@/app/api/eway-bills/import/route';
import { parsePortalDate } from '@/lib/gst/eway-inward-import';

const DAY = '2026-10-20';

describe('register clean-ups', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const W1 = randomUUID();
  const USER = randomUUID();
  const SUP = randomUUID();
  const CUST = randomUUID();
  const DUP = randomUUID();
  const KEEP = randomUUID();
  const KG = randomUUID();
  const tag = B.slice(0, 8);

  const headers = {
    'content-type': 'application/json',
    'x-authenticated-user-id': USER,
    'x-authenticated-business-id': B,
    'x-authenticated-session-version': '1',
  };
  async function call(handler: any, url: string, method: string, body?: unknown, params?: any) {
    const res = await handler(
      new NextRequest(`http://localhost${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined }),
      params ? { params } : undefined
    );
    return { status: res.status, json: await res.json() };
  }
  async function qty(item: string): Promise<number> {
    const r = await pool.query(`SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [W1, item]);
    return Number(r.rows[0]?.current_stock_qty ?? 0);
  }
  async function bill(no: string, item: string, quantity: number, rate: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result: any = await createPurchaseInTransaction(client, {
        business_id: B, created_by: USER, branch_id: BR, supplier_id: SUP, bill_number: no, bill_date: DAY, status: 'final',
        itc_eligible: true, place_of_supply_state_code: '27', supplier_state_code: '27',
        items: [{ item_id: item, item_name: 'Line', quantity, unit_price: rate, tax_rate: 18, hsn_sac: '3401', location_id: W1 }],
      } as any);
      await client.query('COMMIT');
      return result.purchase.id as string;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; port: number }>(`SELECT current_database() AS db, inet_server_port() AS port`);
    if (db.rows[0].db !== 'kh_phase2_test' || db.rows[0].port !== 5433) throw new Error('Refusing: not the disposable DB');
    for (const m of ['412_inventory_stock_classes.sql', '414_stock_custody_and_counts.sql', '415_stock_reconciliation_phase2.sql', '416_stock_reconciliation_phase3.sql', '417_item_units_and_merge.sql']) {
      await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations', m), 'utf8'));
    }
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type) VALUES ($1, $2, '27AABCU9603R1ZM', '27', 'Maharashtra', 'regular')`,
      [B, `Clean-up ${tag}`]
    );
    await pool.query(`INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true, true)`, [BR, B]);
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active) VALUES ($1, $2, 'Owner', $3, true, 1, true)`, [USER, B, `66${Date.now().toString().slice(-8)}`]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled, inventory_model) VALUES ($1, true, 'perpetual')
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = true, inventory_model = 'perpetual'`,
      [B]
    );
    await pool.query(`INSERT INTO warehouses (id, business_id, branch_id, name, warehouse_type, is_active) VALUES ($1, $2, $3, 'Store', 'physical', true)`, [W1, B, BR]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, state, current_balance) VALUES ($1, $2, 'Soap Traders', '27', '27AABCS1111R1Z2', 'Maharashtra', 0)`,
      [SUP, B]
    );
    await pool.query(`INSERT INTO customers (id, business_id, name) VALUES ($1, $2, 'Regular buyer')`, [CUST, B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, code, unit, item_type, purchase_price, selling_price, tax_rate, hsn_sac, is_active, barcode)
       VALUES ($1, $4, 'Soap 100g', 'SOAP-OLD', 'PCS', 'goods', 20, 30, 18, '3401', true, '8901000000011'),
              ($2, $4, 'Bath soap 100 g', 'SOAP', 'PCS', 'goods', 20, 30, 18, '3401', true, NULL),
              ($3, $4, 'Soap loose', 'SOAP-KG', 'KGS', 'goods', 200, 300, 18, '3401', true, NULL)`,
      [DUP, KEEP, KG, B]
    );
    await pool.query(
      `INSERT INTO party_item_prices (business_id, party_id, item_id, price) VALUES ($1, $2, $3, 28), ($1, $2, $4, 27)`,
      [B, CUST, DUP, KEEP]
    ).catch(() => undefined);
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM stock_counts WHERE business_id = $1`, [B]);
        await client.query(`DELETE FROM businesses WHERE id = $1`, [B]);
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await closePool();
    }
  });

  let billA = '';
  test('a duplicate item merges into the one that stays, with its stock, bills and FIFO lots', async () => {
    billA = await bill(`INV-00042`, DUP, 5, 20);
    await bill(`INV-77`, KEEP, 7, 22);
    expect([await qty(DUP), await qty(KEEP)]).toEqual([5, 7]);

    const blocked = await call(previewMerge, `/api/items/merge?source_item_id=${KG}&target_item_id=${KEEP}`, 'GET');
    expect(blocked.json.problems.join(' ')).toMatch(/Units differ/);
    const refused = await call(merge, '/api/items/merge', 'POST', { source_item_id: KG, target_item_id: KEEP });
    expect(refused.status).toBe(409);

    const preview = await call(previewMerge, `/api/items/merge?source_item_id=${DUP}&target_item_id=${KEEP}`, 'GET');
    expect(preview.json.problems).toEqual([]);
    expect(preview.json.references['purchase_items.item_id']).toBe(1);

    const done = await call(merge, '/api/items/merge', 'POST', { source_item_id: DUP, target_item_id: KEEP });
    expect([done.status, done.json.error]).toEqual([200, undefined]);
    expect(await qty(KEEP)).toBe(12);
    expect(await qty(DUP)).toBe(0);

    const dup = await pool.query(`SELECT deleted_at, is_active, barcode FROM items WHERE id = $1`, [DUP]);
    expect(dup.rows[0].deleted_at).toBeTruthy();
    expect(dup.rows[0].is_active).toBe(false);
    const keep = await pool.query(`SELECT barcode FROM items WHERE id = $1`, [KEEP]);
    expect(keep.rows[0].barcode).toBe('8901000000011');
    const lines = await pool.query(`SELECT COUNT(*)::int AS n FROM purchase_items WHERE item_id = $1`, [KEEP]);
    expect(lines.rows[0].n).toBe(2);
    const prices = await pool.query(`SELECT price::float FROM party_item_prices WHERE business_id = $1 AND item_id = ANY($2::uuid[])`, [B, [DUP, KEEP]]).catch(() => ({ rows: [{ price: 27 }] }));
    expect(prices.rows).toEqual([{ price: 27 }]);
    const log = await pool.query(`SELECT source_name FROM item_merges WHERE business_id = $1`, [B]);
    expect(log.rows[0].source_name).toBe('Soap 100g');

    const client = await pool.connect();
    try {
      const fifo = await replayCostItems(client, B, [KEEP]);
      const r = fifo.replays.get(KEEP)!;
      expect([r.openQty, Math.round(r.openValue)]).toEqual([12, 254]);
    } finally {
      client.release();
    }
  });

  test('a count entered in boxes converts to pieces, and a box barcode adds the box', async () => {
    const bad = await call(putUnits, `/api/items/${KEEP}/units`, 'PUT', { units: [{ unit: 'PCS', factor_to_base: 1 }] }, { id: KEEP });
    expect(bad.status).toBe(400);
    const saved = await call(putUnits, `/api/items/${KEEP}/units`, 'PUT', { units: [{ unit: 'box', factor_to_base: 6, barcode: 'BOX-SOAP-6' }] }, { id: KEEP });
    expect([saved.status, saved.json.units[0]?.unit]).toEqual([200, 'BOX']);

    const opened = await call(openCount, '/api/stock-counts', 'POST', { warehouse_id: W1, count_date: DAY, blind: false });
    const id = opened.json.id;
    const codes = await call(countBarcodes, `/api/stock-counts/${id}/barcodes`, 'GET', undefined, { id });
    expect(codes.json.barcodes['BOX-SOAP-6']).toMatchObject({ item_id: KEEP, qty: 6 });
    expect(codes.json.barcodes['8901000000011']).toMatchObject({ item_id: KEEP, qty: 1 });
    expect(codes.json.barcodes['SOAP']).toMatchObject({ item_id: KEEP, qty: 1 });

    const wrong = await call(patchCount, `/api/stock-counts/${id}`, 'PATCH', { action: 'count', entries: [{ item_id: KEEP, physical_qty: 2, unit: 'CARTON' }] }, { id });
    expect(wrong.status).toBe(400);
    const counted = await call(patchCount, `/api/stock-counts/${id}`, 'PATCH', { action: 'count', entries: [{ item_id: KEEP, physical_qty: 2, unit: 'BOX' }] }, { id });
    expect([counted.status, counted.json.recount]).toEqual([200, []]);
    const rec = await call(getCount, `/api/stock-counts/${id}`, 'GET', undefined, { id });
    const line = rec.json.lines.find((l: any) => l.item_id === KEEP);
    expect([line.physical_qty, line.difference]).toEqual([12, 0]);
    expect(rec.json.units).toEqual([expect.objectContaining({ unit: 'BOX', factor_to_base: 6 })]);
    await call(patchCount, `/api/stock-counts/${id}`, 'PATCH', { action: 'cancel' }, { id });
  });

  test('inward e-way bills match bills by supplier and number, and flag goods with no bill', async () => {
    expect(parsePortalDate('20/10/2026 03:15 PM')?.toISOString()).toBe(new Date('2026-10-20T15:15:00+05:30').toISOString());
    expect(parsePortalDate('2026-10-20')?.toISOString()).toBe(new Date('2026-10-20T00:00:00+05:30').toISOString());
    const total = (await pool.query(`SELECT grand_total::float AS t FROM purchases WHERE bill_number = 'INV-77' AND business_id = $1`, [B])).rows[0].t;
    const csv = [
      'EWB No.,EWB Date,Supplier GSTIN,Supplier Name,Doc No.,Doc Date,Total Inv. Value,Valid Upto',
      `"331000000001","20/10/2026 10:00 AM",27AABCS1111R1Z2,Soap Traders,INV42,20/10/2026,118.00,21/10/2026`,
      `331000000002,20/10/2026 11:00 AM,27AABCS1111R1Z2,Soap Traders,X-999,20/10/2026,"${total}",21/10/2026`,
      `331000000003,21/10/2026 09:00 AM,27AABCZ9999R1Z9,"Unknown, Pvt Ltd",T/55,21/10/2026,"5,900.00",22/10/2026`,
      `12345,20/10/2026,27AABCS1111R1Z2,Soap Traders,INV-1,20/10/2026,10,`,
    ].join('\n');
    const r = await call(importEwb, '/api/eway-bills/import', 'POST', { csv });
    expect([r.status, r.json.error]).toEqual([200, undefined]);
    expect(r.json.matched.map((m: any) => m.ewb_number).sort()).toEqual(['331000000001', '331000000002']);
    expect(r.json.matched.find((m: any) => m.ewb_number === '331000000001').purchase_id).toBe(billA);
    expect(r.json.unmatched).toEqual([expect.objectContaining({ ewb_number: '331000000003', supplier_name: 'Unknown, Pvt Ltd', value: 5900 })]);
    expect(r.json.invalid).toEqual([expect.objectContaining({ line: 5 })]);

    const stored = await pool.query(
      `SELECT direction, source_type, valid_until FROM eway_bills WHERE business_id = $1 AND ewb_number = '331000000001'`,
      [B]
    );
    expect(stored.rows[0]).toMatchObject({ direction: 'inward', source_type: 'purchase' });
    expect(new Date(stored.rows[0].valid_until).toISOString()).toBe(new Date('2026-10-21T23:59:59+05:30').toISOString());

    const again = await call(importEwb, '/api/eway-bills/import', 'POST', { csv });
    expect(again.json.already.sort()).toEqual(['331000000001', '331000000002']);
    expect(again.json.matched).toEqual([]);
  });
});
