/**
 * Stock reconciliation, phase 1: returnable challans, e-way bill records, and physical counts.
 * The audit case: 10,000 on the books, 300 out with three parties, 150 in transit, 9,500 counted
 * → 50 unexplained. Writes only after current_database() is kh_phase2_test on port 5433.
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
import { POST as postChallan } from '@/app/api/delivery-challans/route';
import { GET as getChallan, PATCH as patchChallan } from '@/app/api/delivery-challans/[id]/route';
import { POST as settleChallan } from '@/app/api/delivery-challans/[id]/settle/route';
import { POST as postEway, GET as listEway } from '@/app/api/eway-bills/route';
import { PATCH as patchEway } from '@/app/api/eway-bills/[id]/route';
import { GET as thirdPartyReport } from '@/app/api/reports/stock/third-party/route';
import { POST as openCount } from '@/app/api/stock-counts/route';
import { GET as getCount, PATCH as patchCount } from '@/app/api/stock-counts/[id]/route';
import { computeValidUntil, effectiveEwayStatus } from '@/lib/gst/eway-bills';
import { isEwayBillRequired } from '@/lib/inter-branch-utils';

const DAY = '2026-10-20';

describe('stock reconciliation', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const OTHER = randomUUID();
  const BR = randomUUID();
  const OBR = randomUUID();
  const W1 = randomUUID();
  const W2 = randomUUID();
  const COUNTER = randomUUID();
  const MANAGER = randomUUID();
  const OUSER = randomUUID();
  const REPAIRER = randomUUID();
  const JOBBER = randomUUID();
  const CUSTOMER = randomUUID();
  const ITEM = randomUUID();
  const TRANSFER = randomUUID();
  const tag = B.slice(0, 8);

  const auth = (userId: string, businessId = B) => ({
    'content-type': 'application/json',
    'x-authenticated-user-id': userId,
    'x-authenticated-business-id': businessId,
    'x-authenticated-session-version': '1',
  });

  async function call(handler: any, url: string, method: string, body?: unknown, user = MANAGER, params?: any, business = B) {
    const res = await handler(
      new NextRequest(`http://localhost${url}`, { method, headers: auth(user, business), body: body ? JSON.stringify(body) : undefined }),
      params ? { params } : undefined
    );
    return { status: res.status, json: await res.json() };
  }

  async function godown(warehouse = W1): Promise<number> {
    const r = await pool.query(`SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [warehouse, ITEM]);
    return Number(r.rows[0]?.current_stock_qty ?? 0);
  }

  async function challan(party: { supplier_id?: string; customer_id?: string }, purpose: string, qty: number) {
    const created = await call(postChallan, '/api/delivery-challans', 'POST', {
      ...party,
      business_id: B,
      branch_id: BR,
      challan_date: DAY,
      challan_kind: 'returnable',
      purpose,
      warehouse_id: W1,
      expected_return_date: '2026-10-30',
      reason_for_transportation: purpose === 'job_work' ? 'job_work' : 'others',
      items: [{ item_id: ITEM, item_name: `Pump ${tag}`, qty, unit: 'PCS', unit_price: 10, tax_rate: 18 }],
    });
    expect([created.status, created.json.error]).toEqual([201, undefined]);
    expect(created.json.deliveryChallan.status).toBe('draft');
    return created.json.deliveryChallan.id as string;
  }

  async function send(id: string) {
    return call(patchChallan, `/api/delivery-challans/${id}`, 'PATCH', { status: 'sent' }, MANAGER, { id });
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !(info.addr.startsWith('127.') || info.addr.startsWith('::1'))) {
      throw new Error(`Refusing stock reconciliation tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    for (const m of ['412_inventory_stock_classes.sql', '414_stock_custody_and_counts.sql']) {
      await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations', m), 'utf8'));
    }

    await pool.query(
      `INSERT INTO businesses (id, name, state_code, gst_registration_type) VALUES ($1, $2, '27', 'regular'), ($3, $4, '27', 'regular')`,
      [B, `Stock reco ${tag}`, OTHER, `Stock reco other ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true), ($3, $4, 'Main', '27', true, true, true)`,
      [BR, B, OBR, OTHER]
    );
    const phone = Date.now().toString().slice(-8);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Counter', $3, false, 1, true), ($4, $2, 'Manager', $5, true, 1, true), ($6, $7, 'Other', $8, true, 1, true)`,
      [COUNTER, B, `61${phone}`, MANAGER, `62${phone}`, OUSER, OTHER, `63${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled) VALUES ($1, true)
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = true`,
      [B]
    );
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, warehouse_type, is_active)
       VALUES ($1, $3, $4, 'Godown A', 'physical', true), ($2, $3, $4, 'Godown B', 'physical', true)`,
      [W1, W2, B, BR]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name) VALUES ($1, $3, 'Repair works'), ($2, $3, 'Job worker')`,
      [REPAIRER, JOBBER, B]
    );
    await pool.query(`INSERT INTO customers (id, business_id, name) VALUES ($1, $2, 'Approval customer')`, [CUSTOMER, B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, item_type, purchase_price, selling_price, tax_rate, is_active)
       VALUES ($1, $2, $3, 'PCS', 'goods', 10, 15, 18, true)`,
      [ITEM, B, `Pump ${tag}`]
    );
    // 10,000 on the books in Godown A; 150 of them dispatched to Godown B and not yet received.
    await pool.query(`INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 9850)`, [W1, ITEM]);
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, status, from_location_id, to_location_id)
       VALUES ($1, $2, $3, $4, 'in_transit', $5, $6)`,
      [TRANSFER, B, `TR-${tag}`, DAY, W1, W2]
    );
    await pool.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, qty, quantity_requested, quantity_dispatched, received_qty)
       VALUES ($1, $2, 150, 150, 150, 0)`,
      [TRANSFER, ITEM]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', MANAGER, async () => {
        await client.query(`DELETE FROM stock_counts WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
        await client.query(`DELETE FROM stock_transfers WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
        await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
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

  test('moving goods over ₹50,000 needs an e-way bill within the state too', () => {
    expect(isEwayBillRequired(50_000)).toBe(false);
    expect(isEwayBillRequired(50_001)).toBe(true);
  });

  test('e-way bill validity runs to midnight IST, one day per 200 km', () => {
    const generated = new Date('2026-10-20T10:00:00+05:30');
    expect(computeValidUntil(generated, 150).toISOString()).toBe(new Date('2026-10-21T23:59:59+05:30').toISOString());
    expect(computeValidUntil(generated, 250).toISOString()).toBe(new Date('2026-10-22T23:59:59+05:30').toISOString());
    expect(computeValidUntil(generated, 30, true).toISOString()).toBe(new Date('2026-10-22T23:59:59+05:30').toISOString());
    expect(effectiveEwayStatus('active', '2026-10-21T18:29:59Z', new Date('2026-10-22T00:00:00Z'))).toBe('expired');
  });

  test('a returnable challan moves stock only when sent, and to the party that holds it', async () => {
    const repair = await challan({ supplier_id: REPAIRER }, 'repair', 120);
    expect(await godown()).toBe(9850);
    const sent = await send(repair);
    expect([sent.status, sent.json.error]).toEqual([200, undefined]);
    expect(sent.json.deliveryChallan.status).toBe('sent');
    expect(await godown()).toBe(9730);

    const again = await send(repair);
    expect(again.status).toBe(409);

    const edit = await call(postChallan, '/api/delivery-challans', 'POST', { business_id: B, challan_date: DAY, challan_kind: 'returnable', items: [] });
    expect(edit.status).toBe(400);

    expect((await send(await challan({ supplier_id: JOBBER }, 'job_work', 100))).status).toBe(200);
    expect((await send(await challan({ customer_id: CUSTOMER }, 'approval', 80))).status).toBe(200);
    expect(await godown()).toBe(9550);

    const tooMuch = await challan({ supplier_id: REPAIRER }, 'repair', 999999);
    const refused = await send(tooMuch);
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('INSUFFICIENT_STOCK');
    expect(await godown()).toBe(9550);
    await call(patchChallan, `/api/delivery-challans/${tooMuch}`, 'PATCH', { status: 'cancelled' }, MANAGER, { id: tooMuch });
  });

  test('an e-way bill is recorded against the challan and copied to it', async () => {
    const list = await call(thirdPartyReport, '/api/reports/stock/third-party', 'GET');
    const repairRow = list.json.with_third_party.find((r: any) => r.purpose === 'repair');
    const created = await call(postEway, '/api/eway-bills', 'POST', {
      source_type: 'delivery_challan',
      source_id: repairRow.challan_id,
      ewb_number: `3210${Date.now().toString().slice(-8)}`,
      doc_type: 'delivery_challan',
      sub_supply_type: 'others',
      distance_km: 250,
      goods_value: 1200,
      generated_at: new Date(Date.now() - 6 * 864e5).toISOString(),
      vehicle_number: 'mh 12 ab 1234',
    });
    expect([created.status, created.json.error]).toEqual([201, undefined]);
    expect(created.json.eway_bill.status).toBe('expired');
    expect(created.json.eway_bill.vehicle_number).toBe('MH12AB1234');
    expect(created.json.eway_bill.can_cancel).toBe(false);

    const dup = await call(postEway, '/api/eway-bills', 'POST', {
      source_type: 'delivery_challan', source_id: repairRow.challan_id, ewb_number: created.json.eway_bill.ewb_number,
      distance_km: 10, generated_at: new Date().toISOString(),
    });
    expect(dup.status).toBe(409);

    const cancel = await call(patchEway, `/api/eway-bills/${created.json.eway_bill.id}`, 'PATCH', { action: 'cancel' }, MANAGER, { id: created.json.eway_bill.id });
    expect(cancel.status).toBe(409);

    const ch = await call(getChallan, `/api/delivery-challans/${repairRow.challan_id}`, 'GET', undefined, MANAGER, { id: repairRow.challan_id });
    expect(ch.json.deliveryChallan.e_way_bill_number).toBe(created.json.eway_bill.ewb_number);
    expect(ch.json.ewayBills).toHaveLength(1);

    const other = await call(listEway, '/api/eway-bills', 'GET', undefined, OUSER, undefined, OTHER);
    expect(other.json.eway_bills).toHaveLength(0);
  });

  test('the third-party report shows 300 with three parties and 150 in transit', async () => {
    const r = await call(thirdPartyReport, '/api/reports/stock/third-party?warehouse_id=' + W1, 'GET');
    expect(r.status).toBe(200);
    expect(r.json.totals.with_third_party.qty).toBe(300);
    expect(r.json.totals.in_transit.qty).toBe(150);
    expect(r.json.with_third_party.map((x: any) => [x.purpose, x.qty]).sort()).toEqual([
      ['approval', 80], ['job_work', 100], ['repair', 120],
    ]);
    expect(r.json.totals.unproven).toBe(1);
  });

  let countId = '';

  test('a count freezes the godown, hides book figures, and explains 450 of the 500 short', async () => {
    const opened = await call(openCount, '/api/stock-counts', 'POST', { warehouse_id: W1, count_date: DAY }, COUNTER);
    expect([opened.status, opened.json.error]).toEqual([201, undefined]);
    countId = opened.json.id;

    const second = await call(openCount, '/api/stock-counts', 'POST', { warehouse_id: W1, count_date: DAY }, COUNTER);
    expect(second.status).toBe(409);

    // Frozen: no stock may move in or out of Godown A, through the API or directly.
    const blocked = await send(await challan({ supplier_id: REPAIRER }, 'repair', 5));
    expect(blocked.status).toBe(423);
    expect(blocked.json.code).toBe('STOCK_FROZEN');
    await expect(
      pool.query(`INSERT INTO stock_movements (business_id, item_id, location_id, type, quantity) VALUES ($1, $2, $3, 'out', 1)`, [B, ITEM, W1])
    ).rejects.toThrow(/STOCK_FROZEN/);
    await pool.query(`INSERT INTO stock_movements (business_id, item_id, location_id, type, quantity) VALUES ($1, $2, $3, 'in', 0)`, [B, ITEM, W2]);

    const blind = await call(getCount, `/api/stock-counts/${countId}`, 'GET', undefined, COUNTER, { id: countId });
    expect(blind.json.blind).toBe(true);
    const blindLine = blind.json.lines.find((l: any) => l.item_id === ITEM);
    expect(blindLine.expected_qty).toBe(0);
    expect(blindLine.difference).toBeNull();

    const entered = await call(patchCount, `/api/stock-counts/${countId}`, 'PATCH', {
      action: 'count', entries: [{ item_id: ITEM, physical_qty: 9500 }],
    }, COUNTER, { id: countId });
    expect([entered.status, entered.json.recount]).toEqual([200, []]);

    const early = await call(patchCount, `/api/stock-counts/${countId}`, 'PATCH', { action: 'submit' }, COUNTER, { id: countId });
    expect(early.status).toBe(200);

    const rec = await call(getCount, `/api/stock-counts/${countId}`, 'GET', undefined, MANAGER, { id: countId });
    expect(rec.json.blind).toBe(false);
    expect(rec.json.summary).toMatchObject({
      book_qty: 10000,
      with_third_party_qty: 300,
      in_transit_qty: 150,
      expected_qty: 9550,
      physical_qty: 9500,
      unexplained_qty: -50,
      shortage_value: 500,
      unproven: 1,
    });
    expect(rec.json.with_third_party).toHaveLength(3);
    expect(rec.json.in_transit).toHaveLength(1);
    expect(rec.json.classes).toEqual([
      expect.objectContaining({ stock_class: 'trading', shortage_value: 500, caro_flag: false }),
    ]);
  });

  test('posting needs someone who did not count, then writes the 50 off and unfreezes', async () => {
    const own = await call(patchCount, `/api/stock-counts/${countId}`, 'PATCH', { action: 'post' }, COUNTER, { id: countId });
    expect(own.status).toBe(403);
    expect(own.json.code).toBe('SAME_COUNTER');

    const badReason = await call(patchCount, `/api/stock-counts/${countId}`, 'PATCH', {
      action: 'reasons', reasons: [{ item_id: ITEM, reason_code: 'REVALUATION' }],
    }, MANAGER, { id: countId });
    expect(badReason.status).toBe(400);
    await call(patchCount, `/api/stock-counts/${countId}`, 'PATCH', {
      action: 'reasons', reasons: [{ item_id: ITEM, reason_code: 'THEFT', reason_notes: 'Two cartons missing from rack 4' }],
    }, MANAGER, { id: countId });

    const posted = await call(patchCount, `/api/stock-counts/${countId}`, 'PATCH', { action: 'post' }, MANAGER, { id: countId });
    expect([posted.status, posted.json.error, posted.json.adjustments]).toEqual([200, undefined, 1]);
    expect(await godown()).toBe(9500);

    const adj = await pool.query(
      `SELECT reason_code, quantity_change::float AS q, stock_count_id, gst_impact::float AS gst
         FROM inventory_adjustments WHERE business_id = $1`,
      [B]
    );
    expect(adj.rows).toHaveLength(1);
    expect(adj.rows[0]).toMatchObject({ reason_code: 'THEFT', q: -50, stock_count_id: countId });

    const done = await call(getCount, `/api/stock-counts/${countId}`, 'GET', undefined, MANAGER, { id: countId });
    expect(done.json.count.status).toBe('posted');
    expect(done.json.lines.find((l: any) => l.item_id === ITEM).adjustment_id).toBeTruthy();

    const reposted = await call(patchCount, `/api/stock-counts/${countId}`, 'PATCH', { action: 'post' }, MANAGER, { id: countId });
    expect(reposted.status).toBe(409);

    const other = await call(getCount, `/api/stock-counts/${countId}`, 'GET', undefined, OUSER, { id: countId }, OTHER);
    expect(other.status).toBe(404);
  });

  test('returns, a sale on approval and a loss at the job worker close their challans', async () => {
    const report = await call(thirdPartyReport, '/api/reports/stock/third-party', 'GET');
    const byPurpose = (p: string) => report.json.with_third_party.find((r: any) => r.purpose === p);
    const lineOf = async (challanId: string) =>
      (await call(getChallan, `/api/delivery-challans/${challanId}`, 'GET', undefined, MANAGER, { id: challanId })).json.items[0];

    const repair = byPurpose('repair').challan_id;
    const repairLine = await lineOf(repair);
    const part = await call(settleChallan, `/api/delivery-challans/${repair}/settle`, 'POST', {
      date: '2026-10-22', lines: [{ line_id: repairLine.id, returned: 40 }],
    }, MANAGER, { id: repair });
    expect([part.status, part.json.error, part.json.closed]).toEqual([200, undefined, false]);
    expect(await godown()).toBe(9540);

    const over = await call(settleChallan, `/api/delivery-challans/${repair}/settle`, 'POST', {
      date: '2026-10-22', lines: [{ line_id: repairLine.id, returned: 81 }],
    }, MANAGER, { id: repair });
    expect(over.status).toBe(409);

    const rest = await call(settleChallan, `/api/delivery-challans/${repair}/settle`, 'POST', {
      date: '2026-10-23', lines: [{ line_id: repairLine.id, returned: 80 }],
    }, MANAGER, { id: repair });
    expect(rest.json.closed).toBe(true);
    expect(rest.json.deliveryChallan.close_reason).toBe('returned');

    const job = byPurpose('job_work').challan_id;
    const jobLine = await lineOf(job);
    const lost = await call(settleChallan, `/api/delivery-challans/${job}/settle`, 'POST', {
      date: '2026-10-23', lines: [{ line_id: jobLine.id, returned: 90, written_off: 10 }], notes: 'Damaged in machining',
    }, MANAGER, { id: job });
    expect([lost.status, lost.json.error, lost.json.closed, lost.json.adjustmentIds.length]).toEqual([200, undefined, true, 1]);
    expect(lost.json.deliveryChallan.close_reason).toBe('mixed');
    expect(await godown()).toBe(9620 + 90);

    const loss = await pool.query(`SELECT reason_code, quantity_change::float AS q FROM inventory_adjustments WHERE id = $1`, [lost.json.adjustmentIds[0]]);
    expect(loss.rows[0]).toEqual({ reason_code: 'CUSTODY_LOSS', q: -10 });

    const approval = byPurpose('approval').challan_id;
    const approvalLine = await lineOf(approval);
    const sold = await call(settleChallan, `/api/delivery-challans/${approval}/settle`, 'POST', {
      date: '2026-10-24', lines: [{ line_id: approvalLine.id, invoiced: 80 }],
    }, MANAGER, { id: approval });
    expect(sold.json.deliveryChallan.close_reason).toBe('invoiced');

    const after = await call(thirdPartyReport, '/api/reports/stock/third-party', 'GET');
    expect(after.json.totals.with_third_party.qty).toBe(0);
    expect(await godown()).toBe(9790);
  });
});
