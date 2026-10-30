/**
 * A stock transfer between godowns on one GSTIN gets a paperwork-only delivery challan
 * (migration 448), and its e-way bill JSON ships to our own GSTIN at the destination godown.
 * PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/stock-transfer-challan.db.test.ts --runInBand
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { ensureTransferChallan } from '@/lib/stock-transfers/transfer-challan';
import { ewayBulkJson } from '@/lib/gst/eway-json';

const GSTIN_KA = '29AAACR5055K1ZO';

d('stock transfer challan within one GSTIN (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businessId = randomUUID();
  const branchId = randomUUID();
  const fromWh = randomUUID();
  const toWh = randomUUID();
  const itemId = randomUUID();
  const transferId = randomUUID();
  const tag = businessId.slice(0, 6);

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      fs.readFileSync(path.join(__dirname, '../../database/migrations/448_stock_transfer_delivery_challan.sql'), 'utf8')
    );
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type) VALUES ($1, 'Godown Co', $2, 'Karnataka', '29', 'regular')`,
      [businessId, GSTIN_KA]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state, state_code, address_line1, city, pincode, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Bangalore', 'Karnataka', '29', 'MG Road', 'Bengaluru', '560001', true, true, true)`,
      [branchId, businessId]
    );
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, address_line1, city, state, pincode) VALUES
         ($1, $3, $4, 'Peenya Godown', 'Peenya Phase 2', 'Bengaluru', 'Karnataka', '560058'),
         ($2, $3, $4, 'Mysuru Godown', 'Hebbal Industrial Area', 'Mysuru', 'Karnataka', '570016')`,
      [fromWh, toWh, businessId, branchId]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, hsn_sac, tax_rate, purchase_price, unit, item_type)
       VALUES ($1, $2, 'Steel Rack', '9403', 18, 4000, 'PCS', 'goods')`,
      [itemId, businessId]
    );
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, from_location_id, to_location_id, status)
       VALUES ($1, $2, $3, '2026-10-20', $4, $5, 'pending')`,
      [transferId, businessId, `ST-${tag}`, fromWh, toWh]
    );
    await pool.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, qty, unit, quantity_requested, cost_snapshot)
       VALUES ($1, $2, 15, 'PCS', 15, 4200)`,
      [transferId, itemId]
    );
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM delivery_challan_items WHERE delivery_challan_id IN (SELECT id FROM delivery_challans WHERE business_id = $1)',
      [businessId]
    );
    await pool.query('DELETE FROM delivery_challans WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM stock_transfer_items WHERE transfer_id = $1', [transferId]);
    await pool.query('DELETE FROM stock_transfers WHERE id = $1', [transferId]);
    await pool.query('DELETE FROM items WHERE id = $1', [itemId]);
    await pool.query('DELETE FROM warehouses WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM branches WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]);
    await closePool();
  });

  async function inTx<T>(fn: (c: any) => Promise<T>): Promise<T> {
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

  it('creates one tax-free challan valued at cost, linked to the transfer', async () => {
    const id = await inTx((c) => ensureTransferChallan(c, transferId, { ewayBillNumber: '351234567890' }));
    expect(id).toBeTruthy();
    const again = await inTx((c) => ensureTransferChallan(c, transferId));
    expect(again).toBe(id);

    const ch = (await pool.query('SELECT * FROM delivery_challans WHERE id = $1', [id])).rows[0];
    expect(ch).toMatchObject({
      stock_transfer_id: transferId,
      warehouse_id: fromWh,
      to_warehouse_id: toWh,
      customer_id: null,
      challan_kind: 'supply',
      reason_for_transportation: 'own_use',
      e_way_bill_number: '351234567890',
      status: 'sent',
    });
    expect(Number(ch.subtotal)).toBe(63000);
    expect(Number(ch.tax_total)).toBe(0);
    expect(Number(ch.grand_total)).toBe(63000);
    expect(ch.stock_posted_at).toBeNull();
  });

  it('e-way bill JSON ships to our own GSTIN at the destination godown', async () => {
    const ch = (await pool.query('SELECT id FROM delivery_challans WHERE stock_transfer_id = $1', [transferId])).rows[0];
    const bill = (await ewayBulkJson(pool as any, businessId, 'delivery_challan', ch.id, { distanceKm: 150 })).billLists[0];
    expect(bill).toMatchObject({
      docType: 'CHL',
      subSupplyType: 5,
      fromGstin: GSTIN_KA,
      fromPlace: 'Bengaluru',
      fromPincode: 560058,
      toGstin: GSTIN_KA,
      toPlace: 'Mysuru',
      toPincode: 570016,
      fromStateCode: 29,
      toStateCode: 29,
      totalValue: 63000,
      igstValue: 0,
    });
  });

  it('makes no challan for a transfer to a branch on another GSTIN (that one gets an invoice)', async () => {
    const tnBranch = randomUUID();
    const tnWh = randomUUID();
    const other = randomUUID();
    await pool.query(
      `INSERT INTO branches (id, business_id, name, gstin, state, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Hosur', '33ADVFS4469F1ZJ', 'Tamil Nadu', '33', false, false, true)`,
      [tnBranch, businessId]
    );
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, city, state, pincode) VALUES ($1, $2, $3, 'Hosur Godown', 'Hosur', 'Tamil Nadu', '635109')`,
      [tnWh, businessId, tnBranch]
    );
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, from_location_id, to_location_id, status)
       VALUES ($1, $2, $3, '2026-10-21', $4, $5, 'pending')`,
      [other, businessId, `ST2-${tag}`, fromWh, tnWh]
    );
    await pool.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, qty, unit, quantity_requested, cost_snapshot) VALUES ($1, $2, 1, 'PCS', 1, 4200)`,
      [other, itemId]
    );
    expect(await inTx((c) => ensureTransferChallan(c, other))).toBeNull();
    await pool.query('DELETE FROM stock_transfer_items WHERE transfer_id = $1', [other]);
    await pool.query('DELETE FROM stock_transfers WHERE id = $1', [other]);
  });
});
