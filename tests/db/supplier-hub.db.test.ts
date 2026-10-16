/**
 * Supplier Hub phase 0 on a real database (docs/SUPPLIER_HUB_BUILD_PLAN.md, B1–B6):
 * retailer A links wholesaler B, the link waits for B's approval, A's own reorder level raises
 * an alert for B, and B's sales invoice becomes A's purchase (item matched, stock added once).
 * Opt-in, disposable DB only:
 *   SUPPLIER_HUB_DB_TEST=1 npx jest tests/db/supplier-hub.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migration 389 is applied in beforeAll.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.SUPPLIER_HUB_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}

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
// Every supplier business counts as subscribed here; subscriptions are covered elsewhere.
jest.mock('@/lib/subscription', () => ({
  ...jest.requireActual('@/lib/subscription'),
  getBusinessSubscription: jest.fn().mockResolvedValue({ status: 'active', end_date: null }),
  isSubscriptionOperationalStatus: jest.fn(() => true),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { NextRequest } from 'next/server';
import { closePool, query, queryOne } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { checkLowStockForItem } from '@/lib/low-stock-checker';
import { POST as createSupplier } from '@/app/api/suppliers/route';
import { POST as approveSupplier } from '@/app/api/suppliers/[id]/approve/route';
import { POST as createStockRequest } from '@/app/api/stock-requests/route';
import { POST as setThreshold } from '@/app/api/suppliers/thresholds/route';
import { POST as convertInvoice } from '@/app/api/invoices/[id]/convert-to-purchase/route';
import { POST as createListing } from '@/app/api/suppliers/hub/published-listings/route';
import { PATCH as patchListing } from '@/app/api/suppliers/hub/published-listings/[id]/route';

const migration389 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/389_purchase_source_invoice.sql'),
  'utf8'
);

const run = enabled ? describe : describe.skip;

run('Supplier Hub phase 0 (kh_phase2_test)', () => {
  jest.setTimeout(120000);

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const [A, B, C] = [randomUUID(), randomUUID(), randomUUID()];
  const [UA, UB, UC] = [randomUUID(), randomUUID(), randomUUID()];
  const [BRA, BRB, BRC] = [randomUUID(), randomUUID(), randomUUID()];
  const GSTIN_A = `29AAACK${1000 + Math.floor(Math.random() * 9000)}A1Z5`;
  const ITEM_A = randomUUID();
  const ITEM_B = randomUUID();
  const CUST_A_AT_B = randomUUID();
  const INVOICE = randomUUID();
  const INVOICE_LINE = randomUUID();
  let supplierRowId = '';

  const headers = (user: string, biz: string) => ({
    'content-type': 'application/json',
    'x-authenticated-user-id': user,
    'x-authenticated-business-id': biz,
  });
  const post = (url: string, user: string, biz: string, body: object) =>
    new NextRequest(`http://localhost${url}`, { method: 'POST', headers: headers(user, biz), body: JSON.stringify(body) });

  beforeAll(async () => {
    await query(migration389);
    for (const [biz, user, branch, name, gstin] of [
      [A, UA, BRA, `Hub Retailer ${tag}`, GSTIN_A],
      [B, UB, BRB, `Hub Wholesaler ${tag}`, null],
      [C, UC, BRC, `Hub Stranger ${tag}`, null],
    ] as const) {
      await query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '29', 'regular')`,
        [biz, name, gstin]
      );
      await query(
        `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
         VALUES ($1, $2, 'Main', '29', true, true, true)`,
        [branch, biz]
      );
      await query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
        [user, biz, `9${randomUUID().replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`]
      );
      await query(`SELECT create_default_chart_of_accounts($1)`, [biz]);
    }
    // A's own item with a reorder level of 10 and 3 in stock.
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, min_stock, current_stock, is_active)
       VALUES ($1, $2, 'Parle-G 50g', 'PCS', 'goods', 10, 3, true)`,
      [ITEM_A, A]
    );
    await query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 3)`,
      [A, BRA, ITEM_A]
    );
    // B's item for the same product under B's own name.
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, current_stock, is_active)
       VALUES ($1, $2, 'PARLE G 50GM CTN', 'PCS', 'goods', 500, true)`,
      [ITEM_B, B]
    );
    await query(
      `INSERT INTO customers (id, business_id, name, gstin, state_code) VALUES ($1, $2, 'Retailer A', $3, '29')`,
      [CUST_A_AT_B, B, GSTIN_A]
    );
  });

  afterAll(async () => {
    try {
      await query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[A, B, C]]);
      await query(`DELETE FROM low_stock_alerts WHERE customer_business_id = $1`, [A]);
      await query(`DELETE FROM quantity_requests WHERE requester_business_id = $1 OR responder_business_id = $1`, [A]);
      const { getPool } = await import('@/lib/db');
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await withLedgerDelete(client, 'tenant_purge', UA, async () => {
          await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[A, B, C]]);
        });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      await query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[A, B, C]]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  it('a link to B stays pending until B approves it (B3)', async () => {
    const res = await createSupplier(
      post('/api/suppliers', UA, A, {
        name: 'B Traders',
        linked_business_id: B,
        allow_low_stock_access: true,
      })
    );
    expect(res.status).toBeLessThan(300);
    const { supplier } = await res.json();
    supplierRowId = supplier.id;
    expect(supplier.approval_status).toBe('pending');

    const note = await queryOne(
      `SELECT type FROM notifications WHERE business_id = $1 AND reference_id = $2`,
      [B, supplierRowId]
    );
    expect(note?.type).toBe('supplier_request');

    // Not linked yet: A cannot send B a quantity request.
    const reqRes = await createStockRequest(
      post('/api/stock-requests', UA, A, {
        requests: [{ requester_business_id: A, responder_business_id: B, item_id: ITEM_A, requested_qty: 24 }],
      })
    );
    expect(reqRes.status).toBe(400);
    expect((await reqRes.json()).code).toBe('SUPPLIER_NOT_LINKED');

    // No low-stock alert while pending, even with B as default supplier.
    await query(`UPDATE items SET default_supplier_id = $1 WHERE id = $2`, [supplierRowId, ITEM_A]);
    await checkLowStockForItem(ITEM_A, A);
    const pendingAlert = await queryOne(`SELECT id FROM low_stock_alerts WHERE item_id = $1`, [ITEM_A]);
    expect(pendingAlert).toBeNull();
  });

  it('only B can approve; then requests and alerts work (B2)', async () => {
    const byA = await approveSupplier(post(`/api/suppliers/${supplierRowId}/approve`, UA, A, { action: 'approve' }), {
      params: { id: supplierRowId },
    });
    expect(byA.status).toBe(403);

    const byB = await approveSupplier(post(`/api/suppliers/${supplierRowId}/approve`, UB, B, { action: 'approve' }), {
      params: { id: supplierRowId },
    });
    expect(byB.status).toBe(200);

    await checkLowStockForItem(ITEM_A, A);
    const alert = await queryOne(
      `SELECT supplier_business_id, threshold, alert_status FROM low_stock_alerts WHERE item_id = $1`,
      [ITEM_A]
    );
    expect(alert).toMatchObject({ supplier_business_id: B, alert_status: 'active' });
    expect(Number(alert.threshold)).toBe(10);
    const note = await queryOne(
      `SELECT message FROM notifications WHERE business_id = $1 AND type = 'low_stock_alert' AND reference_id = $2`,
      [B, ITEM_A]
    );
    expect(note?.message).toContain('Parle-G 50g');

    // A second check does not duplicate the alert.
    await checkLowStockForItem(ITEM_A, A);
    const count = await queryOne(`SELECT COUNT(*)::int AS n FROM low_stock_alerts WHERE item_id = $1`, [ITEM_A]);
    expect(count.n).toBe(1);

    const reqRes = await createStockRequest(
      post('/api/stock-requests', UA, A, {
        requests: [{ requester_business_id: A, responder_business_id: B, item_id: ITEM_A, requested_qty: 24 }],
      })
    );
    expect(reqRes.status).toBe(200);
    const reqNote = await queryOne(
      `SELECT message FROM notifications WHERE business_id = $1 AND type = 'quantity_request' ORDER BY created_at DESC LIMIT 1`,
      [B]
    );
    expect(reqNote?.message).toContain('Parle-G 50g');
    expect(reqNote?.message).not.toContain(ITEM_A);
  });

  it('supplier-set thresholds are retired (B4)', async () => {
    const res = await setThreshold(
      post('/api/suppliers/thresholds', UB, B, {
        supplier_business_id: B,
        customer_business_id: A,
        item_id: ITEM_B,
        low_stock_threshold: 5,
      })
    );
    expect(res.status).toBe(410);
  });

  it('catalog listings belong to the session business, whatever the body says (B6)', async () => {
    // B claims to be A and to be a different user: the session wins.
    const res = await createListing(
      post('/api/suppliers/hub/published-listings', UB, B, {
        business_id: A,
        created_by_user_id: UA,
        item_id: ITEM_B,
        audience: 'linked_only',
        moq: 12,
      })
    );
    expect(res.status).toBe(201);
    const { listing } = await res.json();
    expect(listing.supplier_business_id).toBe(B);

    // A cannot publish B's item by sending B's id.
    const spoof = await createListing(
      post('/api/suppliers/hub/published-listings', UA, A, { business_id: B, item_id: ITEM_B })
    );
    expect(spoof.status).toBe(400);

    // A cannot edit B's listing.
    const edit = await patchListing(
      new NextRequest(`http://localhost/api/suppliers/hub/published-listings/${listing.id}`, {
        method: 'PATCH',
        headers: headers(UA, A),
        body: JSON.stringify({ business_id: B, updated_by_user_id: UB, moq: 1 }),
      }),
      { params: { id: listing.id } }
    );
    expect(edit.status).toBe(404);

    // No session, no write.
    const anon = await createListing(
      new NextRequest('http://localhost/api/suppliers/hub/published-listings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ business_id: B, created_by_user_id: UB, item_id: ITEM_B }),
      })
    );
    expect(anon.status).toBe(401);
  });

  it("B's invoice becomes A's purchase with the right item, once (B1, B5)", async () => {
    await query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, customer_gstin)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '29', 1200, 0, 0, 0, 0, 1200, 0, 1200, 'unpaid', $5, $6)`,
      [INVOICE, B, CUST_A_AT_B, `HUB-${tag}`, BRB, GSTIN_A]
    );
    await query(
      `INSERT INTO invoice_items (id, invoice_id, item_id, item_name, quantity, unit, unit_price, taxable_value, line_total, sort_order)
       VALUES ($1, $2, $3, 'PARLE G 50GM CTN', 12, 'PCS', 100, 1200, 1200, 0)`,
      [INVOICE_LINE, INVOICE, ITEM_B]
    );
    const url = `/api/invoices/${INVOICE}/convert-to-purchase`;
    const convert = (user: string, biz: string, body: object = {}) =>
      convertInvoice(post(url, user, biz, body), { params: { id: INVOICE } });

    // A business with no approved link to B cannot read B's invoice.
    expect((await convert(UC, C)).status).toBe(403);

    // Names differ, so A must match the line first.
    const unmatched = await convert(UA, A);
    expect(unmatched.status).toBe(422);
    const unmatchedBody = await unmatched.json();
    expect(unmatchedBody.code).toBe('ITEMS_UNMATCHED');
    expect(unmatchedBody.unmatched).toEqual([{ invoice_item_id: INVOICE_LINE, item_name: 'PARLE G 50GM CTN' }]);

    // Mapping to an item that is not A's is refused.
    const foreign = await convert(UA, A, { item_map: { [INVOICE_LINE]: ITEM_B } });
    expect(foreign.status).toBe(400);

    const ok = await convert(UA, A, { item_map: { [INVOICE_LINE]: ITEM_A } });
    expect(ok.status).toBe(201);
    const { purchase } = await ok.json();
    expect(purchase).toMatchObject({
      business_id: A,
      supplier_id: supplierRowId,
      source_invoice_id: INVOICE,
      source_business_id: B,
    });
    const line = await queryOne(`SELECT item_id, quantity, unit FROM purchase_items WHERE purchase_id = $1`, [purchase.id]);
    expect(line).toMatchObject({ item_id: ITEM_A, unit: 'PCS' });
    const stock = await queryOne(`SELECT current_stock FROM items WHERE id = $1`, [ITEM_A]);
    expect(Number(stock.current_stock)).toBe(15);
    // B's books are untouched.
    const bPurchases = await queryOne(`SELECT COUNT(*)::int AS n FROM purchases WHERE business_id = $1`, [B]);
    expect(bPurchases.n).toBe(0);

    // Converting the same invoice again is refused.
    const again = await convert(UA, A, { item_map: { [INVOICE_LINE]: ITEM_A } });
    expect(again.status).toBe(400);

    // Stock is back above the reorder level, so B's alert closes.
    await checkLowStockForItem(ITEM_A, A);
    const alert = await queryOne(`SELECT alert_status FROM low_stock_alerts WHERE item_id = $1`, [ITEM_A]);
    expect(alert.alert_status).toBe('resolved');
  });
});
