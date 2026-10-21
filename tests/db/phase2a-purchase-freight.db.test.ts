/**
 * Phase 2A purchase freight. Writes only after current_database() is kh_phase2_test.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

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
import { weightedAverageCosts } from '@/lib/inventory/cogs-posting';
import { applyHistoricalLandedCost, reverseHistoricalLandedCost } from '@/lib/inventory/landed-cost-application';
import { executePurchaseFinalizeReplay } from '@/lib/offline-sync/execute-purchase-finalize-replay';
import { POST as postReturn } from '@/app/api/purchase-returns/route';
import { POST as cancelReturn } from '@/app/api/purchase-returns/[id]/cancel/route';
import {
  applyIncidentalFreightRefund,
  buildReturnLinesFromBill,
  incidentalAllocationsFromCharges,
} from '@/lib/purchases/purchase-return-lines';
import { POST as convertOrder } from '@/app/api/purchase-orders/[id]/convert/route';
import { NextRequest } from 'next/server';

const DAY = '2026-10-09';

describe('phase 2A purchase freight', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const B = randomUUID();
  const BR = randomUUID();
  const USER = randomUUID();
  const SUP = randomUUID();
  const ITEM = randomUUID();
  const SVC = randomUUID();

  async function assertDb(client: Pool | PoolClient) {
    const info = (
      await client.query<{ db: string; port: number }>(
        `SELECT current_database() AS db, inet_server_port() AS port`
      )
    ).rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433) {
      throw new Error(`Refusing to mutate ${info.db} on port ${info.port}`);
    }
  }

  async function ledger(voucherId: string) {
    const rows = (
      await pool.query<{ account_code: string; debit: string; credit: string }>(
        `SELECT a.account_code, SUM(l.debit)::text AS debit, SUM(l.credit)::text AS credit
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_id = $2
          GROUP BY a.account_code`,
        [B, voucherId]
      )
    ).rows;
    const map = new Map<string, { debit: number; credit: number }>();
    for (const row of rows) map.set(row.account_code, { debit: Number(row.debit), credit: Number(row.credit) });
    return map;
  }

  async function purchase(opts: {
    bill: string;
    itc?: boolean;
    items: Record<string, unknown>[];
    charges?: Record<string, unknown>[];
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assertDb(client);
      const result = await createPurchaseInTransaction(client, {
        business_id: B,
        created_by: USER,
        branch_id: BR,
        supplier_id: SUP,
        bill_number: opts.bill,
        bill_date: DAY,
        status: 'final',
        itc_eligible: opts.itc !== false,
        place_of_supply_state_code: '27',
        supplier_state_code: '27',
        items: opts.items,
        charges: opts.charges,
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = getPool();
    await assertDb(pool);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type)
       VALUES ($1,$2,'27AABCU9603R1ZM','27','Maharashtra','regular')`,
      [B, `Phase2A ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1,$2,'Main','27',true,true,true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1,$2,'Clerk',$3,true)`,
      [USER, B, `8${Date.now().toString().slice(-9)}`]
    );
    await pool.query(`UPDATE users SET auth_session_version = 1, is_active = true WHERE id = $1`, [USER]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1,$2,'Mill','27','27AABCM1234R1Z5',0)`,
      [SUP, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,'Cotton','goods','NOS',1000,1000,18,'6109'),
              ($3,$2,'Haulage','service','NOS',0,0,18,'9965')`,
      [ITEM, B, SVC]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,0)`,
      [B, BR, ITEM]
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled, inventory_model)
       VALUES ($1, false, 'perpetual')
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = false, inventory_model = 'perpetual'`,
      [B]
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM businesses WHERE id = $1`, [B]);
      });
      await client.query('COMMIT');
    } finally {
      client.release();
      await closePool();
    }
  });

  test('eligible freight capitalizes into inventory and leaves GST on the supplier lines', async () => {
    const result = await purchase({
      bill: `ELIG-${tag}`,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 10, unit_price: 1000, tax_rate: 18, hsn_sac: '6109' }],
      charges: [{ purpose: 'Freight', amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
    });
    const books = await ledger(String(result.purchase.id));
    expect(books.get('1104')).toEqual({ debit: 11000, credit: 0 });
    expect(books.get('1110')?.debit).toBe(990);
    expect(books.get('1111')?.debit).toBe(990);
    expect(books.get('2101')?.credit).toBe(12980);
    expect((books.get('5101')?.debit || 0) - (books.get('5101')?.credit || 0)).toBe(0);
    expect(books.get('5201')).toBeUndefined();
    const line = (
      await pool.query<{ taxable: string; cost: string; qty: string }>(
        `SELECT taxable_value::text AS taxable, acquisition_cost::text AS cost, quantity::text AS qty
           FROM purchase_items WHERE purchase_id = $1`,
        [result.purchase.id]
      )
    ).rows[0];
    expect(Number(line.taxable)).toBe(10000);
    expect(Number(line.cost)).toBe(11000);
    const stock = (
      await pool.query<{ quantity: string }>(
        `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`,
        [B, ITEM]
      )
    ).rows[0];
    expect(Number(stock.quantity)).toBe(10);
    const supplier = (
      await pool.query<{ current_balance: string }>(`SELECT current_balance::text FROM suppliers WHERE id = $1`, [SUP])
    ).rows[0];
    expect(Number(supplier.current_balance)).toBe(12980);
  });

  test('blocked GST is capitalized once and does not stay in Purchases', async () => {
    const result = await purchase({
      bill: `BLOCK-${tag}`,
      itc: false,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 1, unit_price: 10000, tax_rate: 18, hsn_sac: '6109' }],
      charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
    });
    const books = await ledger(String(result.purchase.id));
    expect(books.get('1104')?.debit).toBe(12980);
    expect(books.get('1110')).toBeUndefined();
    expect((books.get('5101')?.debit || 0) - (books.get('5101')?.credit || 0)).toBe(0);
    expect(books.get('2101')?.credit).toBe(12980);
  });

  test('an independent service is expensed and an unclassified charge writes nothing', async () => {
    const before = Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM purchases WHERE business_id = $1`, [B])).rows[0].n
    );
    const client = await pool.connect();
    await client.query('BEGIN');
    await expect(
      createPurchaseInTransaction(client, {
        business_id: B,
        created_by: USER,
        branch_id: BR,
        supplier_id: SUP,
        bill_number: `BAD-${tag}`,
        bill_date: DAY,
        status: 'final',
        items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 1, unit_price: 100, tax_rate: 18 }],
        charges: [{ amount: 50, tax_rate: 18 }],
      })
    ).rejects.toMatchObject({ code: 'CHARGE_UNCLASSIFIED' });
    await client.query('ROLLBACK');
    client.release();
    const after = Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM purchases WHERE business_id = $1`, [B])).rows[0].n
    );
    expect(after).toBe(before);

    const result = await purchase({
      bill: `SVC-${tag}`,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 1, unit_price: 10000, tax_rate: 18, hsn_sac: '6109' }],
      charges: [{ amount: 500, classification: 'independent_service', tax_rate: 18, hsn_sac: '9983' }],
    });
    const books = await ledger(String(result.purchase.id));
    expect(books.get('1104')?.debit).toBe(10000);
    expect(books.get('5201')?.debit).toBe(500);
  });

  test('a goods return without freight refund debits 5105 once and keeps 5102 net zero', async () => {
    const result = await purchase({
      bill: `RET-${tag}`,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 10, unit_price: 1000, tax_rate: 18, hsn_sac: '6109' }],
      charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
    });
    const request = new NextRequest('http://localhost/api/purchase-returns', {
      method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': USER,
          'x-authenticated-business-id': B,
          'x-authenticated-session-version': '1',
        },
      body: JSON.stringify({
        purchase_id: result.purchase.id,
        return_number: `PR-RET-${tag}`,
        return_date: DAY,
        items: [{ item_id: ITEM, item_name: 'Cotton', qty: 4 }],
      }),
    });
    const response = await postReturn(request);
    const body = await response.json();
    expect(response.status).toBe(201);
    const books = await ledger(body.purchaseReturn.id);
    expect(books.get('5102')?.debit).toBe(4000);
    expect(books.get('5102')?.credit).toBe(4000);
    expect(books.get('1104')?.credit).toBe(4400);
    expect(books.get('5105')?.debit).toBe(400);
    expect(books.get('1110')?.credit).toBe(360);
    expect(books.get('2101')?.debit).toBe(4720);
    expect(books.get('5104')).toBeUndefined();
  });

  test('historical null acquisition cost still costs the taxable value', async () => {
    const result = await purchase({
      bill: `OLD-${tag}`,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 2, unit_price: 100, tax_rate: 0, hsn_sac: '6109' }],
    });
    await pool.query(`UPDATE purchase_items SET acquisition_cost = NULL WHERE purchase_id = $1`, [result.purchase.id]);
    const replay = await replayCostItems(pool, B, [ITEM]);
    const lot = replay.replays.get(ITEM)?.lots.find((row) => row.docId === result.purchase.id);
    expect(lot?.unitCost).toBe(100);
  });

  test('a consumed landed-cost adjustment cannot be reversed', async () => {
    const result = await purchase({
      bill: `LC-${tag}`,
      items: [
        { item_id: ITEM, item_name: 'Cotton', quantity: 10, unit_price: 100, tax_rate: 0, hsn_sac: '6109' },
        { item_id: SVC, item_name: 'Haulage', item_type: 'service', quantity: 1, unit_price: 200, tax_rate: 0, hsn_sac: '9965' },
      ],
    });
    const client = await pool.connect();
    try {
    await client.query('BEGIN');
    const applied = await applyHistoricalLandedCost(client, {
      businessId: B,
      purchaseId: String(result.purchase.id),
      goodsItemId: ITEM,
      serviceItemId: SVC,
      amount: 200,
      adjustmentDate: DAY,
      branchId: BR,
    });
    await expect(
      reverseHistoricalLandedCost(client, { businessId: B, adjustmentId: applied.adjustmentId, reason: 'too soon to tell' })
    ).resolves.toBeUndefined();
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    const again = await applyHistoricalLandedCost(client, {
      businessId: B,
      purchaseId: String(result.purchase.id),
      goodsItemId: ITEM,
      serviceItemId: SVC,
      amount: 200,
      adjustmentDate: DAY,
      branchId: BR,
    });
    await client.query(
      `INSERT INTO purchase_returns (
         business_id, branch_id, supplier_id, purchase_id, return_number, return_date, subtotal, grand_total, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,40,40,'final',$7)`,
      [B, BR, SUP, result.purchase.id, `PR-LC-${tag}`, DAY, USER]
    );
    const ret = (
      await client.query<{ id: string }>(
        `SELECT id FROM purchase_returns WHERE business_id = $1 AND return_number = $2`,
        [B, `PR-LC-${tag}`]
      )
    ).rows[0];
    await client.query(
      `INSERT INTO purchase_return_items (return_id, item_id, description, qty, unit_price, taxable_value, line_total)
       VALUES ($1,$2,'Cotton',4,10,40,40)`,
      [ret.id, ITEM]
    );
    await expect(
      reverseHistoricalLandedCost(client, { businessId: B, adjustmentId: again.adjustmentId, reason: 'sold' })
    ).rejects.toMatchObject({ code: 'LANDED_COST_PARTIALLY_CONSUMED' });
    await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  test('refunded freight stays on the return note and does not hit freight inward', async () => {
    const result = await purchase({
      bill: `REF-${tag}`,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 10, unit_price: 1000, tax_rate: 18, hsn_sac: '6109' }],
      charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
    });
    const response = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': USER,
          'x-authenticated-business-id': B,
          'x-authenticated-session-version': '1',
        },
        body: JSON.stringify({
          purchase_id: result.purchase.id,
          return_number: `PR-REF-${tag}`,
          return_date: DAY,
          refund_incidental_charges: true,
          items: [{ item_id: ITEM, qty: 4 }],
        }),
      })
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    const books = await ledger(body.purchaseReturn.id);
    expect(books.get('5102')).toEqual({ debit: 4400, credit: 4400 });
    expect(books.get('1104')?.credit).toBe(4400);
    expect(books.get('5105')).toBeUndefined();
    expect((books.get('1110')?.credit || 0) + (books.get('1111')?.credit || 0)).toBe(792);
    expect(books.get('2101')?.debit).toBe(5192);
    const note = (
      await pool.query<{ subtotal: string }>(
        `SELECT subtotal::text FROM purchase_returns WHERE id = $1`,
        [body.purchaseReturn.id]
      )
    ).rows[0];
    expect(Number(note.subtotal)).toBe(4400);
  });

  test('returning more than the remaining quantity rolls back', async () => {
    const result = await purchase({
      bill: `OVER-${tag}`,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 1, unit_price: 100, tax_rate: 0, hsn_sac: '6109' }],
    });
    const before = Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM purchase_returns WHERE business_id = $1`, [B])).rows[0].n
    );
    const response = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': USER,
          'x-authenticated-business-id': B,
          'x-authenticated-session-version': '1',
        },
        body: JSON.stringify({
          purchase_id: result.purchase.id,
          return_number: `PR-OVER-${tag}`,
          return_date: DAY,
          items: [{ item_id: ITEM, qty: 2 }],
        }),
      })
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('RETURN_EXCEEDS_PURCHASED');
    const after = Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM purchase_returns WHERE business_id = $1`, [B])).rows[0].n
    );
    expect(after).toBe(before);
  });

  test('capital goods take the acquisition cost on the asset account and not in stock', async () => {
    const before = Number(
      (await pool.query<{ quantity: string }>(
        `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`,
        [B, ITEM]
      )).rows[0].quantity
    );
    const result = await purchase({
      bill: `CAP-${tag}`,
      items: [{
        item_id: ITEM,
        item_name: 'Loom',
        quantity: 1,
        unit_price: 10000,
        tax_rate: 18,
        hsn_sac: '8446',
        itc_type: 'capital_goods',
      }],
      charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
    });
    const books = await ledger(String(result.purchase.id));
    expect(books.get('1201')?.debit).toBe(11000);
    expect(books.get('1104')).toBeUndefined();
    expect(books.get('1110')?.debit).toBe(990);
    const after = Number(
      (await pool.query<{ quantity: string }>(
        `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`,
        [B, ITEM]
      )).rows[0].quantity
    );
    expect(after).toBe(before);
    const assets = Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM fixed_assets WHERE business_id = $1`, [B])).rows[0].n
    );
    expect(assets).toBe(0);
  });

  test('weighted average uses acquisition cost', async () => {
    const item = randomUUID();
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,'Yarn','goods','NOS',0,0,18,'5208')`,
      [item, B]
    );
    await purchase({
      bill: `AVG-${tag}`,
      items: [{ item_id: item, item_name: 'Yarn', quantity: 10, unit_price: 1000, tax_rate: 0, hsn_sac: '5208' }],
      charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 0, hsn_sac: '9965' }],
    });
    const rates = await weightedAverageCosts(pool, B, [item], DAY, BR);
    expect(rates.get(item)).toBe(1100);
  });

  test('a purchase order with an unclassified extra charge is not converted', async () => {
    const orderId = randomUUID();
    await pool.query(
      `INSERT INTO purchase_orders (id, business_id, supplier_id, order_number, order_date, status, subtotal, grand_total, additional_charges, created_by)
       VALUES ($1,$2,$3,$4,$5,'confirmed',100,100,50,$6)`,
      [orderId, B, SUP, `PO-${tag}`, DAY, USER]
    );
    const response = await convertOrder(
      new NextRequest(`http://localhost/api/purchase-orders/${orderId}/convert`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': USER,
          'x-authenticated-business-id': B,
        },
        body: JSON.stringify({}),
      }),
      { params: { id: orderId } }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('CHARGE_UNCLASSIFIED');
    const status = (
      await pool.query<{ status: string; converted_purchase_id: string | null }>(
        `SELECT status, converted_purchase_id FROM purchase_orders WHERE id = $1`,
        [orderId]
      )
    ).rows[0];
    expect(status.status).toBe('confirmed');
    expect(status.converted_purchase_id).toBeNull();
  });

  test('offline replay capitalizes classified freight', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await executePurchaseFinalizeReplay(client, {
        businessId: B,
        userId: USER,
        idempotencyKey: randomUUID(),
        actionType: 'purchase.finalize',
        requestPayload: {
          bill_number: `OFF-${tag}`,
          bill_date: DAY,
          supplier_id: SUP,
          branch_id: BR,
          place_of_supply_state_code: '27',
          supplier_state_code: '27',
          subtotal: 11000,
          tax_total: 1980,
          grand_total: 12980,
          items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 10, unit_price: 1000, tax_rate: 18, hsn_sac: '6109' }],
          charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
        },
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      await client.query('COMMIT');
      const books = await ledger(String(replay.entityId));
      expect(books.get('1104')?.debit).toBe(11000);
      expect(books.get('2101')?.credit).toBe(12980);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  test('a supplier credit note does not move stock or freight inward', async () => {
    const result = await purchase({
      bill: `SCN-${tag}`,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 1, unit_price: 4000, tax_rate: 18, hsn_sac: '6109' }],
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const note = await createPurchaseInTransaction(client, {
        business_id: B,
        created_by: USER,
        branch_id: BR,
        supplier_id: SUP,
        bill_number: `SCN-DOC-${tag}`,
        bill_date: DAY,
        status: 'final',
        document_type: 'supplier_credit_note',
        place_of_supply_state_code: '27',
        supplier_state_code: '27',
        items: [{ item_id: SVC, item_name: 'Haulage', item_type: 'service', quantity: 1, unit_price: 4000, tax_rate: 18, hsn_sac: '9965' }],
      });
      await client.query('COMMIT');
      const books = await ledger(String(note.purchase.id));
      expect(books.get('5102')?.credit).toBe(4000);
      expect(books.get('1104')).toBeUndefined();
      expect(books.get('5105')).toBeUndefined();
      expect(books.get('2101')?.debit).toBe(4720);
      await expect(
        createPurchaseInTransaction(client, {
          business_id: B,
          created_by: USER,
          branch_id: BR,
          supplier_id: SUP,
          bill_number: `SCN-BAD-${tag}`,
          bill_date: DAY,
          status: 'final',
          document_type: 'supplier_credit_note',
          items: [{ item_id: SVC, item_name: 'Haulage', item_type: 'service', quantity: 1, unit_price: 100, tax_rate: 0, hsn_sac: '9965' }],
          charges: [{ amount: 10, classification: 'incidental_to_goods', tax_rate: 0 }],
        })
      ).rejects.toMatchObject({ code: 'SUPPLIER_CREDIT_NO_CHARGE' });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    expect(result.purchase.id).toBeTruthy();
  });

  test('the return preview matches the saved freight refund, and a repeat or failed post does not double the books', async () => {
    const headers = {
      'content-type': 'application/json',
      'x-authenticated-user-id': USER,
      'x-authenticated-business-id': B,
      'x-authenticated-session-version': '1',
    };
    const stockBefore = Number(
      (await pool.query<{ quantity: string }>(
        `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`,
        [B, ITEM]
      )).rows[0].quantity
    );
    const supplierBefore = Number(
      (await pool.query<{ balance: string }>(`SELECT current_balance::text AS balance FROM suppliers WHERE id = $1`, [SUP])).rows[0].balance
    );
    const result = await purchase({
      bill: `PREV-${tag}`,
      items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 10, unit_price: 1000, tax_rate: 18, hsn_sac: '6109' }],
      charges: [
        { purpose: 'Freight', amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' },
        { purpose: 'Install', amount: 500, classification: 'independent_service', tax_rate: 18, hsn_sac: '9983' },
      ],
    });
    const purchaseId = String(result.purchase.id);
    const charges = await pool.query(
      `SELECT classification, taxable_value, cgst_amount, sgst_amount, igst_amount, id
         FROM purchase_charges WHERE purchase_id = $1`,
      [purchaseId]
    );
    const allocationRows = await pool.query(
      `SELECT a.purchase_charge_id, a.amount, pi.item_id, pi.quantity
         FROM purchase_charge_allocations a
         JOIN purchase_items pi ON pi.id = a.purchase_item_id
        WHERE pi.purchase_id = $1`,
      [purchaseId]
    );
    const allocations = incidentalAllocationsFromCharges(
      charges.rows.map((charge) => ({
        ...charge,
        allocations: allocationRows.rows
          .filter((row) => row.purchase_charge_id === charge.id)
          .map((row) => ({ item_id: row.item_id, amount: row.amount, quantity: row.quantity })),
      }))
    );
    expect(allocations).toHaveLength(1);

    const unchecked = buildReturnLinesFromBill({
      billLines: [{ item_id: ITEM, item_name: 'Cotton', hsn_sac: '6109', unit: 'NOS', quantity: 10, taxable_value: 10000, tax_rate: 18, igst_amount: 0 }],
      requested: [{ item_id: ITEM, qty: 4 }],
      alreadyReturned: new Map(),
    });
    expect(unchecked.totals.grand_total).toBe(4720);
    const first = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchase_id: purchaseId,
          return_number: `PR-PREV-1-${tag}`,
          return_date: DAY,
          items: [{ item_id: ITEM, qty: 4 }],
        }),
      })
    );
    const firstBody = await first.json();
    expect(first.status).toBe(201);
    expect(Number(firstBody.purchaseReturn.subtotal)).toBe(unchecked.totals.subtotal);
    expect(Number(firstBody.purchaseReturn.tax_total)).toBe(unchecked.totals.tax_total);
    expect(Number(firstBody.purchaseReturn.grand_total)).toBe(4720);
    const firstBooks = await ledger(firstBody.purchaseReturn.id);
    expect(firstBooks.get('1104')?.credit).toBe(4400);
    expect(firstBooks.get('5102')).toEqual({ debit: 4000, credit: 4000 });
    expect(firstBooks.get('5105')?.debit).toBe(400);

    const duplicate = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchase_id: purchaseId,
          return_number: `PR-PREV-1-${tag}`,
          return_date: DAY,
          items: [{ item_id: ITEM, qty: 1 }],
        }),
      })
    );
    expect(duplicate.status).toBe(409);
    expect(Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM purchase_returns WHERE purchase_id = $1`, [purchaseId])).rows[0].n
    )).toBe(1);

    const preview = applyIncidentalFreightRefund(
      buildReturnLinesFromBill({
        billLines: [{ item_id: ITEM, item_name: 'Cotton', hsn_sac: '6109', unit: 'NOS', quantity: 10, taxable_value: 10000, tax_rate: 18, igst_amount: 0 }],
        requested: [{ item_id: ITEM, qty: 6 }],
        alreadyReturned: new Map([[`id:${ITEM}`, 4]]),
      }).totals,
      {
        allocations,
        lines: [{ item_id: ITEM, qty: 6 }],
        priorQuantities: new Map([[ITEM, [4]]]),
      }
    );
    expect(preview).toEqual({ subtotal: 6600, cgst_total: 594, sgst_total: 594, igst_total: 0, tax_total: 1188, grand_total: 7788 });

    const beforeReject = Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM purchase_returns WHERE purchase_id = $1`, [purchaseId])).rows[0].n
    );
    const tooMany = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchase_id: purchaseId,
          return_number: `PR-PREV-X-${tag}`,
          return_date: DAY,
          refund_incidental_charges: true,
          items: [{ item_id: ITEM, qty: 7 }],
        }),
      })
    );
    expect(tooMany.status).toBe(400);
    expect(Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM purchase_returns WHERE purchase_id = $1`, [purchaseId])).rows[0].n
    )).toBe(beforeReject);

    const second = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchase_id: purchaseId,
          return_number: `PR-PREV-2-${tag}`,
          return_date: DAY,
          refund_incidental_charges: true,
          items: [{ item_id: ITEM, qty: 6 }],
        }),
      })
    );
    const secondBody = await second.json();
    expect(second.status).toBe(201);
    expect(Number(secondBody.purchaseReturn.subtotal)).toBe(preview.subtotal);
    expect(Number(secondBody.purchaseReturn.tax_total)).toBe(preview.tax_total);
    expect(Number(secondBody.purchaseReturn.grand_total)).toBe(preview.grand_total);
    const saved = (
      await pool.query<{ subtotal: string; tax_total: string; grand_total: string }>(
        `SELECT subtotal::text, tax_total::text, grand_total::text FROM purchase_returns WHERE id = $1`,
        [secondBody.purchaseReturn.id]
      )
    ).rows[0];
    expect(Number(saved.subtotal)).toBe(6600);
    expect(Number(saved.tax_total)).toBe(1188);
    expect(Number(saved.grand_total)).toBe(7788);
    const itemLine = (
      await pool.query<{ taxable: string; tax: string }>(
        `SELECT taxable_value::text AS taxable, tax_amount::text AS tax FROM purchase_return_items WHERE return_id = $1`,
        [secondBody.purchaseReturn.id]
      )
    ).rows[0];
    expect(Number(itemLine.taxable)).toBe(6000);
    expect(Number(itemLine.tax)).toBe(1080);
    const secondBooks = await ledger(secondBody.purchaseReturn.id);
    expect(secondBooks.get('1104')?.credit).toBe(6600);
    expect(secondBooks.get('5102')).toEqual({ debit: 6600, credit: 6600 });
    expect(secondBooks.get('5105')).toBeUndefined();
    expect(secondBooks.get('2101')?.debit).toBe(7788);
    const bill = (
      await pool.query<{ balance: string; cost: string }>(
        `SELECT p.balance_amount::text AS balance, pi.acquisition_cost::text AS cost
           FROM purchases p JOIN purchase_items pi ON pi.purchase_id = p.id
          WHERE p.id = $1`,
        [purchaseId]
      )
    ).rows[0];
    expect(Number(bill.balance)).toBe(1062);
    expect(Number(bill.cost)).toBe(11000);
    expect(Number(
      (await pool.query<{ balance: string }>(`SELECT current_balance::text AS balance FROM suppliers WHERE id = $1`, [SUP])).rows[0].balance
    )).toBe(supplierBefore + 1062);
    expect(Number(
      (await pool.query<{ quantity: string }>(
        `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`,
        [B, ITEM]
      )).rows[0].quantity
    )).toBe(stockBefore);
    const lot = (await replayCostItems(pool, B, [ITEM])).replays.get(ITEM)?.lots.find((row) => row.docId === purchaseId);
    expect(lot?.remaining).toBe(0);

    const again = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchase_id: purchaseId,
          return_number: `PR-PREV-3-${tag}`,
          return_date: DAY,
          refund_incidental_charges: true,
          items: [{ item_id: ITEM, qty: 6 }],
        }),
      })
    );
    expect(again.status).toBe(400);
    expect(Number(
      (await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM purchase_returns WHERE purchase_id = $1 AND COALESCE(status, 'final') <> 'cancelled'`,
        [purchaseId]
      )).rows[0].n
    )).toBe(2);

    const cancelled = await cancelReturn(
      new NextRequest(`http://localhost/api/purchase-returns/${secondBody.purchaseReturn.id}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Wrong freight choice' }),
      }),
      { params: { id: secondBody.purchaseReturn.id } }
    );
    expect(cancelled.status).toBe(200);
    expect(Number(
      (await pool.query<{ balance: string }>(`SELECT balance_amount::text AS balance FROM purchases WHERE id = $1`, [purchaseId])).rows[0].balance
    )).toBe(8850);
    const repost = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchase_id: purchaseId,
          return_number: `PR-PREV-4-${tag}`,
          return_date: DAY,
          refund_incidental_charges: true,
          items: [{ item_id: ITEM, qty: 6 }],
        }),
      })
    );
    const repostBody = await repost.json();
    expect(repost.status).toBe(201);
    expect(Number(repostBody.purchaseReturn.grand_total)).toBe(7788);
    const repostBooks = await ledger(repostBody.purchaseReturn.id);
    expect(repostBooks.get('5102')).toEqual({ debit: 6600, credit: 6600 });
    expect(repostBooks.get('5105')).toBeUndefined();
    expect(Number(
      (await pool.query<{ debit: string }>(
        `SELECT COALESCE(SUM(l.debit), 0)::text AS debit
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND a.account_code = '5105'
            AND l.voucher_id IN (SELECT id FROM purchase_returns WHERE purchase_id = $2)`,
        [B, purchaseId]
      )).rows[0].debit
    )).toBe(400);
  });
});
