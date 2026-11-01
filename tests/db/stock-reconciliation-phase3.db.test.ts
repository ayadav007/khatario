/**
 * Stock reconciliation, phase 3: manufacturing through work in progress, held stock, other
 * people's goods, import transit stages, insurance claims and e-way bill JSON.
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
    throw new Error('Refusing stock reconciliation tests: database host is not local');
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
import { POST as postBom } from '@/app/api/manufacturing/boms/route';
import { POST as postProduction } from '@/app/api/manufacturing/production/route';
import { POST as postHold } from '@/app/api/stock-holds/route';
import { POST as settleHold } from '@/app/api/stock-holds/[id]/route';
import { POST as postOthers } from '@/app/api/inward-custody/route';
import { PATCH as returnOthers } from '@/app/api/inward-custody/[id]/route';
import { POST as openCount } from '@/app/api/stock-counts/route';
import { GET as getCount, PATCH as patchCount } from '@/app/api/stock-counts/[id]/route';
import { POST as lodge } from '@/app/api/insurance-claims/route';
import { PATCH as patchClaim } from '@/app/api/insurance-claims/[id]/route';
import { POST as receiveGoods } from '@/app/api/purchases/[id]/receive-goods/route';
import { GET as thirdParty } from '@/app/api/reports/stock/third-party/route';
import { GET as quantitative } from '@/app/api/reports/stock/quantitative/route';
import { GET as ewayExport } from '@/app/api/eway-bills/export/route';
import { POST as postChallan } from '@/app/api/delivery-challans/route';

const DAY = '2026-10-20';

describe('stock reconciliation phase 3', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const W1 = randomUUID();
  const USER = randomUUID();
  const SUP = randomUUID();
  const CUST = randomUUID();
  const RM = randomUUID();
  const FG = randomUUID();
  const SCRAP = randomUUID();
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
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }
  async function qty(item: string): Promise<number> {
    const r = await pool.query(`SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [W1, item]);
    return Number(r.rows[0]?.current_stock_qty ?? 0);
  }
  async function balance(code: string): Promise<number> {
    const r = await pool.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS b FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.business_id = $1 AND a.account_code = $2`,
      [B, code]
    );
    return Math.round(r.rows[0].b * 100) / 100;
  }
  async function bill(no: string, item: string, quantity: number, rate: number, inTransit = false) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result: any = await createPurchaseInTransaction(client, {
        business_id: B, created_by: USER, branch_id: BR, supplier_id: SUP, bill_number: no, bill_date: DAY, status: 'final',
        itc_eligible: true, place_of_supply_state_code: '27', supplier_state_code: '27', goods_in_transit: inTransit,
        items: [{ item_id: item, item_name: 'Line', quantity, unit_price: rate, tax_rate: 18, hsn_sac: '7208', location_id: W1 }],
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
    for (const m of ['412_inventory_stock_classes.sql', '414_stock_custody_and_counts.sql', '415_stock_reconciliation_phase2.sql', '416_stock_reconciliation_phase3.sql']) {
      await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations', m), 'utf8'));
    }
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type, address_line1, city, pincode)
       VALUES ($1, $2, '27AABCU9603R1ZM', '27', 'Maharashtra', 'regular', 'Plot 4, MIDC', 'Pune', '411019')`,
      [B, `Stock reco 3 ${tag}`]
    );
    await pool.query(`INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true, true)`, [BR, B]);
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active) VALUES ($1, $2, 'Owner', $3, true, 1, true)`, [USER, B, `65${Date.now().toString().slice(-8)}`]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations/416_stock_reconciliation_phase3.sql'), 'utf8'));
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled, inventory_model) VALUES ($1, true, 'perpetual')
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = true, inventory_model = 'perpetual'`,
      [B]
    );
    await pool.query(`INSERT INTO warehouses (id, business_id, branch_id, name, warehouse_type, is_active) VALUES ($1, $2, $3, 'Plant', 'physical', true)`, [W1, B, BR]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, state, address, city, pincode, current_balance)
       VALUES ($1, $2, 'Steel Co', '27', '27AABCM1234R1Z5', 'Maharashtra', 'Bhosari', 'Pune', '411026', 0)`,
      [SUP, B]
    );
    await pool.query(`INSERT INTO customers (id, business_id, name) VALUES ($1, $2, 'Repair customer')`, [CUST, B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, uqc, item_type, purchase_price, selling_price, tax_rate, hsn_sac, is_active, stock_class)
       VALUES ($1, $4, 'Steel sheet', 'KGS', 'KGS', 'goods', 10, 12, 18, '7208', true, 'raw_material'),
              ($2, $4, 'Bracket', 'NOS', 'NOS', 'goods', 0, 40, 18, '7326', true, 'finished_goods'),
              ($3, $4, 'Steel scrap', 'KGS', 'KGS', 'goods', 0, 5, 18, '7204', true, 'trading')`,
      [RM, FG, SCRAP, B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM stock_counts WHERE business_id = $1`, [B]);
        await client.query(`DELETE FROM production_entries WHERE business_id = $1`, [B]);
        await client.query(`DELETE FROM stock_holds WHERE business_id = $1`, [B]);
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

  test('production issues inputs into WIP and receives the output at their cost, less scrap', async () => {
    await bill(`RM-${tag}`, RM, 100, 10);
    expect(await qty(RM)).toBe(100);
    const bom = await call(postBom, '/api/manufacturing/boms', 'POST', {
      name: 'Bracket', output_item_id: FG, output_qty: 1,
      lines: [{ item_id: RM, role: 'input', qty: 2 }, { item_id: SCRAP, role: 'scrap', qty: 0.1, recovery_rate: 5 }],
    });
    expect([bom.status, bom.json.error]).toEqual([201, undefined]);

    const tooMuch = await call(postProduction, '/api/manufacturing/production', 'POST', { date: DAY, warehouse_id: W1, bom_id: bom.json.id, batches: 60 });
    expect(tooMuch.status).toBe(409);
    expect(await qty(RM)).toBe(100);

    const made = await call(postProduction, '/api/manufacturing/production', 'POST', { date: DAY, warehouse_id: W1, bom_id: bom.json.id, batches: 10 });
    expect([made.status, made.json.error]).toEqual([201, undefined]);
    expect(made.json).toMatchObject({ input_cost: 200, recovery_value: 5, output_cost: 195, output_unit_cost: 19.5 });
    expect([await qty(RM), await qty(FG), await qty(SCRAP)]).toEqual([80, 10, 1]);
    expect(await balance('1161')).toBe(0);
    expect(await balance('1160')).toBe(800);
    expect(await balance('1162')).toBe(195);

    const client = await pool.connect();
    try {
      const fifo = await replayCostItems(client, B, [FG]);
      expect(Math.round(fifo.replays.get(FG)!.openValue)).toBe(195);
    } finally {
      client.release();
    }

    const q = await call(quantitative, '/api/reports/stock/quantitative?from=2026-04-01&to=2027-03-31', 'GET');
    const rm = q.json.rows.find((r: any) => r.item_id === RM);
    const fg = q.json.rows.find((r: any) => r.item_id === FG);
    expect([rm.purchases, rm.consumed, rm.closing]).toEqual([100, 20, 80]);
    expect([fg.produced, fg.closing]).toEqual([10, 10]);
  });

  let holdId = '';
  test('held stock leaves saleable stock but a count still expects it on the shelf', async () => {
    const held = await call(postHold, '/api/stock-holds', 'POST', { item_id: FG, qty: 4, purpose: 'qc_hold', date: DAY, warehouse_id: W1 });
    expect([held.status, held.json.error]).toEqual([201, undefined]);
    holdId = held.json.id;
    expect(await qty(FG)).toBe(6);

    const others = await call(postOthers, '/api/inward-custody', 'POST', {
      owner_type: 'customer', owner_id: CUST, description: 'Customer press for repair', qty: 3, received_date: DAY, reason: 'repair', warehouse_id: W1,
    });
    expect([others.status, others.json.error]).toEqual([201, undefined]);

    const opened = await call(openCount, '/api/stock-counts', 'POST', { warehouse_id: W1, count_date: DAY, blind: false });
    expect(opened.status).toBe(201);
    const id = opened.json.id;
    const counted = await call(patchCount, `/api/stock-counts/${id}`, 'PATCH', {
      action: 'count', entries: [{ item_id: FG, physical_qty: 10, third_party_qty: 3 }],
    }, { id });
    expect(counted.json.recount).toEqual([]);
    await call(patchCount, `/api/stock-counts/${id}`, 'PATCH', { action: 'submit', fill_uncounted: 'book' }, { id });
    const rec = await call(getCount, `/api/stock-counts/${id}`, 'GET', undefined, { id });
    const line = rec.json.lines.find((l: any) => l.item_id === FG);
    expect(line).toMatchObject({ held_qty: 4, expected_qty: 10, difference: 0 });
    expect(rec.json.summary).toMatchObject({ others_goods_registered: 3, third_party_goods_in_godown: 3, unexplained_qty: 0 });
    expect(rec.json.held).toHaveLength(1);
    await call(patchCount, `/api/stock-counts/${id}`, 'PATCH', { action: 'cancel' }, { id });

    const back = await call(returnOthers, `/api/inward-custody/${others.json.id}`, 'PATCH', { qty: 3, date: '2026-10-22' }, { id: others.json.id });
    expect(back.json.status).toBe('returned');
  });

  let writeOff = '';
  test('held stock is released or written off', async () => {
    const settled = await call(settleHold, `/api/stock-holds/${holdId}`, 'POST', { date: '2026-10-21', release: 2, write_off: 2, reason: 'DAMAGE' }, { id: holdId });
    expect([settled.status, settled.json.error, settled.json.closed]).toEqual([200, undefined, true]);
    expect(await qty(FG)).toBe(8);
    writeOff = settled.json.adjustmentId;
    const adj = await pool.query(`SELECT reason_code, quantity_change::float AS q, ABS(value_change)::float AS v FROM inventory_adjustments WHERE id = $1`, [writeOff]);
    expect(adj.rows[0]).toMatchObject({ reason_code: 'DAMAGE', q: -2, v: 39 });
  });

  test('an insurance claim moves the admitted amount off the loss and into the bank on settlement', async () => {
    const noFir = await call(lodge, '/api/insurance-claims', 'POST', { loss_date: '2026-10-21', cause: 'theft', insurer: 'New India Assurance', claimed_amount: 39 });
    expect(noFir.status).toBe(400);
    const lodged = await call(lodge, '/api/insurance-claims', 'POST', {
      loss_date: '2026-10-21', cause: 'damage', insurer: 'New India Assurance', policy_number: 'POL-1', claimed_amount: 39, adjustment_ids: [writeOff],
    });
    expect([lodged.status, lodged.json.error]).toEqual([201, undefined]);
    const id = lodged.json.id;
    const lossBefore = await balance('5106');

    const early = await call(patchClaim, `/api/insurance-claims/${id}`, 'PATCH', { action: 'settle', amount: 30, date: '2026-10-25', account_id: randomUUID() }, { id });
    expect(early.status).toBe(409);
    expect((await call(patchClaim, `/api/insurance-claims/${id}`, 'PATCH', { action: 'admit', amount: 30, date: '2026-10-23' }, { id })).status).toBe(200);
    expect(await balance('1145')).toBe(30);
    expect(Math.round((await balance('5106') - lossBefore) * 100) / 100).toBe(-30);

    const bank = (await pool.query(`SELECT id FROM accounts WHERE business_id = $1 AND account_code = '1102'`, [B])).rows[0].id;
    const bankBefore = await balance('1102');
    const settled = await call(patchClaim, `/api/insurance-claims/${id}`, 'PATCH', { action: 'settle', amount: 25, date: '2026-10-25', account_id: bank }, { id });
    expect([settled.status, settled.json.error]).toEqual([200, undefined]);
    expect(await balance('1145')).toBe(0);
    expect(Math.round((await balance('1102') - bankBefore) * 100) / 100).toBe(25);
    expect(Math.round((await balance('5106') - lossBefore) * 100) / 100).toBe(-25);
    expect((await call(patchClaim, `/api/insurance-claims/${id}`, 'PATCH', { action: 'reject', date: '2026-10-26' }, { id })).status).toBe(409);
  });

  test('an import in transit records where it is and its bill of entry', async () => {
    const id = await bill(`IMP-${tag}`, RM, 50, 10, true);
    const staged = await call(receiveGoods, `/api/purchases/${id}/receive-goods`, 'POST', {
      action: 'stage', stage: 'at_customs', bill_of_entry_number: '1234567', bill_of_entry_date: '2026-10-22',
    }, { id });
    expect([staged.status, staged.json.error]).toEqual([200, undefined]);
    const r = await call(thirdParty, '/api/reports/stock/third-party', 'GET');
    expect(r.json.inward_transit[0]).toMatchObject({ transit_stage: 'at_customs', bill_of_entry_number: '1234567', qty: 50 });
  });

  test('a challan gives e-way bill JSON for the portal', async () => {
    const ch = await call(postChallan, '/api/delivery-challans', 'POST', {
      business_id: B, branch_id: BR, supplier_id: SUP, challan_date: DAY, challan_kind: 'returnable', purpose: 'job_work',
      warehouse_id: W1, vehicle_number: 'MH 12 AB 1234',
      items: [{ item_id: RM, item_name: 'Steel sheet', qty: 10, unit: 'KGS', unit_price: 10, tax_rate: 18, hsn_sac: '7208' }],
    });
    expect(ch.status).toBe(201);
    const id = ch.json.deliveryChallan.id;
    const noKm = await call(ewayExport, `/api/eway-bills/export?source_type=delivery_challan&source_id=${id}`, 'GET');
    expect(noKm.status).toBe(400);
    const json = await call(ewayExport, `/api/eway-bills/export?source_type=delivery_challan&source_id=${id}&distance_km=12`, 'GET');
    expect(json.status).toBe(200);
    expect(json.headers.get('content-disposition')).toContain('attachment');
    const b = json.json.billLists[0];
    expect(b).toMatchObject({
      supplyType: 'O', subSupplyType: 4, docType: 'CHL', fromGstin: '27AABCU9603R1ZM', fromPincode: 411019, fromStateCode: 27,
      toGstin: '27AABCM1234R1Z5', toPincode: 411026, totalValue: 100, cgstValue: 9, sgstValue: 9, totInvValue: 118,
      transDistance: '12', vehicleNo: 'MH12AB1234', mainHsnCode: 7208,
    });
    expect(b.docDate).toBe('20/10/2026');
    expect(b.itemList).toEqual([expect.objectContaining({ hsnCode: 7208, quantity: 10, qtyUnit: 'KGS', cgstRate: 9, sgstRate: 9, igstRate: 0, taxableAmount: 100 })]);
  });
});
