/**
 * Stock reconciliation, phase 2: free goods, goods in transit from suppliers, transfer
 * shortfalls, job work (ITC-04), Form 3CD quantity details and the bank stock statement.
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
import { cancelFinalPurchase } from '@/lib/purchases/cancel-purchase';
import { replayCostItems } from '@/lib/inventory/fifo-costing';
import { POST as receiveGoods } from '@/app/api/purchases/[id]/receive-goods/route';
import { POST as closeShort } from '@/app/api/stock-transfers/[id]/close-short/route';
import { POST as postChallan } from '@/app/api/delivery-challans/route';
import { PATCH as patchChallan } from '@/app/api/delivery-challans/[id]/route';
import { POST as settleChallan } from '@/app/api/delivery-challans/[id]/settle/route';
import { GET as jobWork } from '@/app/api/reports/stock/job-work/route';
import { GET as quantitative } from '@/app/api/reports/stock/quantitative/route';
import { GET as bankStatement } from '@/app/api/reports/stock/bank-statement/route';
import { GET as thirdParty } from '@/app/api/reports/stock/third-party/route';
import { jobWorkDeadline } from '@/lib/stock-custody/job-work';

const DAY = '2026-10-20';

describe('stock reconciliation phase 2', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const W1 = randomUUID();
  const W2 = randomUUID();
  const USER = randomUUID();
  const SUP = randomUUID();
  const JOB = randomUUID();
  const ITEM = randomUUID();
  const TRANSFER = randomUUID();
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
  async function godown(w = W1): Promise<number> {
    const r = await pool.query(`SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [w, ITEM]);
    return Number(r.rows[0]?.current_stock_qty ?? 0);
  }
  async function bill(no: string, quantity: number, free: number, inTransit = false) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createPurchaseInTransaction(client, {
        business_id: B,
        created_by: USER,
        branch_id: BR,
        supplier_id: SUP,
        bill_number: no,
        bill_date: DAY,
        status: 'final',
        itc_eligible: true,
        place_of_supply_state_code: '27',
        supplier_state_code: '27',
        goods_in_transit: inTransit,
        items: [{ item_id: ITEM, item_name: 'Pump', quantity, free_qty: free, unit_price: 100, tax_rate: 18, hsn_sac: '8413', location_id: W1 }],
      } as any);
      await client.query('COMMIT');
      return (result as any).purchase.id as string;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; port: number }>(`SELECT current_database() AS db, inet_server_port() AS port`);
    if (db.rows[0].db !== 'kh_phase2_test' || db.rows[0].port !== 5433) throw new Error('Refusing: not the disposable DB');
    for (const m of ['412_inventory_stock_classes.sql', '414_stock_custody_and_counts.sql', '415_stock_reconciliation_phase2.sql']) {
      await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations', m), 'utf8'));
    }
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type)
       VALUES ($1, $2, '27AABCU9603R1ZM', '27', 'Maharashtra', 'regular')`,
      [B, `Stock reco 2 ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active) VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [USER, B, `64${Date.now().toString().slice(-8)}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled, inventory_model) VALUES ($1, true, 'perpetual')
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = true, inventory_model = 'perpetual'`,
      [B]
    );
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, warehouse_type, is_active, gst_place_type)
       VALUES ($1, $3, $4, 'Godown A', 'physical', true, 'principal'), ($2, $3, $4, 'Godown B', 'physical', true, 'additional')`,
      [W1, W2, B, BR]
    );
    await pool.query(`INSERT INTO branch_warehouses (branch_id, warehouse_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`, [BR, W1, W2]).catch(() => undefined);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, state, current_balance)
       VALUES ($1, $3, 'Pump Mills', '27', '27AABCM1234R1Z5', 'Maharashtra', 0), ($2, $3, 'Machining Works', '27', '27AAACJ1234R1Z1', 'Maharashtra', 0)`,
      [SUP, JOB, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, uqc, item_type, purchase_price, selling_price, tax_rate, hsn_sac, is_active)
       VALUES ($1, $2, 'Pump', 'PCS', 'PCS', 'goods', 100, 150, 18, '8413', true)`,
      [ITEM, B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM stock_transfers WHERE business_id = $1`, [B]);
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

  test('free goods go into stock at no cost', async () => {
    const id = await bill(`FREE-${tag}`, 10, 1);
    expect(await godown()).toBe(11);
    const line = await pool.query(`SELECT free_qty::float FROM purchase_items WHERE purchase_id = $1`, [id]);
    expect(line.rows[0].free_qty).toBe(1);
    const client = await pool.connect();
    try {
      const replay = await replayCostItems(client, B, [ITEM]);
      const r = replay.replays.get(ITEM)!;
      expect(r.openQty).toBe(11);
      expect(Math.round(r.openValue)).toBe(1000);
    } finally {
      client.release();
    }
  });

  let transitBill = '';
  test('a bill whose goods have not arrived keeps them on the books, off the godown', async () => {
    transitBill = await bill(`TRANSIT-${tag}`, 20, 0, true);
    expect(await godown()).toBe(11);
    const p = await pool.query(`SELECT goods_status FROM purchases WHERE id = $1`, [transitBill]);
    expect(p.rows[0].goods_status).toBe('in_transit');

    const report = await call(thirdParty, '/api/reports/stock/third-party', 'GET');
    expect(report.json.totals.inward_transit.qty).toBe(20);
    expect(report.json.inward_transit[0].supplier_name).toBe('Pump Mills');

    const line = (await pool.query(`SELECT id FROM purchase_items WHERE purchase_id = $1`, [transitBill])).rows[0].id;
    const early = await call(receiveGoods, `/api/purchases/${transitBill}/receive-goods`, 'POST', { action: 'receive', date: '2026-10-19', lines: [{ purchase_item_id: line, qty: 5 }] }, { id: transitBill });
    expect(early.status).toBe(400);
    const part = await call(receiveGoods, `/api/purchases/${transitBill}/receive-goods`, 'POST', { action: 'receive', date: '2026-10-22', lines: [{ purchase_item_id: line, qty: 12 }] }, { id: transitBill });
    expect([part.status, part.json.error, part.json.goods_status]).toEqual([200, undefined, 'partial']);
    expect(await godown()).toBe(23);
    const over = await call(receiveGoods, `/api/purchases/${transitBill}/receive-goods`, 'POST', { action: 'receive', date: '2026-10-22', lines: [{ purchase_item_id: line, qty: 9 }] }, { id: transitBill });
    expect(over.status).toBe(409);
  });

  test('cancelling a bill with goods still in transit takes off only what it added', async () => {
    const id = await bill(`CANCEL-${tag}`, 7, 0, true);
    expect(await godown()).toBe(23);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await cancelFinalPurchase(client, { businessId: B, purchaseId: id, userId: USER, reason: 'Wrong bill', warehouseModeEnabled: true });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    expect(await godown()).toBe(23);
    const report = await call(thirdParty, '/api/reports/stock/third-party', 'GET');
    expect(report.json.totals.inward_transit.qty).toBe(8);
  });

  test('a transfer short by 3 is written off and claimed from the carrier', async () => {
    await pool.query(`UPDATE location_stock SET current_stock_qty = current_stock_qty - 10 WHERE location_id = $1 AND item_id = $2`, [W1, ITEM]);
    await pool.query(`INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 7)`, [W2, ITEM]);
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, status, from_location_id, to_location_id)
       VALUES ($1, $2, $3, $4, 'in_transit', $5, $6)`,
      [TRANSFER, B, `TR-${tag}`, DAY, W1, W2]
    );
    await pool.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, qty, quantity_requested, quantity_dispatched, received_qty, cost_snapshot)
       VALUES ($1, $2, 10, 10, 10, 7, 100)`,
      [TRANSFER, ITEM]
    );
    await pool.query(
      `INSERT INTO stock_movements (business_id, item_id, location_id, type, quantity, reference_type, reference_id)
       VALUES ($1, $2, $3, 'out', 10, 'stock_transfer', $5), ($1, $2, $4, 'in', 7, 'stock_transfer', $5)`,
      [B, ITEM, W1, W2, TRANSFER]
    );
    const noCarrier = await call(closeShort, `/api/stock-transfers/${TRANSFER}/close-short`, 'POST', {
      date: '2026-10-23', lines: [{ item_id: ITEM, qty: 3, reason: 'carrier_claim' }],
    }, { id: TRANSFER });
    expect(noCarrier.status).toBe(400);
    const closed = await call(closeShort, `/api/stock-transfers/${TRANSFER}/close-short`, 'POST', {
      date: '2026-10-23', lines: [{ item_id: ITEM, qty: 3, reason: 'carrier_claim', claim_party: 'Fast Roadways', claim_amount: 354 }],
    }, { id: TRANSFER });
    expect([closed.status, closed.json.error, closed.json.completed]).toEqual([200, undefined, true]);
    expect(await godown()).toBe(13);
    const adj = await pool.query(`SELECT reason_code, quantity_change::float AS q, reason_notes FROM inventory_adjustments WHERE id = $1`, [closed.json.adjustmentIds[0]]);
    expect(adj.rows[0]).toMatchObject({ reason_code: 'TRANSIT_LOSS', q: -3 });
    expect(adj.rows[0].reason_notes).toContain('Fast Roadways');
    const report = await call(thirdParty, '/api/reports/stock/third-party', 'GET');
    expect(report.json.totals.in_transit.qty).toBe(0);
  });

  test('job work lists what went out, what came back and the deadline (ITC-04)', async () => {
    expect(jobWorkDeadline('2026-10-20', 'inputs')).toBe('2027-10-19');
    expect(jobWorkDeadline('2026-10-20', 'capital_goods')).toBe('2029-10-19');
    const created = await call(postChallan, '/api/delivery-challans', 'POST', {
      business_id: B, branch_id: BR, supplier_id: JOB, challan_date: DAY, challan_kind: 'returnable', purpose: 'job_work',
      job_work_goods: 'inputs', warehouse_id: W1, reason_for_transportation: 'job_work',
      items: [{ item_id: ITEM, item_name: 'Pump', qty: 5, unit: 'PCS', unit_price: 100, tax_rate: 18, hsn_sac: '8413' }],
    });
    expect([created.status, created.json.error]).toEqual([201, undefined]);
    const id = created.json.deliveryChallan.id;
    expect((await call(patchChallan, `/api/delivery-challans/${id}`, 'PATCH', { status: 'sent' }, { id })).status).toBe(200);
    expect(await godown()).toBe(8);
    const line = (await pool.query(`SELECT id FROM delivery_challan_items WHERE delivery_challan_id = $1`, [id])).rows[0].id;
    const back = await call(settleChallan, `/api/delivery-challans/${id}/settle`, 'POST', { date: '2026-10-24', lines: [{ line_id: line, returned: 3 }] }, { id });
    expect(back.status).toBe(200);

    const reg = await call(jobWork, '/api/reports/stock/job-work?from=2026-10-01&to=2027-03-31&as_of=2026-10-25', 'GET');
    expect(reg.status).toBe(200);
    expect(reg.json.sent).toEqual([expect.objectContaining({ job_worker_gstin: '27AAACJ1234R1Z1', qty: 5, hsn_sac: '8413', taxable_value: 500 })]);
    expect(reg.json.received).toEqual([expect.objectContaining({ return_date: '2026-10-24', qty_returned: 3 })]);
    expect(reg.json.open).toEqual([expect.objectContaining({ qty_open: 2, deadline: '2027-10-19', deemed_supply: false })]);

    const later = await call(jobWork, '/api/reports/stock/job-work?from=2026-10-01&to=2027-03-31&as_of=2027-11-01', 'GET');
    expect(later.json.open[0].deemed_supply).toBe(true);
  });

  test('Form 3CD quantities add up and count goods held elsewhere in the closing', async () => {
    const r = await call(quantitative, '/api/reports/stock/quantitative?from=2026-04-01&to=2027-03-31', 'GET');
    expect(r.status).toBe(200);
    const row = r.json.rows.find((x: any) => x.item_id === ITEM);
    const derived = row.opening + row.purchases - row.purchase_returns - row.sales + row.sales_returns - row.shortage + row.excess + row.other;
    expect(Math.round(derived * 1000) / 1000).toBe(row.closing);
    expect(row.shortage).toBe(3);
    // 11 + 20 billed (the cancelled bill nets to zero), 3 written off; the 8 in transit and 2 with
    // the job worker are still owned.
    expect(row.closing).toBe(28);
  });

  test('the bank statement values owned stock and works out drawing power', async () => {
    // The cancelled bill comes off on the day it was cancelled, so ask for today.
    const today = new Date().toISOString().slice(0, 10);
    const r = await call(bankStatement, `/api/reports/stock/bank-statement?as_of=${today}&stock_margin=25&debtor_margin=25`, 'GET');
    expect(r.status).toBe(200);
    const line = r.json.stock.lines.find((l: any) => l.item_id === ITEM);
    expect(line.qty).toBe(28);
    expect(line.age_bucket).toBe('0-90');
    expect(r.json.stock.total_value).toBeGreaterThan(0);
    expect(r.json.creditors.total).toBeGreaterThan(0);
    const expected = Math.round(Math.max(0, r.json.stock.total_value - r.json.creditors.total) * 0.75 * 100) / 100 + Math.round(Math.max(0, r.json.eligible_debtors) * 0.75 * 100) / 100;
    expect(Math.abs(r.json.drawing_power - expected)).toBeLessThan(0.02);
  });
});
