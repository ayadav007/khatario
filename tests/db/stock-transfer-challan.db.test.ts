/**
 * Stock transfers between godowns on one GSTIN: dispatch issues a delivery challan (Rule 55)
 * that follows the transfer, and its e-way bill JSON runs godown to godown for own use.
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
    throw new Error('Refusing stock transfer challan tests: database host is not local');
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
import { ewayBulkJson } from '@/lib/gst/eway-json';
import { PATCH as dispatch } from '@/app/api/stock-transfers/[id]/dispatch/route';
import { PATCH as cancelTransfer } from '@/app/api/stock-transfers/[id]/cancel/route';
import { PUT as putChallan, PATCH as patchChallan } from '@/app/api/delivery-challans/[id]/route';

const GSTIN = '27AABCU9603R1ZM';

describe('stock transfer delivery challan', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const BR2 = randomUUID();
  const W1 = randomUUID();
  const W2 = randomUUID();
  const USER = randomUUID();
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

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; port: number }>(`SELECT current_database() AS db, inet_server_port() AS port`);
    if (db.rows[0].db !== 'kh_phase2_test' || db.rows[0].port !== 5433) throw new Error('Refusing: not the disposable DB');
    for (const m of ['414_stock_custody_and_counts.sql', '415_stock_reconciliation_phase2.sql', '455_stock_transfer_delivery_challan.sql']) {
      await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations', m), 'utf8'));
    }
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type, address_line1, city, pincode)
       VALUES ($1, $2, $3, '27', 'Maharashtra', 'regular', '1 Head Office Road', 'Mumbai', '400001')`,
      [B, `Transfer challan ${tag}`, GSTIN]
    );
    // Two places of business on the head-office GSTIN (no GSTIN of their own).
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state, state_code, address_line1, city, pincode, is_primary, is_default, is_active)
       VALUES ($1, $3, 'Mumbai shop', 'Maharashtra', '27', '5 Market Lane', 'Mumbai', '400002', true, true, true),
              ($2, $3, 'Pune shop', 'Maharashtra', '27', '9 FC Road', 'Pune', '411004', false, false, true)`,
      [BR, BR2, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active) VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [USER, B, `63${Date.now().toString().slice(-8)}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, warehouse_type, is_active, address_line1, city, state, pincode)
       VALUES ($1, $3, $4, 'Bhiwandi godown', 'physical', true, 'Plot 7 MIDC', 'Bhiwandi', 'Maharashtra', '421302'),
              ($2, $3, $5, 'Pune godown', 'physical', true, '12 Hadapsar Estate', 'Pune', 'Maharashtra', '411028')`,
      [W1, W2, B, BR, BR2]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, uqc, item_type, purchase_price, selling_price, tax_rate, hsn_sac, is_active)
       VALUES ($1, $2, 'Pump', 'PCS', 'PCS', 'goods', 100, 150, 18, '8413', true)`,
      [ITEM, B]
    );
    await pool.query(`INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 20)`, [W1, ITEM]);
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, status, from_location_id, to_location_id)
       VALUES ($1, $2, $3, '2026-10-30', 'pending', $4, $5)`,
      [TRANSFER, B, `TR-${tag}`, W1, W2]
    );
    await pool.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, qty, unit, quantity_requested, quantity_dispatched, cost_snapshot)
       VALUES ($1, $2, 6, 'PCS', 6, 0, 120)`,
      [TRANSFER, ITEM]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM delivery_challans WHERE business_id = $1`, [B]);
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

  let challanId = '';

  test('dispatch issues a sent delivery challan at cost with no tax', async () => {
    const res = await call(dispatch, `/api/stock-transfers/${TRANSFER}/dispatch`, 'PATCH', { dispatch_date: '2026-10-31' }, { id: TRANSFER });
    expect([res.status, res.json.error]).toEqual([200, undefined]);
    const c = (
      await pool.query(
        `SELECT dc.*, dc.challan_date::text AS d, cu.branch_id AS consignee_branch
           FROM delivery_challans dc JOIN customers cu ON cu.id = dc.customer_id WHERE dc.stock_transfer_id = $1`,
        [TRANSFER]
      )
    ).rows;
    expect(c).toHaveLength(1);
    challanId = c[0].id;
    expect(c[0]).toMatchObject({
      business_id: B, branch_id: BR, status: 'sent', challan_kind: 'supply', reason_for_transportation: 'own_use',
      warehouse_id: W1, to_warehouse_id: W2, consignee_branch: BR2, d: '2026-10-31',
    });
    expect(c[0].challan_number).toBeTruthy();
    expect(Number(c[0].subtotal)).toBe(720);
    expect(Number(c[0].tax_total)).toBe(0);
    expect(c[0].shipping_address).toContain('411028');
    const line = (await pool.query(`SELECT qty::float, unit, hsn_sac FROM delivery_challan_items WHERE delivery_challan_id = $1`, [challanId])).rows[0];
    expect(line).toEqual({ qty: 6, unit: 'PCS', hsn_sac: '8413' });
  });

  test('the e-way bill JSON runs godown to godown under one GSTIN, for own use', async () => {
    const json = await ewayBulkJson(pool, B, 'delivery_challan', challanId, { distanceKm: 160 });
    const bill = json.billLists[0];
    expect(bill).toMatchObject({
      docType: 'CHL', subSupplyType: 5, fromGstin: GSTIN, toGstin: GSTIN,
      fromPincode: 421302, toPincode: 411028, fromStateCode: 27, toStateCode: 27, totalValue: 720, totInvValue: 720,
    });
    expect(bill.fromAddr1).toBe('Plot 7 MIDC');
    expect(bill.itemList[0]).toMatchObject({ quantity: 6, qtyUnit: 'PCS', hsnCode: 8413, taxableAmount: 720 });
  });

  test('the challan cannot be edited or cancelled on its own', async () => {
    const put = await call(putChallan, `/api/delivery-challans/${challanId}`, 'PUT', { business_id: B, challan_date: '2026-10-31' }, { id: challanId });
    expect(put.status).toBe(409);
    const cancel = await call(patchChallan, `/api/delivery-challans/${challanId}`, 'PATCH', { business_id: B, status: 'cancelled' }, { id: challanId });
    expect(cancel.status).toBe(409);
    expect(cancel.json.error).toMatch(/Cancel the transfer/);
  });

  test('a second dispatch does not issue another challan', async () => {
    const client = await pool.connect();
    try {
      const { issueTransferChallan } = await import('@/lib/stock-transfers/transfer-challan');
      const t = (await client.query(`SELECT * FROM stock_transfers WHERE id = $1`, [TRANSFER])).rows[0];
      expect(await issueTransferChallan(client, t, { date: '2026-10-31' })).toBe(challanId);
    } finally {
      client.release();
    }
  });

  test('a transfer to a branch on another GSTIN gets no challan (it is billed by inter-branch invoice)', async () => {
    const BR3 = randomUUID();
    const W3 = randomUUID();
    const T2 = randomUUID();
    await pool.query(
      `INSERT INTO branches (id, business_id, name, gstin, state, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Hosur shop', '33ADVFS4469F1ZJ', 'Tamil Nadu', '33', false, false, true)`,
      [BR3, B]
    );
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, warehouse_type, is_active, address_line1, city, state, pincode)
       VALUES ($1, $2, $3, 'Hosur godown', 'physical', true, 'SIPCOT Phase 1', 'Hosur', 'Tamil Nadu', '635126')`,
      [W3, B, BR3]
    );
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, status, from_location_id, to_location_id)
       VALUES ($1, $2, $3, '2026-10-30', 'pending', $4, $5)`,
      [T2, B, `TR2-${tag}`, W1, W3]
    );
    await pool.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, qty, unit, quantity_requested, quantity_dispatched, cost_snapshot)
       VALUES ($1, $2, 1, 'PCS', 1, 0, 120)`,
      [T2, ITEM]
    );
    const client = await pool.connect();
    try {
      const { issueTransferChallan } = await import('@/lib/stock-transfers/transfer-challan');
      const t = (await client.query(`SELECT * FROM stock_transfers WHERE id = $1`, [T2])).rows[0];
      expect(await issueTransferChallan(client, t, { date: '2026-10-31' })).toBeNull();
    } finally {
      client.release();
    }
  });

  test('cancelling the transfer cancels its challan', async () => {
    const res = await call(cancelTransfer, `/api/stock-transfers/${TRANSFER}/cancel`, 'PATCH', { cancellation_reason: 'Wrong godown' }, { id: TRANSFER });
    expect([res.status, res.json.error]).toEqual([200, undefined]);
    const c = (await pool.query(`SELECT status FROM delivery_challans WHERE id = $1`, [challanId])).rows[0];
    expect(c.status).toBe('cancelled');
  });
});
