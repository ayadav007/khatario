/**
 * Supplier Hub phases 0–6 on a real database (docs/SUPPLIER_HUB_BUILD_PLAN.md):
 * retailer A links wholesaler B, the link waits for B's approval, B's customer record for A is
 * linked, A picks B's items and reorder levels in bulk, A's reorder level raises an alert for B,
 * B's sales invoice becomes A's purchase (item matched, stock added once), and either side can
 * disconnect and reconnect. The item map remembers matches and converts cartons into pieces.
 * Incoming bills are received with short/damaged quantities and new items made from bill lines.
 * Orders: B proposes from A's low stock, A confirms, B bills, A receives; or A orders and B answers.
 * Collections: publishing notifies connected buyers once, mute, catalog orders with MOQ and sets.
 * Opt-in, disposable DB only:
 *   SUPPLIER_HUB_DB_TEST=1 npx jest tests/db/supplier-hub.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migrations 389–394 are applied in beforeAll.
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
import { PATCH as mapRequestItem } from '@/app/api/stock-requests/[id]/route';
import { GET as incomingGET } from '@/app/api/purchases/incoming-bills/route';
import { GET as ordersGET, POST as ordersPOST } from '@/app/api/supply-orders/route';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/supply-orders/[id]/route';
import { GET as invoiceDraftGET } from '@/app/api/supply-orders/[id]/invoice-draft/route';
import { POST as suggestPOST } from '@/app/api/supply-orders/suggest/route';
import { claimSupplyOrderForInvoice } from '@/lib/supply-orders';
import { GET as collectionsGET, POST as collectionsPOST } from '@/app/api/suppliers/hub/collections/route';
import { PATCH as collectionPATCH } from '@/app/api/suppliers/hub/collections/[id]/route';
import { GET as newArrivalsGET } from '@/app/api/suppliers/hub/new-arrivals/route';
import { POST as mutePOST } from '@/app/api/suppliers/hub/mute/route';
import { GET as incomingBillGET } from '@/app/api/purchases/incoming-bills/[invoiceId]/route';
import { POST as createItemPOST } from '@/app/api/purchases/incoming-bills/[invoiceId]/create-item/route';
import {
  GET as itemLinksGET,
  POST as itemLinksPOST,
  DELETE as itemLinksDELETE,
} from '@/app/api/suppliers/[id]/item-links/route';
import { POST as createListing } from '@/app/api/suppliers/hub/published-listings/route';
import { PATCH as patchListing } from '@/app/api/suppliers/hub/published-listings/[id]/route';
import { POST as linkedCustomer } from '@/app/api/suppliers/hub/linked-customer/route';
import { GET as linkGET, DELETE as linkDELETE } from '@/app/api/suppliers/hub/link/route';
import { POST as connectPOST } from '@/app/api/suppliers/hub/connection-requests/route';
import { PATCH as connectPATCH } from '@/app/api/suppliers/hub/connection-requests/[id]/route';
import { GET as supplierItemsGET, POST as supplierItemsPOST } from '@/app/api/suppliers/[id]/items/route';

const migration = (file: string) =>
  fs.readFileSync(path.join(__dirname, '../../database/migrations', file), 'utf8');

const run = enabled ? describe : describe.skip;

run('Supplier Hub phases 0–6 (kh_phase2_test)', () => {
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
  const call = (method: string, url: string, user: string, biz: string, body?: object) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: headers(user, biz),
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    await query(migration('389_purchase_source_invoice.sql'));
    await query(migration('390_supplier_hub_links.sql'));
    await query(migration('391_supplier_item_links.sql'));
    await query(migration('392_supplier_bill_receipts.sql'));
    await query(migration('393_supply_orders.sql'));
    await query(migration('394_supplier_collections.sql'));
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

  it("approval links B's existing customer record for A, never a new one by name (1.1)", async () => {
    const linked = await queryOne(
      `SELECT id FROM customers WHERE business_id = $1 AND linked_business_id = $2 AND deleted_at IS NULL`,
      [B, A]
    );
    expect(linked?.id).toBe(CUST_A_AT_B);
    const count = await queryOne(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1`, [B]);
    expect(count.n).toBe(1);

    const res = await linkedCustomer(post('/api/suppliers/hub/linked-customer', UB, B, { buyer_business_id: A }));
    expect(res.status).toBe(200);
    expect((await res.json()).customer_id).toBe(CUST_A_AT_B);

    // C has no link from A, so it cannot fetch or create a customer record for A.
    const stranger = await linkedCustomer(post('/api/suppliers/hub/linked-customer', UC, C, { buyer_business_id: A }));
    expect(stranger.status).toBe(403);

    // Both sides see the link as live.
    const asA = await (await linkGET(call('GET', `/api/suppliers/hub/link?supplier_id=${supplierRowId}`, UA, A))).json();
    expect(asA).toMatchObject({ side: 'buyer', status: 'approved', stock_shared: true, other_business_id: B });
    const asB = await (await linkGET(call('GET', `/api/suppliers/hub/link?customer_id=${CUST_A_AT_B}`, UB, B))).json();
    expect(asB).toMatchObject({ side: 'vendor', status: 'approved', other_business_id: A });
  });

  it('A picks the items B supplies and their reorder levels in bulk (1.4)', async () => {
    const SECOND = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, min_stock, current_stock, is_active)
       VALUES ($1, $2, 'Marie Gold 120g', 'PCS', 'goods', 0, 2, true)`,
      [SECOND, A]
    );
    const url = `/api/suppliers/${supplierRowId}/items`;
    const ctx = { params: { id: supplierRowId } };

    // B's item cannot be assigned from A's books.
    expect((await supplierItemsPOST(post(url, UA, A, { assign: [ITEM_B] }), ctx)).status).toBe(400);
    // B cannot use A's supplier row.
    expect((await supplierItemsPOST(post(url, UB, B, { assign: [SECOND] }), ctx)).status).toBe(404);
    // A negative reorder level is refused.
    expect((await supplierItemsPOST(post(url, UA, A, { min_stock: { [SECOND]: -1 } }), ctx)).status).toBe(400);

    const ok = await supplierItemsPOST(post(url, UA, A, { assign: [SECOND], min_stock: { [SECOND]: 6 } }), ctx);
    expect(ok.status).toBe(200);
    const item = await queryOne(`SELECT default_supplier_id, min_stock FROM items WHERE id = $1`, [SECOND]);
    expect(item.default_supplier_id).toBe(supplierRowId);
    expect(Number(item.min_stock)).toBe(6);
    // Saving raised B's alert straight away (2 in stock, reorder at 6).
    const alert = await queryOne(
      `SELECT alert_status FROM low_stock_alerts WHERE item_id = $1 AND supplier_business_id = $2`,
      [SECOND, B]
    );
    expect(alert?.alert_status).toBe('active');

    const list = await (await supplierItemsGET(call('GET', `${url}?filter=assigned`, UA, A), ctx)).json();
    expect(list.items.map((r: any) => r.id).sort()).toEqual([ITEM_A, SECOND].sort());

    // Unassigning clears the default and closes the alert.
    expect((await supplierItemsPOST(post(url, UA, A, { unassign: [SECOND] }), ctx)).status).toBe(200);
    const after = await queryOne(`SELECT default_supplier_id FROM items WHERE id = $1`, [SECOND]);
    expect(after.default_supplier_id).toBeNull();
    const closed = await queryOne(
      `SELECT alert_status FROM low_stock_alerts WHERE item_id = $1 AND supplier_business_id = $2`,
      [SECOND, B]
    );
    expect(closed.alert_status).toBe('resolved');
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
    expect(unmatchedBody.unmatched).toHaveLength(1);
    expect(unmatchedBody.unmatched[0]).toMatchObject({ invoice_item_id: INVOICE_LINE, item_name: 'PARLE G 50GM CTN' });
    // The likely match is suggested even though the names differ.
    expect(unmatchedBody.unmatched[0].suggestions[0]?.id).toBe(ITEM_A);

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

  it('the item map remembers matches and converts cartons into pieces (Phase 2)', async () => {
    const url = `/api/suppliers/${supplierRowId}/item-links`;
    const ctx = { params: { id: supplierRowId } };

    // The first conversion saved A's hand-picked match.
    const first = await (await itemLinksGET(call('GET', url, UA, A), ctx)).json();
    expect(first.links).toHaveLength(1);
    expect(first.links[0]).toMatchObject({ vendor_item_id: ITEM_B, buyer_item_id: ITEM_A, source: 'manual' });
    expect(Number(first.links[0].factor)).toBe(1);

    // A learned match from a request never replaces a hand-set one.
    const pending = await queryOne(
      `SELECT id FROM quantity_requests WHERE requester_business_id = $1 AND status = 'pending' LIMIT 1`,
      [A]
    );
    const OTHER_B = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active) VALUES ($1, $2, 'Parle G loose', 'PCS', 'goods', true)`,
      [OTHER_B, B]
    );
    const mapRes = await mapRequestItem(
      call('PATCH', `/api/stock-requests/${pending.id}`, UB, B, { responder_item_id: ITEM_B }),
      { params: { id: pending.id } }
    );
    expect(mapRes.status).toBe(200);
    const kept = await queryOne(
      `SELECT source, buyer_item_id FROM supplier_item_links WHERE vendor_item_id = $1 AND buyer_business_id = $2`,
      [ITEM_B, A]
    );
    expect(kept).toMatchObject({ source: 'manual', buyer_item_id: ITEM_A });
    // A new supplier item picked on a request is learned.
    await mapRequestItem(call('PATCH', `/api/stock-requests/${pending.id}`, UB, B, { responder_item_id: OTHER_B }), {
      params: { id: pending.id },
    });
    const learned = await queryOne(
      `SELECT source, buyer_item_id FROM supplier_item_links WHERE vendor_item_id = $1 AND buyer_business_id = $2`,
      [OTHER_B, A]
    );
    expect(learned).toMatchObject({ source: 'request', buyer_item_id: ITEM_A });

    // B sells in cartons of 144; A stocks single packs.
    expect((await itemLinksPOST(post(url, UA, A, { vendor_item_id: ITEM_B, buyer_item_id: ITEM_A, factor: 0 }), ctx)).status).toBe(400);
    expect((await itemLinksPOST(post(url, UA, A, { vendor_item_id: ITEM_A, buyer_item_id: ITEM_A }), ctx)).status).toBe(400);
    expect((await itemLinksPOST(post(url, UB, B, { vendor_item_id: ITEM_B, buyer_item_id: ITEM_A }), ctx)).status).toBe(404);
    const setFactor = await itemLinksPOST(post(url, UA, A, { vendor_item_id: ITEM_B, buyer_item_id: ITEM_A, factor: 144 }), ctx);
    expect(setFactor.status).toBe(200);

    // A second bill for 2 cartons at ₹1,440 each converts with no matching step.
    const INVOICE_2 = randomUUID();
    await query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '29', 2880, 0, 0, 0, 0, 2880, 0, 2880, 'unpaid', $5)`,
      [INVOICE_2, B, CUST_A_AT_B, `HUB2-${tag}`, BRB]
    );
    await query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, quantity, unit, unit_price, taxable_value, line_total, sort_order)
       VALUES ($1, $2, 'PARLE G 50GM CTN', 2, 'CTN', 1440, 2880, 2880, 0)`,
      [INVOICE_2, ITEM_B]
    );
    const before = Number((await queryOne(`SELECT current_stock FROM items WHERE id = $1`, [ITEM_A])).current_stock);
    const conv = await convertInvoice(post(`/api/invoices/${INVOICE_2}/convert-to-purchase`, UA, A, {}), {
      params: { id: INVOICE_2 },
    });
    expect(conv.status).toBe(201);
    const { purchase } = await conv.json();
    const line = await queryOne(
      `SELECT item_id, quantity, unit, unit_price, line_total FROM purchase_items WHERE purchase_id = $1`,
      [purchase.id]
    );
    expect(line.item_id).toBe(ITEM_A);
    expect(Number(line.quantity)).toBe(288);
    expect(line.unit).toBe('PCS');
    expect(Number(line.unit_price)).toBe(10);
    expect(Number(line.line_total)).toBe(2880);
    const after = Number((await queryOne(`SELECT current_stock FROM items WHERE id = $1`, [ITEM_A])).current_stock);
    expect(after - before).toBe(288);
    const used = await queryOne(
      `SELECT last_rate, buyer_units_per_vendor_unit FROM supplier_item_links WHERE vendor_item_id = $1 AND buyer_business_id = $2`,
      [ITEM_B, A]
    );
    expect(Number(used.last_rate)).toBe(1440);
    expect(Number(used.buyer_units_per_vendor_unit)).toBe(144);

    // New requests for A's item pre-fill B's item from the map.
    const newReq = await createStockRequest(
      post('/api/stock-requests', UA, A, {
        requests: [{ requester_business_id: A, responder_business_id: B, item_id: ITEM_A, requested_qty: 1 }],
      })
    );
    // Only one pending request per item and supplier; close the old one first if needed.
    if (newReq.status === 409) {
      await query(`UPDATE quantity_requests SET status = 'declined' WHERE id = $1`, [pending.id]);
      const retry = await createStockRequest(
        post('/api/stock-requests', UA, A, {
          requests: [{ requester_business_id: A, responder_business_id: B, item_id: ITEM_A, requested_qty: 1 }],
        })
      );
      expect(retry.status).toBe(200);
      expect((await retry.json()).created[0].responder_item_id).toBe(ITEM_B);
    } else {
      expect(newReq.status).toBe(200);
      expect((await newReq.json()).created[0].responder_item_id).toBe(ITEM_B);
    }

    // B cannot read A's item map; A can remove a match.
    expect((await itemLinksGET(call('GET', url, UB, B), ctx)).status).toBe(404);
    const learnedRow = await queryOne(`SELECT id FROM supplier_item_links WHERE vendor_item_id = $1`, [OTHER_B]);
    const del = await itemLinksDELETE(call('DELETE', `${url}?link_id=${learnedRow.id}`, UA, A), ctx);
    expect(del.status).toBe(200);
  });

  it('incoming bills: receive with short/damaged, create a new item from a line (Phase 5)', async () => {
    // A bill from before the link was approved is not listed (A may have typed it in already).
    const OLD_BILL = randomUUID();
    await query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, DATE '2020-01-01', 'final', 'tax_invoice', '29', 100, 0, 0, 0, 0, 100, 0, 100, 'unpaid', $5)`,
      [OLD_BILL, B, CUST_A_AT_B, `OLD-${tag}`, BRB]
    );

    // A new bill: one known carton line and one new design A has never stocked.
    const BILL = randomUUID();
    const NEW_DESIGN = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, hsn_sac)
       VALUES ($1, $2, 'Kurti Floral Blue M', 'PCS', 'goods', true, '6204')`,
      [NEW_DESIGN, B]
    );
    await query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '29', 5940, 0, 0, 0, 0, 5940, 0, 5940, 'unpaid', $5)`,
      [BILL, B, CUST_A_AT_B, `HUB3-${tag}`, BRB]
    );
    const [LINE_CTN, LINE_NEW] = [randomUUID(), randomUUID()];
    await query(
      `INSERT INTO invoice_items (id, invoice_id, item_id, item_name, hsn_sac, quantity, unit, unit_price, taxable_value, line_total, sort_order)
       VALUES ($1, $3, $4, 'PARLE G 50GM CTN', NULL, 1, 'CTN', 1440, 1440, 1440, 0),
              ($2, $3, $5, 'Kurti Floral Blue M', '6204', 10, 'PCS', 450, 4500, 4500, 1)`,
      [LINE_CTN, LINE_NEW, BILL, ITEM_B, NEW_DESIGN]
    );

    const inbox = await (await incomingGET(call('GET', '/api/purchases/incoming-bills?status=pending', UA, A))).json();
    const ids = inbox.bills.map((b: any) => b.invoice_id);
    expect(ids).toContain(BILL);
    expect(ids).not.toContain(OLD_BILL);
    expect(ids).not.toContain(INVOICE); // already received
    const all = await (await incomingGET(call('GET', '/api/purchases/incoming-bills?status=received', UA, A))).json();
    expect(all.bills.map((b: any) => b.invoice_id)).toEqual(expect.arrayContaining([INVOICE]));
    // Another business sees none of A's bills.
    const cInbox = await (await incomingGET(call('GET', '/api/purchases/incoming-bills?status=all', UC, C))).json();
    expect(cInbox.bills).toHaveLength(0);

    const ctx = { params: { invoiceId: BILL } };
    expect((await incomingBillGET(call('GET', `/api/purchases/incoming-bills/${BILL}`, UC, C), ctx)).status).toBe(403);
    const detail = await (await incomingBillGET(call('GET', `/api/purchases/incoming-bills/${BILL}`, UA, A), ctx)).json();
    const ctn = detail.lines.find((l: any) => l.invoice_item_id === LINE_CTN);
    expect(ctn.match).toMatchObject({ item_id: ITEM_A, factor: 144, quantity: 144, rate: 10 });
    const fresh = detail.lines.find((l: any) => l.invoice_item_id === LINE_NEW);
    expect(fresh.match).toBeNull();
    expect(detail.purchase).toBeNull();

    // A creates its own item from the new line.
    const createUrl = `/api/purchases/incoming-bills/${BILL}/create-item`;
    expect((await createItemPOST(post(createUrl, UC, C, { invoice_item_id: LINE_NEW }), ctx)).status).toBe(403);
    expect((await createItemPOST(post(createUrl, UA, A, { invoice_item_id: LINE_NEW, factor: 0 }), ctx)).status).toBe(400);
    const made = await createItemPOST(post(createUrl, UA, A, { invoice_item_id: LINE_NEW, selling_price: 799 }), ctx);
    expect(made.status).toBe(201);
    const { item: newItem } = await made.json();
    const row = await queryOne(
      `SELECT business_id, name, unit, hsn_sac, purchase_price, selling_price, default_supplier_id FROM items WHERE id = $1`,
      [newItem.id]
    );
    expect(row).toMatchObject({ business_id: A, name: 'Kurti Floral Blue M', unit: 'PCS', hsn_sac: '6204', default_supplier_id: supplierRowId });
    expect(Number(row.purchase_price)).toBe(450);
    expect(Number(row.selling_price)).toBe(799);

    // More short than billed is refused.
    const convertUrl = `/api/invoices/${BILL}/convert-to-purchase`;
    const over = await convertInvoice(post(convertUrl, UA, A, { received: { [LINE_CTN]: { short_qty: 200 } } }), {
      params: { id: BILL },
    });
    expect(over.status).toBe(400);
    expect((await over.json()).code).toBe('RECEIPT_QTY_INVALID');

    // Receive: 4 packs short from the carton, 1 kurti damaged.
    const res = await convertInvoice(
      post(convertUrl, UA, A, {
        received: { [LINE_CTN]: { short_qty: 4 }, [LINE_NEW]: { damaged_qty: 1, note: 'torn' } },
        receipt_notes: 'Box 2 was wet',
      }),
      { params: { id: BILL } }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.receipt.status).toBe('received_with_issues');
    expect(body.shortfalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item_id: ITEM_A, short_qty: 4, damaged_qty: 0 }),
        expect.objectContaining({ item_id: newItem.id, short_qty: 0, damaged_qty: 1 }),
      ])
    );
    // The purchase matches the bill in full; the shortfall waits for the debit note.
    const lines = await query(`SELECT item_id, quantity FROM purchase_items WHERE purchase_id = $1`, [body.purchase.id]);
    const qtyOf = (id: string) => Number(lines.rows.find((r: any) => r.item_id === id)?.quantity);
    expect(qtyOf(ITEM_A)).toBe(144);
    expect(qtyOf(newItem.id)).toBe(10);

    const note = await queryOne(
      `SELECT message FROM notifications WHERE business_id = $1 AND reference_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [B, BILL]
    );
    expect(note.message).toContain('4 short');
    expect(note.message).toContain('1 damaged');

    const after = await (await incomingBillGET(call('GET', `/api/purchases/incoming-bills/${BILL}`, UA, A), ctx)).json();
    expect(after.purchase).toMatchObject({ id: body.purchase.id, receipt_status: 'received_with_issues' });
    expect(after.receipt_lines).toHaveLength(2);
    const pendingNow = await (await incomingGET(call('GET', '/api/purchases/incoming-bills?status=pending', UA, A))).json();
    expect(pendingNow.bills.map((b: any) => b.invoice_id)).not.toContain(BILL);
  });

  it('orders: B proposes from low stock, A confirms, B bills, A receives (Phases 3–4)', async () => {
    // A low item matched to B's carton of 12.
    const LOW_A = randomUUID();
    const VEND_LOW = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, min_stock, current_stock, is_active, default_supplier_id)
       VALUES ($1, $2, 'Good Day 75g', 'PCS', 'goods', 20, 5, true, $3)`,
      [LOW_A, A, supplierRowId]
    );
    await query(`INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 5)`, [A, BRA, LOW_A]);
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, selling_price, tax_rate)
       VALUES ($1, $2, 'GOOD DAY 75G BOX12', 'BOX', 'goods', true, 240, 0)`,
      [VEND_LOW, B]
    );
    const linkUrl = `/api/suppliers/${supplierRowId}/item-links`;
    expect(
      (await itemLinksPOST(post(linkUrl, UA, A, { vendor_item_id: VEND_LOW, buyer_item_id: LOW_A, factor: 12 }), { params: { id: supplierRowId } })).status
    ).toBe(200);

    // B builds suggestions: one draft for A with the low item, in boxes (35 packs -> 3 boxes).
    const sug = await (await suggestPOST(call('POST', '/api/supply-orders/suggest', UB, B))).json();
    expect(sug.lines).toBeGreaterThanOrEqual(1);
    const draft = await queryOne(
      `SELECT o.id, l.id AS line_id, l.qty, l.vendor_item_id, l.buyer_units_per_vendor_unit AS factor
         FROM supply_orders o JOIN supply_order_lines l ON l.order_id = o.id
        WHERE o.buyer_business_id = $1 AND o.vendor_business_id = $2 AND o.status = 'draft' AND l.buyer_item_id = $3`,
      [A, B, LOW_A]
    );
    expect(draft).toMatchObject({ vendor_item_id: VEND_LOW });
    expect(Number(draft.qty)).toBe(3);
    expect(Number(draft.factor)).toBe(12);
    // Running again adds nothing for items already on an open order.
    const again = await (await suggestPOST(call('POST', '/api/supply-orders/suggest', UB, B))).json();
    expect(again.lines).toBe(0);

    const orderUrl = `/api/supply-orders/${draft.id}`;
    const octx = { params: { id: draft.id } };
    // A cannot see B's draft yet; C never can.
    expect((await orderGET(call('GET', orderUrl, UA, A), octx)).status).toBe(404);
    expect((await orderGET(call('GET', orderUrl, UC, C), octx)).status).toBe(404);
    // A cannot confirm before B sends it.
    expect((await orderPATCH(call('PATCH', orderUrl, UA, A, { action: 'confirm' }), octx)).status).toBe(404);

    // B sends it with 4 boxes; A confirms 5.
    const sent = await orderPATCH(call('PATCH', orderUrl, UB, B, { action: 'send', lines: [{ id: draft.line_id, qty: 4 }] }), octx);
    expect((await sent.json()).status).toBe('proposed');
    const asA = await (await ordersGET(call('GET', '/api/supply-orders?role=buyer&group=action', UA, A))).json();
    expect(asA.orders.map((o: any) => o.id)).toContain(draft.id);
    expect((await orderPATCH(call('PATCH', orderUrl, UB, B, { action: 'confirm' }), octx)).status).toBe(409);
    const confirmed = await orderPATCH(call('PATCH', orderUrl, UA, A, { action: 'confirm', lines: [{ id: draft.line_id, qty: 5 }] }), octx);
    expect((await confirmed.json()).status).toBe('confirmed');
    const detailA = await (await orderGET(call('GET', orderUrl, UA, A), octx)).json();
    expect(detailA.lines[0]).toMatchObject({ qty: 5, confirmed_qty: 5, buyer_qty: 60, vendor_item_id: null });

    // B gets the bill draft: A's linked customer record and its own item.
    const draftBill = await (await invoiceDraftGET(call('GET', `${orderUrl}/invoice-draft`, UB, B), octx)).json();
    expect(draftBill.customer_id).toBe(CUST_A_AT_B);
    expect(draftBill.lines).toEqual([expect.objectContaining({ item_id: VEND_LOW, quantity: 5, selling_price: 240 })]);
    expect((await invoiceDraftGET(call('GET', `${orderUrl}/invoice-draft`, UA, A), octx)).status).toBe(404);

    // B raises the bill (as the invoice API does) and it links to the order.
    const ORDER_BILL = randomUUID();
    await query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '29', 1200, 0, 0, 0, 0, 1200, 0, 1200, 'unpaid', $5)`,
      [ORDER_BILL, B, CUST_A_AT_B, `ORD-${tag}`, BRB]
    );
    await query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, quantity, unit, unit_price, taxable_value, line_total, sort_order)
       VALUES ($1, $2, 'GOOD DAY 75G BOX12', 5, 'BOX', 240, 1200, 1200, 0)`,
      [ORDER_BILL, VEND_LOW]
    );
    const { getPool } = await import('@/lib/db');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await expect(
        claimSupplyOrderForInvoice(client, B, draft.id, { id: ORDER_BILL, customer_id: null })
      ).rejects.toThrow('Bill the order to the buyer');
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await claimSupplyOrderForInvoice(client, B, draft.id, { id: ORDER_BILL, customer_id: CUST_A_AT_B, invoice_number: `ORD-${tag}` });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect((await queryOne(`SELECT status, invoice_id FROM supply_orders WHERE id = $1`, [draft.id]))).toMatchObject({
      status: 'invoiced',
      invoice_id: ORDER_BILL,
    });

    // A receives it: 5 boxes become 60 packs, and the order is marked received.
    const before = Number((await queryOne(`SELECT current_stock FROM items WHERE id = $1`, [LOW_A])).current_stock);
    const rec = await convertInvoice(post(`/api/invoices/${ORDER_BILL}/convert-to-purchase`, UA, A, {}), { params: { id: ORDER_BILL } });
    expect(rec.status).toBe(201);
    const { purchase } = await rec.json();
    const after = Number((await queryOne(`SELECT current_stock FROM items WHERE id = $1`, [LOW_A])).current_stock);
    expect(after - before).toBe(60);
    expect(await queryOne(`SELECT status, purchase_id FROM supply_orders WHERE id = $1`, [draft.id])).toMatchObject({
      status: 'received',
      purchase_id: purchase.id,
    });
  });

  it('orders: A orders, B confirms part, A cancels; catalog-only rule (Phases 3–4)', async () => {
    const res = await ordersPOST(
      post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, lines: [{ buyer_item_id: ITEM_A, buyer_qty: 300 }] })
    );
    expect(res.status).toBe(201);
    const { order } = await res.json();
    expect(order.status).toBe('pending');
    const line = await queryOne(`SELECT id, qty, vendor_item_id FROM supply_order_lines WHERE order_id = $1`, [order.id]);
    expect(line.vendor_item_id).toBe(ITEM_B);
    expect(Number(line.qty)).toBe(3); // 300 packs -> 3 cartons of 144

    const octx = { params: { id: order.id } };
    const url = `/api/supply-orders/${order.id}`;
    // Only B answers a pending order, and not more than asked.
    expect((await orderPATCH(call('PATCH', url, UA, A, { action: 'respond' }), octx)).status).toBe(409);
    expect((await orderPATCH(call('PATCH', url, UB, B, { action: 'respond', lines: [{ id: line.id, confirmed_qty: 9 }] }), octx)).status).toBe(400);
    const partial = await orderPATCH(call('PATCH', url, UB, B, { action: 'respond', lines: [{ id: line.id, confirmed_qty: 2 }] }), octx);
    expect((await partial.json()).status).toBe('partial');
    const cancelled = await orderPATCH(call('PATCH', url, UA, A, { action: 'cancel' }), octx);
    expect((await cancelled.json()).status).toBe('cancelled');
    expect((await orderPATCH(call('PATCH', url, UA, A, { action: 'cancel' }), octx)).status).toBe(409);

    // Ordering a supplier item directly needs it to be in their published catalog.
    const UNLISTED = randomUUID();
    await query(`INSERT INTO items (id, business_id, name, unit, item_type, is_active) VALUES ($1, $2, 'Secret item', 'PCS', 'goods', true)`, [UNLISTED, B]);
    const direct = await ordersPOST(
      post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, from_catalog: true, lines: [{ vendor_item_id: UNLISTED, qty: 1 }] })
    );
    expect(direct.status).toBe(400);
    // C is not connected to B.
    const cSupplier = randomUUID();
    await query(`INSERT INTO suppliers (id, business_id, name, linked_business_id, approval_status) VALUES ($1, $2, 'B', $3, 'pending')`, [cSupplier, C, B]);
    const cOrder = await ordersPOST(post('/api/supply-orders', UC, C, { supplier_id: cSupplier, lines: [{ vendor_item_id: ITEM_B, qty: 1 }] }));
    expect(cOrder.status).toBe(403);
  });

  it('collections: publish notifies buyers once, mute, catalog order with MOQ and sets (Phase 6)', async () => {
    const created = await collectionsPOST(post('/api/suppliers/hub/collections', UB, B, { name: 'Summer kurtis', season: 'Summer 2027' }));
    expect(created.status).toBe(201);
    const { collection } = await created.json();
    const cctx = { params: { id: collection.id } };
    const curl = `/api/suppliers/hub/collections/${collection.id}`;

    // Nothing to publish yet.
    expect((await collectionPATCH(call('PATCH', curl, UB, B, { action: 'publish' }), cctx)).status).toBe(400);
    // Another business cannot touch it.
    expect((await collectionPATCH(call('PATCH', curl, UC, C, { action: 'publish' }), cctx)).status).toBe(404);

    const KURTI = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active) VALUES ($1, $2, 'Kurti Leaf Green', 'PCS', 'goods', true)`,
      [KURTI, B]
    );
    const listingBody = {
      item_id: KURTI,
      audience: 'linked_only',
      collection_id: collection.id,
      price: 450,
      moq: 4,
      order_multiple: 4,
      pack_label: 'Set of 4: S, M, L, XL',
      image_url: 'https://img.example.test/kurti.jpg',
    };
    expect((await createListing(post('/api/suppliers/hub/published-listings', UB, B, { ...listingBody, image_url: 'javascript:alert(1)' }))).status).toBe(400);
    const cCol = await (await collectionsPOST(post('/api/suppliers/hub/collections', UC, C, { name: 'Not yours' }))).json();
    expect(
      (await createListing(post('/api/suppliers/hub/published-listings', UB, B, { ...listingBody, collection_id: cCol.collection.id }))).status
    ).toBe(404);
    const listed = await createListing(post('/api/suppliers/hub/published-listings', UB, B, listingBody));
    expect(listed.status).toBe(201);

    // Publishing notifies A (the one connected buyer), once.
    const pub = await (await collectionPATCH(call('PATCH', curl, UB, B, { action: 'publish' }), cctx)).json();
    expect(pub.notified).toBe(1);
    const note = await queryOne(
      `SELECT title FROM notifications WHERE business_id = $1 AND reference_id = $2`,
      [A, collection.id]
    );
    expect(note.title).toContain('Summer kurtis');
    await collectionPATCH(call('PATCH', curl, UB, B, { action: 'archive' }), cctx);
    const again = await (await collectionPATCH(call('PATCH', curl, UB, B, { action: 'publish' }), cctx)).json();
    expect(again.notified).toBe(0);

    // A's feed shows it with A's price, MOQ and set; C (not connected) sees nothing.
    const feed = await (await newArrivalsGET(call('GET', '/api/suppliers/hub/new-arrivals', UA, A))).json();
    const col = feed.collections.find((c: any) => c.id === collection.id);
    expect(col).toMatchObject({ supplier_id: supplierRowId, supplier_name: expect.any(String) });
    expect(col.items[0]).toMatchObject({ vendor_item_id: KURTI, pack_label: 'Set of 4: S, M, L, XL' });
    expect(Number(col.items[0].price)).toBe(450);
    const cFeed = await (await newArrivalsGET(call('GET', '/api/suppliers/hub/new-arrivals', UC, C))).json();
    expect(cFeed.collections).toHaveLength(0);

    // Muted buyers are not notified of the next launch.
    expect((await mutePOST(post('/api/suppliers/hub/mute', UA, A, { supplier_id: supplierRowId, muted: true }))).status).toBe(200);
    const second = await (await collectionsPOST(post('/api/suppliers/hub/collections', UB, B, { name: 'Festive' }))).json();
    const FESTIVE = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active) VALUES ($1, $2, 'Festive Saree', 'PCS', 'goods', true)`,
      [FESTIVE, B]
    );
    const festiveListing = await createListing(
      post('/api/suppliers/hub/published-listings', UB, B, { ...listingBody, item_id: FESTIVE, collection_id: second.collection.id })
    );
    expect(festiveListing.status).toBe(201);
    const pub2 = await (
      await collectionPATCH(call('PATCH', `/api/suppliers/hub/collections/${second.collection.id}`, UB, B, { action: 'publish' }), {
        params: { id: second.collection.id },
      })
    ).json();
    expect(pub2.notified).toBe(0);
    await mutePOST(post('/api/suppliers/hub/mute', UA, A, { supplier_id: supplierRowId, muted: false }));

    // Ordering from the catalog respects MOQ and sets.
    const order = (qty: number) =>
      ordersPOST(post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, from_catalog: true, lines: [{ vendor_item_id: KURTI, qty }] }));
    expect((await order(3)).status).toBe(400);
    expect((await order(6)).status).toBe(400);
    const ok = await order(8);
    expect(ok.status).toBe(201);
    const { order: catalogOrder } = await ok.json();
    expect(await queryOne(`SELECT origin, status FROM supply_orders WHERE id = $1`, [catalogOrder.id])).toMatchObject({
      origin: 'catalog',
      status: 'pending',
    });

    // B sees who ordered from the collection.
    const mine = await (await collectionsGET(call('GET', '/api/suppliers/hub/collections', UB, B))).json();
    const stats = mine.collections.find((c: any) => c.id === collection.id);
    expect(stats).toMatchObject({ item_count: 1, buyers_ordered: 1 });
    expect(Number(stats.units_ordered)).toBe(8);
  });

  it('either side can disconnect, and a reconnect needs B to accept again (1.3)', async () => {
    // A third party cannot end it.
    const stranger = await linkDELETE(call('DELETE', `/api/suppliers/hub/link?supplier_id=${supplierRowId}`, UC, C));
    expect(stranger.status).toBe(404);

    // A pending request between them is closed by the disconnect.
    await query(
      `INSERT INTO quantity_requests (requester_business_id, responder_business_id, item_id, requested_qty, status)
       VALUES ($1, $2, $3, 5, 'pending')`,
      [A, B, ITEM_A]
    );

    // An open order between them is cancelled by the disconnect.
    const open = await ordersPOST(
      post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, lines: [{ buyer_item_id: ITEM_A, buyer_qty: 10 }] })
    );
    const { order: openOrder } = await open.json();

    // B disconnects from its customer record.
    const res = await linkDELETE(call('DELETE', `/api/suppliers/hub/link?customer_id=${CUST_A_AT_B}`, UB, B));
    expect(res.status).toBe(200);
    const row = await queryOne(
      `SELECT approval_status, allow_low_stock_access, disconnected_by_business_id FROM suppliers WHERE id = $1`,
      [supplierRowId]
    );
    expect(row).toMatchObject({
      approval_status: 'disconnected',
      allow_low_stock_access: false,
      disconnected_by_business_id: B,
    });
    const note = await queryOne(
      `SELECT 1 AS ok FROM notifications WHERE business_id = $1 AND title = 'Supplier link ended'`,
      [A]
    );
    expect(note?.ok).toBe(1);
    const pending = await queryOne(
      `SELECT COUNT(*)::int AS n FROM quantity_requests WHERE requester_business_id = $1 AND status = 'pending'`,
      [A]
    );
    expect(pending.n).toBe(0);

    expect((await queryOne(`SELECT status FROM supply_orders WHERE id = $1`, [openOrder.id])).status).toBe('cancelled');

    // Hub access has stopped.
    const reqRes = await createStockRequest(
      post('/api/stock-requests', UA, A, {
        requests: [{ requester_business_id: A, responder_business_id: B, item_id: ITEM_A, requested_qty: 5 }],
      })
    );
    expect(reqRes.status).toBe(400);

    // Disconnecting again has nothing to end.
    const again = await linkDELETE(call('DELETE', `/api/suppliers/hub/link?supplier_id=${supplierRowId}`, UA, A));
    expect(again.status).toBe(409);

    // A asks to reconnect; the link stays down until B accepts.
    await query(
      `INSERT INTO business_discovery (business_id, visibility) VALUES ($1, 'directory')
       ON CONFLICT (business_id) DO UPDATE SET visibility = 'directory'`,
      [B]
    );
    const ask = await connectPOST(post('/api/suppliers/hub/connection-requests', UA, A, { supplier_business_id: B }));
    expect(ask.status).toBe(201);
    const { request: connReq } = await ask.json();
    const still = await queryOne(`SELECT approval_status FROM suppliers WHERE id = $1`, [supplierRowId]);
    expect(still.approval_status).toBe('disconnected');

    // A cannot accept its own request, even claiming to be B in the body.
    const selfAccept = await connectPATCH(
      call('PATCH', `/api/suppliers/hub/connection-requests/${connReq.id}`, UA, A, {
        action: 'accept',
        business_id: B,
        updated_by_user_id: UB,
      }),
      { params: { id: connReq.id } }
    );
    expect(selfAccept.status).toBe(403);

    const accept = await connectPATCH(
      call('PATCH', `/api/suppliers/hub/connection-requests/${connReq.id}`, UB, B, { action: 'accept' }),
      { params: { id: connReq.id } }
    );
    expect(accept.status).toBe(200);
    const back = await queryOne(`SELECT approval_status, disconnected_at FROM suppliers WHERE id = $1`, [supplierRowId]);
    expect(back).toMatchObject({ approval_status: 'approved', disconnected_at: null });
    const customers = await queryOne(
      `SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1 AND linked_business_id = $2`,
      [B, A]
    );
    expect(customers.n).toBe(1);
  });
});
