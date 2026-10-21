/**
 * Phase 2A release remediation. Writes only after current_database() is kh_phase2_test
 * on localhost port 5433. Report routes use the real permission and subscription gates.
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
    throw new Error('Refusing remediation tests: database host is not local');
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
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn(async () => undefined) }));
jest.mock('@/lib/whatsapp', () => ({}));
jest.mock('@/lib/baileys-hybrid', () => ({}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createPurchaseInTransaction } from '@/lib/purchases/purchase-create-service';
import { applyHistoricalLandedCost } from '@/lib/inventory/landed-cost-application';
import { replayCostItems } from '@/lib/inventory/fifo-costing';
import { postCostOfGoods } from '@/lib/inventory/cogs-posting';
import { adjustBranchItemStock } from '@/lib/branch-stock';
import { GSTR9Generator } from '@/lib/gst/gstr9';
import { purchasesByItem } from '@/lib/reports/purchase-reports';
import { POST as postPurchase } from '@/app/api/purchases/route';
import { GET as getPurchase } from '@/app/api/purchases/[id]/route';
import { PATCH as finalizePurchase } from '@/app/api/purchases/[id]/finalize/route';
import { POST as postReturn } from '@/app/api/purchase-returns/route';
import { POST as cancelPurchase } from '@/app/api/purchases/[id]/cancel/route';
import { GET as itemWiseReport } from '@/app/api/reports/purchase/item-wise/route';
import { GET as gstr9Report } from '@/app/api/reports/gst/gstr9/route';

const DAY = '2026-10-09';

describe('phase 2A release remediation', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const B = randomUUID();
  const BR = randomUUID();
  const USER = randomUUID();
  const SUP = randomUUID();
  const SVC = randomUUID();

  async function assertDb(client: Pool | PoolClient) {
    const info = (
      await client.query<{ db: string; addr: string; port: number }>(
        `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
      )
    ).rows[0];
    if (
      info.db !== 'kh_phase2_test' ||
      info.port !== 5433 ||
      (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))
    ) {
      throw new Error(`Refusing to mutate ${info.db} at ${info.addr}:${info.port}`);
    }
  }

  function headers() {
    return {
      'content-type': 'application/json',
      'x-authenticated-user-id': USER,
      'x-authenticated-business-id': B,
      'x-authenticated-session-version': '1',
    };
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
    itemId: string;
    qty?: number;
    price?: number;
    charges?: Record<string, unknown>[];
    status?: string;
    documentType?: string;
    service?: boolean;
    serviceLine?: boolean;
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
        status: opts.status || 'final',
        document_type: opts.documentType,
        place_of_supply_state_code: '27',
        supplier_state_code: '27',
        items: opts.service
          ? [{ item_id: SVC, item_name: 'Haulage', item_type: 'service', quantity: 1, unit_price: opts.price ?? 4000, tax_rate: 18, hsn_sac: '9965' }]
          : [
              { item_id: opts.itemId, item_name: 'Cotton', quantity: opts.qty ?? 10, unit_price: opts.price ?? 1000, tax_rate: 18, hsn_sac: '6109' },
              ...(opts.serviceLine
                ? [{ item_id: SVC, item_name: 'Haulage', item_type: 'service', quantity: 1, unit_price: 1000, tax_rate: 18, hsn_sac: '9965' }]
                : []),
            ],
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

  async function item(name: string) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,$3,'goods','NOS',1000,1000,18,'6109')`,
      [id, B, name]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,0)`,
      [B, BR, id]
    );
    return id;
  }

  async function sell(itemId: string, qty: number, unitCost: number) {
    const client = await pool.connect();
    const id = randomUUID();
    try {
      await client.query('BEGIN');
      await assertDb(client);
      const stock = await client.query<{ quantity: string }>(
        `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
        [B, BR, itemId]
      );
      const before = Number(stock.rows[0]?.quantity || 0);
      await client.query(
        `INSERT INTO inventory_adjustments (
           id, business_id, adjustment_number, adjustment_date, adjustment_type, item_id, branch_id,
           direction, quantity_change, quantity_before, quantity_after,
           unit_cost_before, unit_cost_after, total_value_before, total_value_after, reason_code
         ) VALUES ($1,$2,$3,$4,'QUANTITY',$5,$6,'DECREASE',$7,$8,$9,$10,$10,$11,$12,'DAMAGE')`,
        [id, B, `SALE-${id.slice(0, 8)}`, DAY, itemId, BR, qty, before, before - qty, unitCost, before * unitCost, (before - qty) * unitCost]
      );
      await adjustBranchItemStock(client, B, BR, itemId, -qty);
      await postCostOfGoods(client, {
        businessId: B,
        voucherType: 'stock_adjustment',
        voucherId: id,
        amount: Math.round(qty * unitCost * 100) / 100,
        entryDate: DAY,
        reference: `SALE-${id.slice(0, 8)}`,
        branchId: BR,
        direction: 'sale',
      });
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function landed(purchaseId: string, goodsItemId: string, amount: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assertDb(client);
      const applied = await applyHistoricalLandedCost(client, {
        businessId: B,
        purchaseId,
        goodsItemId,
        serviceItemId: SVC,
        amount,
        adjustmentDate: DAY,
        branchId: BR,
      });
      await client.query('COMMIT');
      return applied.adjustmentId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function goodsReturn(purchaseId: string, itemId: string, qty: number, number: string) {
    const response = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          purchase_id: purchaseId,
          return_number: number,
          return_date: DAY,
          items: [{ item_id: itemId, item_name: 'Cotton', qty }],
        }),
      })
    );
    const body = await response.json();
    return { status: response.status, body };
  }

  beforeAll(async () => {
    pool = getPool();
    await assertDb(pool);
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN (
          'purchase_management','sales_credit_notes','reports_basic','reports_gst','reports_advanced'
        )
        GROUP BY plan_id
        HAVING COUNT(DISTINCT feature_id) = 5
        LIMIT 1`
    );
    if (!plan.rows[0]) throw new Error('No subscription plan enables purchase, credit note, and report gates');
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type, primary_module)
       VALUES ($1,$2,'27AABCU9603R1ZM','27','Maharashtra','regular','billing')`,
      [B, `Phase2A rem ${tag}`]
    );
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [B]
    );
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [B, plan.rows[0].plan_id]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1,$2,'Main','27',true,true,true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1,$2,'Clerk',$3,true,1,true)`,
      [USER, B, `7${Date.now().toString().slice(-9)}`]
    );
    await pool.query(
      `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
       VALUES ($1,$2,true,true,true,true)`,
      [USER, BR]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1,$2,'Mill','27','27AABCM1234R1Z5',0)`,
      [SUP, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,'Haulage','service','NOS',0,0,18,'9965')`,
      [SVC, B]
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
      await assertDb(client);
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM businesses WHERE id = $1`, [B]);
      });
      await client.query('COMMIT');
    } finally {
      client.release();
      await closePool();
    }
  });

  test('draft, edit, and finalize keep one charge and the goods taxable value', async () => {
    const response = await postPurchase(
      new NextRequest('http://localhost/api/purchases', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          id: undefined,
          business_id: randomUUID(),
          created_by: randomUUID(),
          supplier_id: SUP,
          branch_id: BR,
          bill_number: `UI-${tag}`,
          bill_date: DAY,
          status: 'draft',
          place_of_supply_state_code: '27',
          supplier_state_code: '27',
          items: [{ item_id: await item('Draft cotton'), item_name: 'Cotton', quantity: 10, unit_price: 1000, tax_rate: 18, hsn_sac: '6109' }],
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
        }),
      })
    );
    const created = await response.json();
    expect(response.status).toBe(201);
    const id = created.purchase.id as string;
    const loaded = await getPurchase(
      new NextRequest(`http://localhost/api/purchases/${id}`, { headers: headers() }),
      { params: { id } }
    );
    const purchaseBody = await loaded.json();
    expect(loaded.status).toBe(200);
    expect(purchaseBody.purchase.charges).toHaveLength(1);
    expect(purchaseBody.purchase.charges[0].classification).toBe('incidental_to_goods');
    expect(Number(purchaseBody.purchase.items[0].taxable_value)).toBe(10000);
    expect(purchaseBody.purchase.items[0].acquisition_cost).toBeNull();

    const edited = await postPurchase(
      new NextRequest('http://localhost/api/purchases', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          id,
          supplier_id: SUP,
          branch_id: BR,
          bill_number: `UI-${tag}`,
          bill_date: DAY,
          status: 'draft',
          place_of_supply_state_code: '27',
          supplier_state_code: '27',
          items: purchaseBody.purchase.items.map((line: { item_id: string; taxable_value: string }) => ({
            item_id: line.item_id,
            item_name: 'Cotton',
            quantity: 10,
            unit_price: 1000,
            tax_rate: 18,
            hsn_sac: '6109',
          })),
          charges: [{ purpose: 'Freight', amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
        }),
      })
    );
    expect(edited.status).toBe(201);
    const chargeCount = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM purchase_charges WHERE purchase_id = $1`,
      [id]
    );
    expect(Number(chargeCount.rows[0].n)).toBe(1);

    const finalized = await finalizePurchase(
      new NextRequest(`http://localhost/api/purchases/${id}/finalize`, { method: 'PATCH', headers: headers(), body: '{}' }),
      { params: { id } }
    );
    expect(finalized.status).toBe(200);
    const again = await finalizePurchase(
      new NextRequest(`http://localhost/api/purchases/${id}/finalize`, { method: 'PATCH', headers: headers(), body: '{}' }),
      { params: { id } }
    );
    expect(again.status).toBe(200);
    const after = await pool.query<{ charges: string; cost: string; vouchers: string }>(
      `SELECT (SELECT COUNT(*) FROM purchase_charges WHERE purchase_id = $1)::text AS charges,
              (SELECT acquisition_cost FROM purchase_items WHERE purchase_id = $1 LIMIT 1)::text AS cost,
              (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = $2 AND voucher_id = $1)::text AS vouchers`,
      [id, B]
    );
    expect(Number(after.rows[0].charges)).toBe(1);
    expect(Number(after.rows[0].cost)).toBe(11000);
    expect(Number(after.rows[0].vouchers)).toBeGreaterThan(0);
    const books = await ledger(id);
    expect(books.get('1104')?.debit).toBe(11000);
  });

  test('GSTR-9 keeps incidental freight in input services and supplier credits negative', async () => {
    const before = await new GSTR9Generator().generate({ business_id: B, financial_year: 2026 });
    const goods = await item('GSTR goods');
    const freightItem = await item('GSTR freight goods');
    const serviceItem = await item('GSTR service goods');
    const refundItem = await item('GSTR refund goods');
    await purchase({ bill: `G-ONLY-${tag}`, itemId: goods });
    const freight = await purchase({
      bill: `G-FR-${tag}`,
      itemId: freightItem,
      charges: [{ purpose: 'Freight', amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
    });
    await purchase({
      bill: `G-SVC-${tag}`,
      itemId: serviceItem,
      charges: [{ purpose: 'Install', amount: 500, classification: 'independent_service', tax_rate: 18, hsn_sac: '9983' }],
    });
    const returned = await goodsReturn(String(freight.purchase.id), freightItem, 4, `G-RET-${tag}`);
    expect(returned.status).toBe(201);
    const refund = await purchase({
      bill: `G-RF-${tag}`,
      itemId: refundItem,
      qty: 1,
      price: 1000,
      charges: [{ purpose: 'Freight', amount: 100, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
    });
    const refunded = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          purchase_id: refund.purchase.id,
          return_number: `G-RF-RET-${tag}`,
          return_date: DAY,
          refund_incidental_charges: true,
          items: [{ item_id: refundItem, item_name: 'Cotton', qty: 1 }],
        }),
      })
    );
    expect(refunded.status).toBe(201);
    await purchase({
      bill: `G-SCN-${tag}`,
      itemId: goods,
      service: true,
      price: 4000,
      documentType: 'supplier_credit_note',
    });

    const data = await new GSTR9Generator().generate({ business_id: B, financial_year: 2026 });
    const inputs = data.table_6.B.inputs.taxable_value - before.table_6.B.inputs.taxable_value;
    const inputTax = data.table_6.B.inputs.cgst - before.table_6.B.inputs.cgst;
    const services = data.table_6.B.input_services.taxable_value - before.table_6.B.input_services.taxable_value;
    const serviceTax = data.table_6.B.input_services.cgst - before.table_6.B.input_services.cgst;
    expect(inputs).toBe(10000 + 10000 + 10000 + 1000 - 4000 - 1000);
    expect(inputTax).toBe(900 + 900 + 900 + 90 - 360 - 90);
    expect(services).toBe(1000 + 500 + 100 - 100 - 4000);
    expect(serviceTax).toBe(90 + 45 + 9 - 9 - 360);
    expect(inputs + services).toBe(10000 + 11000 + 10500 + 1100 - 4000 - 1100 - 4000);

    const http = await gstr9Report(
      new NextRequest(`http://localhost/api/reports/gst/gstr9?financial_year=2026`, { headers: headers() })
    );
    const httpBody = await http.json();
    expect(http.status).toBe(200);
    expect(httpBody.table_6.B.inputs.taxable_value).toBe(data.table_6.B.inputs.taxable_value);
    expect(httpBody.table_6.B.input_services.taxable_value).toBe(data.table_6.B.input_services.taxable_value);
  });

  test('item-wise purchase report keeps freight out of the goods lines and counts it once', async () => {
    const before = await purchasesByItem({ businessId: B, userId: USER, fromDate: DAY, toDate: DAY, branchId: null });
    const goods = await item('Report cotton');
    await purchase({ bill: `R-ONLY-${tag}`, itemId: goods, qty: 2, price: 500 });
    await purchase({
      bill: `R-FR-${tag}`,
      itemId: goods,
      charges: [{ purpose: 'Freight', amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
    });
    await purchase({
      bill: `R-SVC-${tag}`,
      itemId: goods,
      qty: 1,
      price: 2000,
      charges: [{ purpose: 'Install', amount: 300, classification: 'independent_service', tax_rate: 18, hsn_sac: '9983' }],
    });
    const report = await purchasesByItem({ businessId: B, userId: USER, fromDate: DAY, toDate: DAY, branchId: null });
    const row = report.items.find((line) => line.item_name === 'Report cotton');
    const freight = report.charges.incidental_freight.net_taxable - before.charges.incidental_freight.net_taxable;
    const services = report.charges.independent_services.taxable - before.charges.independent_services.taxable;
    expect(row?.amount).toBe(1000 + 10000 + 2000);
    expect(freight).toBe(1000);
    expect(services).toBe(300);
    expect(row && row.amount + freight + services).toBe(14300);

    const http = await itemWiseReport(
      new NextRequest(`http://localhost/api/reports/purchase/item-wise?from_date=${DAY}&to_date=${DAY}`, { headers: headers() })
    );
    const body = await http.json();
    expect(http.status).toBe(200);
    expect(body.charges.contract).toBe('goods_lines');
    const httpRow = body.items.find((line: { item_name: string }) => line.item_name === 'Report cotton');
    expect(httpRow.amount).toBe(13000);
    expect(body.charges.incidental_freight.net_taxable - before.charges.incidental_freight.net_taxable).toBe(1000);
  });

  test('a return after landed cost relieves the current lot cost and leaves acquisition cost unchanged', async () => {
    const before = await item('Before adjust');
    const bought = await purchase({
      bill: `LC-BEFORE-${tag}`,
      itemId: before,
      serviceLine: true,
    });
    const first = await goodsReturn(String(bought.purchase.id), before, 4, `LC-B1-${tag}`);
    expect(first.status).toBe(201);
    expect((await ledger(first.body.purchaseReturn.id)).get('1104')?.credit).toBe(4000);
    expect((await ledger(first.body.purchaseReturn.id)).get('5201')).toBeUndefined();
    await landed(String(bought.purchase.id), before, 180);
    const second = await goodsReturn(String(bought.purchase.id), before, 2, `LC-B2-${tag}`);
    expect(second.status).toBe(201);
    const secondBooks = await ledger(second.body.purchaseReturn.id);
    expect(secondBooks.get('5102')).toEqual({ debit: 2000, credit: 2000 });
    expect(secondBooks.get('1104')?.credit).toBe(2060);
    expect(secondBooks.get('5201')?.debit).toBe(60);
    expect(secondBooks.get('5105')).toBeUndefined();
    const cost = await pool.query<{ cost: string }>(
      `SELECT acquisition_cost::text AS cost FROM purchase_items WHERE purchase_id = $1 AND item_id = $2`,
      [bought.purchase.id, before]
    );
    expect(Number(cost.rows[0].cost)).toBe(10000);

    const supplierBefore = Number(
      (await pool.query<{ balance: string }>(`SELECT current_balance::text AS balance FROM suppliers WHERE id = $1`, [SUP])).rows[0].balance
    );
    const after = await item('After adjust');
    const adjusted = await purchase({
      bill: `LC-AFTER-${tag}`,
      itemId: after,
      serviceLine: true,
    });
    await landed(String(adjusted.purchase.id), after, 200);
    const sale = await sell(after, 3, 1020);
    expect((await ledger(sale)).get('5104')?.debit).toBe(3060);
    const partial = await goodsReturn(String(adjusted.purchase.id), after, 4, `LC-A-${tag}`);
    expect(partial.status).toBe(201);
    const partialBooks = await ledger(partial.body.purchaseReturn.id);
    expect(partialBooks.get('1104')?.credit).toBe(4080);
    expect(partialBooks.get('5201')?.debit).toBe(80);
    expect(partialBooks.get('5102')?.debit).toBe(4000);
    expect(partialBooks.get('5102')?.credit).toBe(4000);
    expect(partialBooks.get('5104')).toBeUndefined();
    expect(partialBooks.get('5105')).toBeUndefined();
    const lot = (await replayCostItems(pool, B, [after])).replays.get(after)?.lots.find((row) => row.docId === adjusted.purchase.id);
    expect(lot?.remaining).toBe(3);
    expect(Math.round((lot?.remaining || 0) * (lot?.unitCost || 0))).toBe(3060);
    const stock = await pool.query<{ quantity: string }>(
      `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`,
      [B, after]
    );
    expect(Number(stock.rows[0].quantity)).toBe(3);
    const future = await sell(after, 3, 1020);
    expect((await ledger(future)).get('5104')?.debit).toBe(3060);
    expect((await ledger(future)).get('1104')?.credit).toBe(3060);
    const supplier = await pool.query<{ balance: string }>(`SELECT current_balance::text AS balance FROM suppliers WHERE id = $1`, [SUP]);
    expect(Number(supplier.rows[0].balance) - supplierBefore).toBe(12980 - 4720);

    const fullItem = await item('Full return');
    const full = await purchase({
      bill: `LC-FULL-${tag}`,
      itemId: fullItem,
      serviceLine: true,
    });
    await landed(String(full.purchase.id), fullItem, 200);
    const all = await goodsReturn(String(full.purchase.id), fullItem, 10, `LC-F-${tag}`);
    expect(all.status).toBe(201);
    const fullBooks = await ledger(all.body.purchaseReturn.id);
    expect(fullBooks.get('1104')?.credit).toBe(10200);
    expect(fullBooks.get('5201')?.debit).toBe(200);
    expect(fullBooks.get('5102')).toEqual({ debit: 10000, credit: 10000 });
    const fullStock = await pool.query<{ quantity: string }>(
      `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`,
      [B, fullItem]
    );
    expect(Number(fullStock.rows[0].quantity)).toBe(0);

    const cancelItem = await item('Cancel intact');
    const cancelBill = await purchase({
      bill: `LC-CAN-${tag}`,
      itemId: cancelItem,
      serviceLine: true,
    });
    await landed(String(cancelBill.purchase.id), cancelItem, 200);
    const cancelled = await cancelPurchase(
      new NextRequest(`http://localhost/api/purchases/${cancelBill.purchase.id}/cancel`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ reason: 'wrong bill' }),
      }),
      { params: { id: String(cancelBill.purchase.id) } }
    );
    expect(cancelled.status).toBe(200);
    const nets = await pool.query<{ account_code: string; net: string }>(
      `SELECT a.account_code, SUM(l.debit - l.credit)::text AS net
         FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.business_id = $1 AND l.voucher_id IN (
          SELECT id FROM inventory_adjustments WHERE purchase_id = $2
          UNION SELECT $2::uuid
        )
        GROUP BY a.account_code`,
      [B, cancelBill.purchase.id]
    );
    for (const row of nets.rows) expect(Number(row.net)).toBe(0);
    const cancelStock = await pool.query<{ quantity: string }>(
      `SELECT quantity::text FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`,
      [B, cancelItem]
    );
    expect(Number(cancelStock.rows[0].quantity)).toBe(0);

    const unsafeItem = await item('Cancel consumed');
    const unsafe = await purchase({
      bill: `LC-UNSAFE-${tag}`,
      itemId: unsafeItem,
      serviceLine: true,
    });
    await landed(String(unsafe.purchase.id), unsafeItem, 200);
    await sell(unsafeItem, 1, 1020);
    const linesBefore = Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n
    );
    const rejected = await cancelPurchase(
      new NextRequest(`http://localhost/api/purchases/${unsafe.purchase.id}/cancel`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ reason: 'too late' }),
      }),
      { params: { id: String(unsafe.purchase.id) } }
    );
    const rejectedBody = await rejected.json();
    expect(rejected.status).toBe(409);
    expect(rejectedBody.code).toBe('LANDED_COST_PARTIALLY_CONSUMED');
    const status = await pool.query<{ status: string }>(`SELECT status FROM purchases WHERE id = $1`, [unsafe.purchase.id]);
    expect(status.rows[0].status).toBe('final');
    const linesAfter = Number(
      (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n
    );
    expect(linesAfter).toBe(linesBefore);
  });
});
