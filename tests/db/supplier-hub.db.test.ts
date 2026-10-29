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
 * to kh_phase2_test; migrations 389–394 and 421–431 are applied in beforeAll.
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
// WhatsApp and the GST registry are outside services; record what would be sent or asked.
jest.mock('@/lib/platform-whatsapp-send', () => ({
  lookupTenantWhatsAppPhone: jest.fn().mockResolvedValue('9876543210'),
  sendPlatformEventWhatsApp: jest.fn().mockResolvedValue({ sent: true, skipped: null }),
}));
jest.mock('@/lib/gstin-registry', () => ({
  fetchGstinRegistry: jest.fn().mockResolvedValue({
    source: 'test',
    record: {
      gstin: '27AAPFU0939F1ZV',
      lgnm: 'HUB STRANGER TRADING LLP',
      sts: 'Active',
      pradr: { addr: { dst: 'Pune', pncd: '411001' } },
    },
  }),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { NextRequest } from 'next/server';
import { closePool, query, queryOne } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { checkLowStockForItem, queueLowStockCheck } from '@/lib/low-stock-checker';
import { PATCH as discoveryPATCH } from '@/app/api/suppliers/hub/discovery/route';
import { GET as directoryGET } from '@/app/api/suppliers/hub/directory/route';
import { GET as commentsGET, POST as commentsPOST } from '@/app/api/supply-orders/[id]/comments/route';
import { POST as inviteOrdersPOST, GET as inviteOrdersGET } from '@/app/api/suppliers/hub/invite-orders/route';
import { POST as inviteClaimPOST } from '@/app/api/suppliers/hub/invite-orders/claim/route';
import { GET as buyerPricesGET, PUT as buyerPricesPUT } from '@/app/api/suppliers/hub/buyer-prices/route';
import { GET as moneyGET, POST as moneyPOST } from '@/app/api/suppliers/hub/money-notices/route';
import { noticeBuyerDebitNote, noticeBuyerPayment, upiPayLink } from '@/lib/supplier-hub-money';
import { POST as standingPOST } from '@/app/api/supply-orders/standing/route';
import { PATCH as standingPATCH } from '@/app/api/supply-orders/standing/[id]/route';
import { runDueStandingOrders } from '@/lib/supply-standing-orders';
import { GET as orderListGET, POST as orderListPOST } from '@/app/api/purchases/order-list/route';
import { POST as orderListAssign } from '@/app/api/purchases/order-list/assign/route';
import { POST as orderListSend } from '@/app/api/purchases/order-list/send/route';
import { buildSuggestedOrders, suggestedBuyerQty } from '@/lib/supply-orders';
import { GET as publicOrderGET, POST as publicOrderPOST } from '@/app/api/public/supplier-order/[token]/route';
import { flushHubWhatsApp } from '@/lib/supplier-hub-whatsapp';
import { refreshGstVerification, trustForBusinesses } from '@/lib/supplier-trust';
import { sendPlatformEventWhatsApp } from '@/lib/platform-whatsapp-send';
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
import { claimSupplyOrderForInvoice, markSupplyOrderReceived } from '@/lib/supply-orders';
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
import { GET as connectGET, PATCH as connectPATCH } from '@/app/api/suppliers/hub/connection-requests/[id]/route';
import { GET as supplierItemsGET, POST as supplierItemsPOST } from '@/app/api/suppliers/[id]/items/route';
import { GET as hubHomeGET } from '@/app/api/suppliers/hub/home/route';
import { GET as areaReportGET } from '@/app/api/suppliers/dashboard/analytics/route';

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
    'x-authenticated-session-version': '1',
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
    await query(migration('421_connection_request_share_low_stock.sql'));
    await query(migration('423_supply_order_backorder_dispatch.sql'));
    await query(migration('424_supplier_hub_whatsapp_trust.sql'));
    await query(migration('425_supply_order_comments_first_order.sql'));
    await query(migration('426_supplier_invite_orders.sql'));
    await query(migration('427_catalogue_options_buyer_prices.sql'));
    await query(migration('428_supplier_hub_money_notices.sql'));
    await query(migration('429_hub_backup_standing_variants.sql'));
    await query(migration('430_hub_listing_review_retire_requests.sql'));
    await query(migration('431_order_list.sql'));
    await query(migration('433_party_item_price_variants.sql'));
    await query(migration('434_price_levels_and_party_pricing.sql'));
    await query(migration('435_item_schemes.sql'));
    await query(migration('442_supply_order_line_pricing.sql'));
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
      // Orders go before the businesses, or their lines lose both items mid-cascade.
      await query(`DELETE FROM supply_orders WHERE buyer_business_id = ANY($1::uuid[])`, [[A, B, C]]);
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

    // The link is a Supplier Hub request, so B sees it in "Needs you"; A's share choice travels with it.
    const hubReq = await queryOne(
      `SELECT id, share_low_stock FROM supplier_connection_requests
        WHERE buyer_business_id = $1 AND supplier_business_id = $2 AND status = 'pending'`,
      [A, B]
    );
    expect(hubReq?.share_low_stock).toBe(true);
    const note = await queryOne(
      `SELECT type FROM notifications WHERE business_id = $1 AND reference_id = $2`,
      [B, hubReq.id]
    );
    expect(note?.type).toBe('hub_connection_request');

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
    const hubReq = await queryOne(
      `SELECT status FROM supplier_connection_requests WHERE buyer_business_id = $1 AND supplier_business_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [A, B]
    );
    expect(hubReq.status).toBe('accepted');

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
    // The carton B could not send now waits on a backorder for B to confirm later.
    const backorder = await queryOne(
      `SELECT o.id, o.status, o.origin, l.qty, l.vendor_item_id FROM supply_orders o JOIN supply_order_lines l ON l.order_id = o.id
        WHERE o.parent_order_id = $1`,
      [order.id]
    );
    expect(backorder).toMatchObject({ status: 'pending', origin: 'backorder', vendor_item_id: ITEM_B });
    expect(Number(backorder.qty)).toBe(1);
    await query(`UPDATE supply_orders SET status = 'cancelled' WHERE id = $1`, [backorder.id]);
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

  it('orders: B sets its pack size on an unmatched line, bills it to a customer with a state, and dispatches', async () => {
    const BUYER_ITEM = randomUUID();
    const VENDOR_BOX = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active) VALUES ($1, $2, 'Hide & Seek 100g', 'PCS', 'goods', true)`,
      [BUYER_ITEM, A]
    );
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, selling_price) VALUES ($1, $2, 'Hide & Seek box', 'BOX', 'goods', true, 240)`,
      [VENDOR_BOX, B]
    );
    const res = await ordersPOST(
      post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, lines: [{ buyer_item_id: BUYER_ITEM, buyer_qty: 35 }] })
    );
    const { order } = await res.json();
    const line = await queryOne(`SELECT id, qty, vendor_item_id FROM supply_order_lines WHERE order_id = $1`, [order.id]);
    expect(line.vendor_item_id).toBeNull();
    expect(Number(line.qty)).toBe(35);

    const octx = { params: { id: order.id } };
    const url = `/api/supply-orders/${order.id}`;
    // 35 pieces at 12 a box is 3 whole boxes; B confirms all of it.
    const answered = await orderPATCH(
      call('PATCH', url, UB, B, { action: 'respond', lines: [{ id: line.id, vendor_item_id: VENDOR_BOX, factor: 12 }] }),
      octx
    );
    expect((await answered.json()).status).toBe('confirmed');
    const after = await queryOne(
      `SELECT qty, confirmed_qty, buyer_units_per_vendor_unit AS factor FROM supply_order_lines WHERE id = $1`,
      [line.id]
    );
    expect([Number(after.qty), Number(after.confirmed_qty), Number(after.factor)]).toEqual([3, 3, 12]);
    const link = await queryOne(
      `SELECT buyer_item_id, buyer_units_per_vendor_unit AS factor FROM supplier_item_links
        WHERE buyer_business_id = $1 AND vendor_business_id = $2 AND vendor_item_id = $3`,
      [A, B, VENDOR_BOX]
    );
    expect(link.buyer_item_id).toBe(BUYER_ITEM);
    expect(Number(link.factor)).toBe(12);
    expect(await queryOne(`SELECT id FROM supply_orders WHERE parent_order_id = $1`, [order.id])).toBeNull();

    // The bill's place of supply comes from the customer's state, filled from A's business.
    await query(`UPDATE businesses SET state = 'Karnataka' WHERE id = $1`, [A]);
    await query(`UPDATE customers SET state = NULL, state_code = NULL WHERE id = $1`, [CUST_A_AT_B]);
    const draft = await invoiceDraftGET(call('GET', `${url}/invoice-draft`, UB, B), octx);
    expect(draft.status).toBe(200);
    expect((await draft.json()).customer_id).toBe(CUST_A_AT_B);
    const cust = await queryOne(`SELECT state, state_code, gstin FROM customers WHERE id = $1`, [CUST_A_AT_B]);
    expect(cust).toMatchObject({ state: 'Karnataka', state_code: '29' });
    expect(cust.gstin).toBeTruthy();

    // Billed, then dispatched with a note, then received by A.
    const BILL = INVOICE;
    await query(`UPDATE supply_orders SET status = 'invoiced', invoice_id = NULL WHERE id = $1`, [order.id]);
    expect((await orderPATCH(call('PATCH', url, UA, A, { action: 'dispatch' }), octx)).status).toBe(409);
    const sent = await orderPATCH(call('PATCH', url, UB, B, { action: 'dispatch', note: 'VRL Logistics LR 4471' }), octx);
    expect((await sent.json()).status).toBe('dispatched');
    const shown = await (await orderGET(call('GET', url, UA, A), octx)).json();
    expect(shown.order).toMatchObject({ status: 'dispatched', dispatch_note: 'VRL Logistics LR 4471' });
    const asBuyer = await (await ordersGET(call('GET', '/api/supply-orders?role=buyer&group=action', UA, A))).json();
    expect(JSON.stringify(asBuyer)).toContain(order.id);

    // Any bill of B's to A will do here; receiving it is covered above.
    await query(`UPDATE supply_orders SET invoice_id = $2 WHERE id = $1`, [order.id, BILL]);
    const pool = (await import('@/lib/db')).getPool();
    const client = await pool.connect();
    try {
      await markSupplyOrderReceived(client, A, BILL, null as unknown as string);
    } finally {
      client.release();
    }
    expect((await queryOne(`SELECT status FROM supply_orders WHERE id = $1`, [order.id])).status).toBe('received');
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

  it('hub home shows each side its own work; the area report never shows a lone shop', async () => {
    const buyerHome = await hubHomeGET(call('GET', '/api/suppliers/hub/home', UA, A));
    expect(buyerHome.status).toBe(200);
    const a = await buyerHome.json();
    expect(a.roles.buying).toBe(true);
    expect(a.buying.partners.map((p: any) => p.supplierId)).toContain(supplierRowId);
    expect(a.inbox.every((i: any) => i.side === 'buying')).toBe(true);

    const sellerHome = await hubHomeGET(call('GET', '/api/suppliers/hub/home', UB, B));
    expect(sellerHome.status).toBe(200);
    const b = await sellerHome.json();
    expect(b.roles.selling).toBe(true);
    expect(b.selling.buyers).toBeGreaterThanOrEqual(1);
    expect(b.selling.insights.fillRate === null || (b.selling.insights.fillRate >= 0 && b.selling.insights.fillRate <= 1)).toBe(true);
    for (const item of b.inbox) expect(item.action).toBeTruthy();

    // A shares stock and sales with B, but as the only sharing shop it must not show up as an area.
    await query(`UPDATE suppliers SET allow_low_stock_access = true WHERE id = $1`, [supplierRowId]);
    const report = await areaReportGET(call('GET', '/api/suppliers/dashboard/analytics?period=fy', UB, B));
    expect(report.status).toBe(200);
    const r = await report.json();
    expect(r.shops_sharing).toBe(1);
    expect(r.states).toEqual([]);
    expect(r.cities).toEqual([]);
    expect(r.pivot_matrix).toEqual([]);
    expect(r.hidden_shops.states).toBe(1);
  });

  it('accept asks before attaching a customer that only shares an email', async () => {
    const email = `hub-${tag}@example.com`;
    const oldCustomer = randomUUID();
    await query(`UPDATE businesses SET email = $2 WHERE id = $1`, [C, email]);
    await query(
      `INSERT INTO customers (id, business_id, name, email) VALUES ($1, $2, 'Old Shop', $3)`,
      [oldCustomer, B, email]
    );
    await query(
      `INSERT INTO business_discovery (business_id, visibility) VALUES ($1, 'directory')
       ON CONFLICT (business_id) DO UPDATE SET visibility = 'directory'`,
      [B]
    );

    const ask = await connectPOST(
      post('/api/suppliers/hub/connection-requests', UC, C, { supplier_business_id: B, share_low_stock: true })
    );
    expect(ask.status).toBe(201);
    const { request: connReq } = await ask.json();

    const preview = await connectGET(
      call('GET', `/api/suppliers/hub/connection-requests/${connReq.id}`, UB, B),
      { params: { id: connReq.id } }
    );
    expect(preview.status).toBe(200);
    const shown = await preview.json();
    const match = shown.matches.find((m: { id: string }) => m.id === oldCustomer);
    expect(match?.reasons).toContain('email');

    const blocked = await connectPATCH(
      call('PATCH', `/api/suppliers/hub/connection-requests/${connReq.id}`, UB, B, { action: 'accept' }),
      { params: { id: connReq.id } }
    );
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe('CUSTOMER_DECISION_REQUIRED');
    expect((await queryOne(`SELECT linked_business_id FROM customers WHERE id = $1`, [oldCustomer])).linked_business_id).toBeNull();
    expect((await queryOne(`SELECT status FROM supplier_connection_requests WHERE id = $1`, [connReq.id])).status).toBe('pending');

    const wrong = await connectPATCH(
      call('PATCH', `/api/suppliers/hub/connection-requests/${connReq.id}`, UB, B, {
        action: 'accept',
        customer_decision: { choice: 'link', customer_id: randomUUID() },
      }),
      { params: { id: connReq.id } }
    );
    expect(wrong.status).toBe(400);

    const accepted = await connectPATCH(
      call('PATCH', `/api/suppliers/hub/connection-requests/${connReq.id}`, UB, B, {
        action: 'accept',
        customer_decision: { choice: 'link', customer_id: oldCustomer },
      }),
      { params: { id: connReq.id } }
    );
    expect(accepted.status).toBe(200);
    expect((await queryOne(`SELECT linked_business_id FROM customers WHERE id = $1`, [oldCustomer])).linked_business_id).toBe(C);
    const created = await queryOne(
      `SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1 AND linked_business_id = $2 AND id <> $3`,
      [B, C, oldCustomer]
    );
    expect(created.n).toBe(0);

    // C agreed to share low stock when asking, so the new supplier row shares from the start.
    const cSupplierRow = await queryOne(
      `SELECT allow_low_stock_access FROM suppliers WHERE business_id = $1 AND linked_business_id = $2 AND approval_status = 'approved'`,
      [C, B]
    );
    expect(cSupplierRow?.allow_low_stock_access).toBe(true);
  });

  it('declining a request rejects a supplier that was added with a link', async () => {
    const res = await createSupplier(post('/api/suppliers', UC, C, { name: `A Retail ${tag}`, linked_business_id: A }));
    expect(res.status).toBeLessThan(300);
    const { supplier } = await res.json();
    const hubReq = await queryOne(
      `SELECT id FROM supplier_connection_requests WHERE buyer_business_id = $1 AND supplier_business_id = $2 AND status = 'pending'`,
      [C, A]
    );
    const decline = await connectPATCH(
      call('PATCH', `/api/suppliers/hub/connection-requests/${hubReq.id}`, UA, A, { action: 'decline' }),
      { params: { id: hubReq.id } }
    );
    expect(decline.status).toBe(200);
    expect((await queryOne(`SELECT approval_status FROM suppliers WHERE id = $1`, [supplier.id])).approval_status).toBe(
      'rejected'
    );
  });

  it('a business cannot approve itself for the directory or act as another user', async () => {
    await query(`UPDATE business_discovery SET directory_approved = false WHERE business_id = $1`, [B]);
    const res = await discoveryPATCH(
      call('PATCH', '/api/suppliers/hub/discovery', UB, B, {
        visibility: 'directory',
        profile_summary: 'Biscuits and namkeen wholesale',
        directory_approved: true,
        updated_by_user_id: UA,
        business_id: A,
      })
    );
    expect(res.status).toBe(200);
    const row = await queryOne(
      `SELECT directory_approved, updated_by_user_id FROM business_discovery WHERE business_id = $1`,
      [B]
    );
    expect(row).toMatchObject({ directory_approved: false, updated_by_user_id: UB });
    const untouched = await queryOne(`SELECT business_id FROM business_discovery WHERE business_id = $1`, [A]);
    expect(untouched).toBeNull();
  });

  it('hub notices go out on WhatsApp once, after the change is saved, unless switched off', async () => {
    const send = sendPlatformEventWhatsApp as jest.Mock;
    await flushHubWhatsApp(500);
    send.mockClear();

    const res = await ordersPOST(
      post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, lines: [{ vendor_item_id: ITEM_B, qty: 1 }] })
    );
    expect(res.status).toBe(201);
    const { order } = await res.json();
    const queued = await queryOne(
      `SELECT status, path FROM supplier_hub_whatsapp_outbox WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [B]
    );
    expect(queued).toMatchObject({ status: 'queued', path: `/supply-orders/${order.id}` });

    expect((await flushHubWhatsApp(500)).sent).toBeGreaterThanOrEqual(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'supplier_hub_update',
        toPhone: '9876543210',
        vars: [expect.stringContaining('New order from'), expect.any(String), expect.stringContaining(`/supply-orders/${order.id}`)],
      })
    );

    // A second update about the same order within 10 minutes is not sent again.
    send.mockClear();
    const octx = { params: { id: order.id } };
    await orderPATCH(call('PATCH', `/api/supply-orders/${order.id}`, UA, A, { action: 'cancel' }), octx);
    await flushHubWhatsApp(500);
    expect(send).not.toHaveBeenCalled();
    const repeat = await queryOne(
      `SELECT status, skip_reason FROM supplier_hub_whatsapp_outbox WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [B]
    );
    expect(repeat).toMatchObject({ status: 'skipped', skip_reason: 'SENT_RECENTLY' });

    // Switched off in settings: nothing is sent.
    const off = await discoveryPATCH(call('PATCH', '/api/suppliers/hub/discovery', UB, B, { hub_whatsapp_enabled: false }));
    expect(off.status).toBe(200);
    const again = await ordersPOST(
      post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, lines: [{ vendor_item_id: ITEM_B, qty: 1 }] })
    );
    expect(again.status).toBe(201);
    await flushHubWhatsApp(500);
    expect(send).not.toHaveBeenCalled();
    const skipped = await queryOne(
      `SELECT skip_reason FROM supplier_hub_whatsapp_outbox WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [B]
    );
    expect(skipped.skip_reason).toBe('TURNED_OFF');
  });

  it('directory trust: GST verified from the registry, district filter, fill rate and reply time', async () => {
    const VALID_GSTIN = '27AAPFU0939F1ZV';
    await query(`UPDATE businesses SET gstin = $2, created_at = '2024-05-01' WHERE id = $1`, [C, VALID_GSTIN]);
    await query(
      `INSERT INTO business_discovery (business_id, visibility, profile_summary) VALUES ($1, 'directory', 'Kitchenware wholesale')
       ON CONFLICT (business_id) DO UPDATE SET visibility = 'directory', profile_summary = 'Kitchenware wholesale'`,
      [C]
    );
    await refreshGstVerification(C);
    const disc = await queryOne(
      `SELECT gst_verified_gstin, gst_status, gst_district FROM business_discovery WHERE business_id = $1`,
      [C]
    );
    expect(disc).toMatchObject({ gst_verified_gstin: VALID_GSTIN, gst_status: 'Active', gst_district: 'Pune' });

    // C answered three of A's orders: 27 of 30 confirmed, each about two hours later.
    const kadai = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active) VALUES ($1, $2, 'Kadai', 'PCS', 'goods', true)`,
      [kadai, C]
    );
    for (let n = 0; n < 3; n++) {
      const o = await queryOne(
        `INSERT INTO supply_orders (buyer_business_id, vendor_business_id, status, origin, created_by_business_id, created_at, confirmed_at)
         VALUES ($1, $2, 'partial', 'buyer', $1, CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour')
         RETURNING id`,
        [A, C]
      );
      await query(
        `INSERT INTO supply_order_lines (order_id, item_name, qty, confirmed_qty, vendor_item_id) VALUES ($1, 'Kadai', 10, 9, $2)`,
        [o.id, kadai]
      );
    }
    const trust = (await trustForBusinesses([C])).get(C)!;
    expect(trust).toMatchObject({
      gst_verified: true,
      gst_legal_name: 'HUB STRANGER TRADING LLP',
      district: 'Pune',
      fill_rate: 0.9,
      orders_answered: 3,
      reply_hours: 2,
    });
    expect(trust.member_since?.slice(0, 4)).toBe('2024');

    // A new GSTIN loses the badge until it is looked up again.
    await query(`UPDATE businesses SET gstin = '29AAACR5055K1Z5' WHERE id = $1`, [C]);
    expect((await trustForBusinesses([C])).get(C)!.gst_verified).toBe(false);
    await query(`UPDATE businesses SET gstin = $2 WHERE id = $1`, [C, VALID_GSTIN]);

    const list = await directoryGET(call('GET', '/api/suppliers/hub/directory?district=pune&gst_verified=1', UA, A));
    expect(list.status).toBe(200);
    const data = await list.json();
    expect(data.districts).toContain('Pune');
    const row = data.businesses.find((b: { id: string }) => b.id === C);
    expect(row?.trust).toMatchObject({ gst_verified: true, fill_rate: 0.9 });
    expect(data.businesses.every((b: { trust: { district: string } }) => b.trust.district.toLowerCase() === 'pune')).toBe(true);
  });

  it('a first order travels with the connection request, and both sides can write on it', async () => {
    // C lists in the directory (previous test) with one public and one connected-only item.
    const [PUB, PRIV] = [randomUUID(), randomUUID()];
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active) VALUES ($1, $3, 'Tawa', 'PCS', 'goods', true), ($2, $3, 'Pressure cooker', 'PCS', 'goods', true)`,
      [PUB, PRIV, C]
    );
    await query(
      `INSERT INTO supplier_published_listings (supplier_business_id, item_id, audience, moq) VALUES ($1, $2, 'public_preview', 6), ($1, $3, 'linked_only', NULL)`,
      [C, PUB, PRIV]
    );
    // Only public catalogue items, and the minimum still applies.
    const hidden = await connectPOST(
      post('/api/suppliers/hub/connection-requests', UA, A, { supplier_business_id: C, lines: [{ vendor_item_id: PRIV, qty: 2 }] })
    );
    expect(hidden.status).toBe(400);
    const tooFew = await connectPOST(
      post('/api/suppliers/hub/connection-requests', UA, A, { supplier_business_id: C, lines: [{ vendor_item_id: PUB, qty: 2 }] })
    );
    expect(tooFew.status).toBe(400);
    expect(await queryOne(`SELECT id FROM supplier_connection_requests WHERE buyer_business_id = $1 AND supplier_business_id = $2 AND status = 'pending'`, [A, C])).toBeNull();

    const ask = await connectPOST(
      post('/api/suppliers/hub/connection-requests', UA, A, { supplier_business_id: C, lines: [{ vendor_item_id: PUB, qty: 6 }] })
    );
    expect(ask.status).toBe(201);
    const { request: req, order } = await ask.json();
    expect(order.status).toBe('awaiting_link');

    // A writes before C has accepted; C can read it on the order.
    const octx = { params: { id: order.id } };
    const wrote = await commentsPOST(post(`/api/supply-orders/${order.id}/comments`, UA, A, { body: 'Need these by Friday' }), octx);
    expect(wrote.status).toBe(201);
    expect((await commentsPOST(post(`/api/supply-orders/${order.id}/comments`, UB, B, { body: 'hi' }), octx)).status).toBe(404);

    const accept = await connectPATCH(
      call('PATCH', `/api/suppliers/hub/connection-requests/${req.id}`, UC, C, { action: 'accept', customer_decision: { choice: 'create' } }),
      { params: { id: req.id } }
    );
    expect(accept.status).toBe(200);
    expect((await queryOne(`SELECT status FROM supply_orders WHERE id = $1`, [order.id])).status).toBe('pending');
    const note = await queryOne(
      `SELECT title FROM notifications WHERE business_id = $1 AND reference_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [C, order.id]
    );
    expect(note.title).toContain('First order from');

    await commentsPOST(post(`/api/supply-orders/${order.id}/comments`, UC, C, { body: 'Yes, Friday works' }), octx);
    const thread = await (await commentsGET(call('GET', `/api/supply-orders/${order.id}/comments`, UA, A), octx)).json();
    expect(thread.comments.map((c: { body: string; mine: boolean }) => [c.body, c.mine])).toEqual([
      ['Need these by Friday', true],
      ['Yes, Friday works', false],
    ]);
  });

  it('an order link reaches a supplier not on Khatario, who answers without an account and joins', async () => {
    const OFFLINE = randomUUID();
    await query(`INSERT INTO suppliers (id, business_id, name, phone) VALUES ($1, $2, 'Gupta Agencies', '9812345678')`, [OFFLINE, A]);
    const made = await inviteOrdersPOST(
      post('/api/suppliers/hub/invite-orders', UA, A, {
        supplier_id: OFFLINE,
        notes: 'Deliver by Monday',
        lines: [{ buyer_item_id: ITEM_A, qty: 48 }, { item_name: 'Loose sugar', qty: 25 }],
      })
    );
    expect(made.status).toBe(201);
    const created = await made.json();
    expect(created.supplier_phone).toBe('9812345678');
    expect(created.message).toContain('Parle-G 50g: 48 PCS');
    expect(created.link).toContain('/so/');
    const token = created.order.token as string;
    // Another business cannot create orders for A's supplier.
    expect((await inviteOrdersPOST(post('/api/suppliers/hub/invite-orders', UB, B, { supplier_id: OFFLINE, lines: [{ item_name: 'x', qty: 1 }] }))).status).toBe(404);

    const tctx = { params: { token } };
    expect((await publicOrderGET(new NextRequest(`http://localhost/api/public/supplier-order/nope-not-a-real-token-123`), { params: { token: 'nope-not-a-real-token-123' } })).status).toBe(404);
    const viewed = await (await publicOrderGET(new NextRequest(`http://localhost/api/public/supplier-order/${token}`), tctx)).json();
    expect(viewed.order).toMatchObject({ status: 'viewed', supplier_name: 'Gupta Agencies', notes: 'Deliver by Monday' });
    expect(viewed.order._internal).toBeUndefined();
    const [l1, l2] = viewed.order.lines;

    const answer = await publicOrderPOST(
      new NextRequest(`http://localhost/api/public/supplier-order/${token}`, {
        method: 'POST',
        body: JSON.stringify({ lines: [{ id: l1.id, confirmed_qty: 48 }, { id: l2.id, confirmed_qty: 20 }], note: 'Sugar short this week' }),
      }),
      tctx
    );
    expect((await answer.json()).status).toBe('partial');
    const twice = await publicOrderPOST(
      new NextRequest(`http://localhost/api/public/supplier-order/${token}`, { method: 'POST', body: JSON.stringify({ decline: true }) }),
      tctx
    );
    expect(twice.status).toBe(409);
    const listed = await (await inviteOrdersGET(call('GET', `/api/suppliers/hub/invite-orders?supplier_id=${OFFLINE}`, UA, A))).json();
    expect(listed.orders[0]).toMatchObject({ status: 'partial', response_note: 'Sugar short this week' });

    // A new business joins and connects from the link: A's record of Gupta links to it.
    const D = randomUUID();
    await query(`INSERT INTO businesses (id, name, state_code, gst_registration_type) VALUES ($1, $2, '29', 'regular')`, [D, `Gupta Agencies ${tag}`]);
    try {
      expect((await inviteClaimPOST(post('/api/suppliers/hub/invite-orders/claim', UA, A, { token }))).status).toBe(400);
      const claimed = await inviteClaimPOST(post('/api/suppliers/hub/invite-orders/claim', randomUUID(), D, { token }));
      expect(claimed.status).toBe(200);
      const row = await queryOne(`SELECT linked_business_id, approval_status FROM suppliers WHERE id = $1`, [OFFLINE]);
      expect(row).toMatchObject({ linked_business_id: D, approval_status: 'approved' });
      const customer = await queryOne(`SELECT id FROM customers WHERE business_id = $1 AND linked_business_id = $2`, [D, A]);
      expect(customer?.id).toBeTruthy();
      expect((await inviteClaimPOST(post('/api/suppliers/hub/invite-orders/claim', UC, C, { token }))).status).toBe(409);
    } finally {
      await query(`UPDATE suppliers SET linked_business_id = NULL, approval_status = 'none' WHERE id = $1`, [OFFLINE]);
      await query(`DELETE FROM supplier_invite_orders WHERE supplier_id = $1`, [OFFLINE]);
      await query(`DELETE FROM notifications WHERE business_id = $1`, [D]);
      await query(`DELETE FROM customers WHERE business_id = $1`, [D]);
      await query(`DELETE FROM businesses WHERE id = $1`, [D]);
    }
  });

  it('catalogue: uploaded photo, sizes with their own price, and a price for one buyer', async () => {
    const PACKED = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, selling_price) VALUES ($1, $2, 'Cotton kurti', 'PCS', 'goods', true, 500)`,
      [PACKED, B]
    );
    const made = await createListing(post('/api/suppliers/hub/published-listings', UB, B, { item_id: PACKED, audience: 'linked_only' }));
    const { listing } = await made.json();
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
    const patch = (body: object) =>
      patchListing(
        new NextRequest(`http://localhost/api/suppliers/hub/published-listings/${listing.id}`, {
          method: 'PATCH',
          headers: headers(UB, B),
          body: JSON.stringify(body),
        }),
        { params: { id: listing.id } }
      );
    expect((await patch({ options: 'S:450, M:450, M:480' })).status).toBe(400);
    expect((await patch({ image_url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await patch({ options: 'S:450, M:450, L:480, XL', price: 460, image_url: photo })).status).toBe(200);
    const options = await query(`SELECT id, label, price FROM supplier_listing_options WHERE listing_id = $1 ORDER BY sort_order`, [listing.id]);
    expect(options.rows.map((o: any) => [o.label, o.price == null ? null : Number(o.price)])).toEqual([
      ['S', 450],
      ['M', 450],
      ['L', 480],
      ['XL', null],
    ]);
    const [, , large, xl] = options.rows;

    // A orders L (its own price) and XL (no price of its own: the catalogue price).
    const res = await ordersPOST(
      post('/api/supply-orders', UA, A, {
        supplier_id: supplierRowId,
        from_catalog: true,
        lines: [{ vendor_item_id: PACKED, option_id: large.id, qty: 2 }, { vendor_item_id: PACKED, option_id: xl.id, qty: 1 }],
      })
    );
    expect(res.status).toBe(201);
    const { order } = await res.json();
    const lines = await query(`SELECT option_label, unit_price FROM supply_order_lines WHERE order_id = $1 ORDER BY sort_order`, [order.id]);
    expect(lines.rows.map((l: any) => [l.option_label, Number(l.unit_price)])).toEqual([
      ['L', 480],
      ['XL', 460],
    ]);
    // An option of another listing is refused.
    const wrong = await ordersPOST(
      post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, from_catalog: true, lines: [{ vendor_item_id: ITEM_B, option_id: large.id, qty: 1 }] })
    );
    expect(wrong.status).toBe(400);

    // B sets A's own price; it wins over option and catalogue prices on new orders and the bill.
    expect((await buyerPricesPUT(call('PUT', '/api/suppliers/hub/buyer-prices', UB, B, { customer_id: CUST_A_AT_B, item_id: PACKED, price: 430 }))).status).toBe(200);
    expect((await buyerPricesPUT(call('PUT', '/api/suppliers/hub/buyer-prices', UC, C, { customer_id: CUST_A_AT_B, item_id: PACKED, price: 1 }))).status).toBe(404);
    const priced = await (await buyerPricesGET(call('GET', `/api/suppliers/hub/buyer-prices?customer_id=${CUST_A_AT_B}&q=kurti`, UB, B))).json();
    expect(priced.items[0]).toMatchObject({ id: PACKED });
    expect(Number(priced.items[0].buyer_price)).toBe(430);

    const second = await ordersPOST(
      post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, from_catalog: true, lines: [{ vendor_item_id: PACKED, option_id: large.id, qty: 3 }] })
    );
    const { order: o2 } = await second.json();
    const line2 = await queryOne(`SELECT id, unit_price FROM supply_order_lines WHERE order_id = $1`, [o2.id]);
    expect(Number(line2.unit_price)).toBe(430);
    const octx = { params: { id: o2.id } };
    await orderPATCH(call('PATCH', `/api/supply-orders/${o2.id}`, UB, B, { action: 'respond', lines: [{ id: line2.id, confirmed_qty: 3 }] }), octx);
    const draft = await (await invoiceDraftGET(call('GET', `/api/supply-orders/${o2.id}/invoice-draft`, UB, B), octx)).json();
    expect(draft.lines[0]).toMatchObject({ name: 'Cotton kurti (L)', selling_price: 430, quantity: 3 });
  });

  it('pricing: hub catalogue, orders and the bill draft use the billing price rules for the linked customer (F-017, F-018)', async () => {
    const { resolvePrices } = await import('@/lib/pricing/resolve-price');
    const { getPool } = await import('@/lib/db');
    const [CAT, OIL, BIS, SOAP, SHIRT, SH_S, SH_M, LEVEL] = Array.from({ length: 8 }, () => randomUUID());
    await query(`INSERT INTO categories (id, business_id, name) VALUES ($1, $2, $3)`, [CAT, B, `Soaps ${tag}`]);
    for (const [id, name, unit, price, tax, cat, variants] of [
      [OIL, 'Sunflower oil 15L', 'TIN', 2200, 5, null, false],
      [BIS, 'Glucose biscuits', 'CTN', 500, 18, null, false],
      [SOAP, 'Bath soap', 'PCS', 40, 18, CAT, false],
      [SHIRT, 'Polo shirt', 'PCS', 300, 5, null, true],
    ] as const) {
      await query(
        `INSERT INTO items (id, business_id, name, unit, item_type, is_active, selling_price, tax_rate, category_id, has_variants, current_stock)
         VALUES ($1, $2, $3, $4, 'goods', true, $5, $6, $7, $8, 100)`,
        [id, B, name, unit, price, tax, cat, variants]
      );
    }
    for (const [id, label] of [[SH_S, 'S'], [SH_M, 'M']]) {
      await query(`INSERT INTO item_variants (id, item_id, variant_name, selling_price, current_stock) VALUES ($1, $2, $3, 300, 50)`, [id, SHIRT, label]);
    }
    for (const id of [OIL, BIS, SOAP, SHIRT]) {
      const made = await createListing(post('/api/suppliers/hub/published-listings', UB, B, { item_id: id, audience: 'linked_only' }));
      expect(made.status).toBeLessThan(300);
      if (id === SHIRT) {
        const { listing } = await made.json();
        const res = await patchListing(
          new NextRequest(`http://localhost/api/suppliers/hub/published-listings/${listing.id}`, {
            method: 'PATCH',
            headers: headers(UB, B),
            body: JSON.stringify({ options: 'S, M' }),
          }),
          { params: { id: listing.id } }
        );
        expect(res.status).toBe(200);
      }
    }
    // B's rules for its customer A, set where billing reads them:
    //   oil: customer price 2,100 less 5 %; shirt size M: customer price 250;
    //   biscuits: A's price level at 25, and 20 from 10 cartons; soaps: 10 % category discount.
    await query(
      `INSERT INTO party_item_prices (business_id, party_id, item_id, price, discount_percent) VALUES ($1, $2, $3, 2100, 5)`,
      [B, CUST_A_AT_B, OIL]
    );
    await query(
      `INSERT INTO party_item_prices (business_id, party_id, item_id, variant_id, price) VALUES ($1, $2, $3, $4, 250)`,
      [B, CUST_A_AT_B, SHIRT, SH_M]
    );
    await query(`INSERT INTO price_levels (id, business_id, name) VALUES ($1, $2, $3)`, [LEVEL, B, `Dealer ${tag}`]);
    await query(
      `INSERT INTO price_level_rates (business_id, price_level_id, item_id, min_qty, price) VALUES ($1, $2, $3, 0, 25), ($1, $2, $3, 10, 20)`,
      [B, LEVEL, BIS]
    );
    await query(`UPDATE customers SET price_level_id = $1 WHERE id = $2`, [LEVEL, CUST_A_AT_B]);
    await query(
      `INSERT INTO party_category_discounts (business_id, party_id, category_id, discount_percent) VALUES ($1, $2, $3, 10)`,
      [B, CUST_A_AT_B, CAT]
    );
    const billing = async (lines: { itemId: string; variantId?: string | null; qty: number }[]) =>
      resolvePrices(getPool(), B, CUST_A_AT_B, lines, new Date().toISOString().slice(0, 10));

    try {
      // The catalogue shows A the prices B's bills would charge A.
      const feed = await (await newArrivalsGET(call('GET', `/api/suppliers/hub/new-arrivals?supplier_id=${supplierRowId}`, UA, A))).json();
      const shown = (id: string) => feed.catalog.find((l: { vendor_item_id: string }) => l.vendor_item_id === id);
      expect([Number(shown(OIL).price), Number(shown(OIL).discount_percent), shown(OIL).my_price]).toEqual([2100, 5, true]);
      expect([Number(shown(BIS).price), shown(BIS).my_price]).toEqual([25, true]);
      expect(Number(shown(SOAP).discount_percent)).toBe(10);
      const sizes = shown(SHIRT).options.map((o: { label: string; price: number | null }) => [o.label, o.price == null ? null : Number(o.price)]);
      expect(sizes).toEqual([['S', null], ['M', 250]]);

      // A orders from the catalogue: each line carries price, discount and B's size.
      const opts = await query(
        `SELECT o.id, o.label FROM supplier_listing_options o JOIN supplier_published_listings l ON l.id = o.listing_id
          WHERE l.item_id = $1 ORDER BY o.sort_order`,
        [SHIRT]
      );
      const optionM = opts.rows.find((o: { label: string }) => o.label === 'M').id;
      const res = await ordersPOST(
        post('/api/supply-orders', UA, A, {
          supplier_id: supplierRowId,
          from_catalog: true,
          lines: [
            { vendor_item_id: OIL, qty: 2 },
            { vendor_item_id: BIS, qty: 12 },
            { vendor_item_id: SOAP, qty: 5 },
            { vendor_item_id: SHIRT, option_id: optionM, qty: 3 },
          ],
        })
      );
      expect(res.status).toBe(201);
      const { order } = await res.json();
      const rows = (
        await query(
          `SELECT vendor_item_id, vendor_variant_id, unit_price, discount_percent FROM supply_order_lines WHERE order_id = $1 ORDER BY sort_order`,
          [order.id]
        )
      ).rows.map((l: any) => [
        l.vendor_item_id,
        l.vendor_variant_id,
        l.unit_price == null ? null : Number(l.unit_price),
        Number(l.discount_percent),
      ]);
      expect(rows).toEqual([
        [OIL, null, 2100, 5],
        [BIS, null, 20, 0],
        [SOAP, null, null, 10],
        [SHIRT, SH_M, 250, 0],
      ]);

      // Both sides see the discount on the order.
      const asA = await (await orderGET(call('GET', `/api/supply-orders/${order.id}`, UA, A), { params: { id: order.id } })).json();
      expect(asA.lines.map((l: any) => [Number(l.unit_price), Number(l.discount_percent)])[0]).toEqual([2100, 5]);

      // The bill draft carries what billing A would charge, line by line.
      const octx = { params: { id: order.id } };
      const lines = (await query(`SELECT id, qty FROM supply_order_lines WHERE order_id = $1`, [order.id])).rows;
      expect(
        (await orderPATCH(call('PATCH', `/api/supply-orders/${order.id}`, UB, B, {
          action: 'respond',
          lines: lines.map((l: any) => ({ id: l.id, confirmed_qty: Number(l.qty) })),
        }), octx)).status
      ).toBe(200);
      const draft = await (await invoiceDraftGET(call('GET', `/api/supply-orders/${order.id}/invoice-draft`, UB, B), octx)).json();
      const truth = await billing([
        { itemId: OIL, qty: 2 },
        { itemId: BIS, qty: 12 },
        { itemId: SOAP, qty: 5 },
        { itemId: SHIRT, variantId: SH_M, qty: 3 },
      ]);
      expect(
        draft.lines.map((l: any) => [l.item_id, l.variant_id ?? null, l.selling_price, l.discount_percent])
      ).toEqual(truth.map((t) => [t.itemId, t.variantId, t.price, t.discountPercent ?? 0]));

      // B drafts an order itself: changing the quantity moves it onto the level's slab.
      const own = await ordersPOST(
        post('/api/supply-orders', UB, B, { customer_id: CUST_A_AT_B, lines: [{ vendor_item_id: BIS, qty: 5 }] })
      );
      expect(own.status).toBe(201);
      const { order: drafted } = await own.json();
      const dline = await queryOne(`SELECT id, unit_price FROM supply_order_lines WHERE order_id = $1`, [drafted.id]);
      expect(Number(dline.unit_price)).toBe(25);
      expect(
        (await orderPATCH(call('PATCH', `/api/supply-orders/${drafted.id}`, UB, B, { action: 'update', lines: [{ id: dline.id, qty: 10 }] }), {
          params: { id: drafted.id },
        })).status
      ).toBe(200);
      expect(Number((await queryOne(`SELECT unit_price FROM supply_order_lines WHERE id = $1`, [dline.id])).unit_price)).toBe(20);
      await query(`DELETE FROM supply_orders WHERE id = ANY($1::uuid[])`, [[order.id, drafted.id]]);

      // Without the party pricing plan B's bills ignore customer rules, and so does the hub.
      const { assertFeatureAccess, FeatureAccessDeniedError } = await import('@/lib/subscription/feature-access');
      (assertFeatureAccess as jest.Mock).mockImplementation(async (biz: string, key: string) => {
        if (key === 'party_pricing') throw new FeatureAccessDeniedError(key, biz, 'FEATURE_NOT_ENABLED');
      });
      try {
        const plain = await (await newArrivalsGET(call('GET', `/api/suppliers/hub/new-arrivals?supplier_id=${supplierRowId}`, UA, A))).json();
        const oil = plain.catalog.find((l: { vendor_item_id: string }) => l.vendor_item_id === OIL);
        expect([oil.price, Number(oil.discount_percent), oil.my_price]).toEqual([null, 0, false]);
      } finally {
        (assertFeatureAccess as jest.Mock).mockReset();
        (assertFeatureAccess as jest.Mock).mockResolvedValue(undefined);
      }
    } finally {
      await query(`UPDATE customers SET price_level_id = NULL WHERE id = $1`, [CUST_A_AT_B]);
      await query(`DELETE FROM party_category_discounts WHERE party_id = $1`, [CUST_A_AT_B]);
      await query(`DELETE FROM party_item_prices WHERE party_id = $1 AND item_id = ANY($2::uuid[])`, [CUST_A_AT_B, [OIL, SHIRT]]);
      await query(`DELETE FROM supplier_published_listings WHERE item_id = ANY($1::uuid[])`, [[OIL, BIS, SOAP, SHIRT]]);
    }
  });

  it("money: the buyer's payment and debit note reach the supplier to record", async () => {
    const purchase = await queryOne(`SELECT id FROM purchases WHERE business_id = $1 AND source_invoice_id = $2`, [A, INVOICE]);
    expect(purchase?.id).toBeTruthy();
    const paymentId = randomUUID();
    await noticeBuyerPayment({
      buyerBusinessId: A, purchaseId: purchase.id, paymentId, amount: 500, paymentMode: 'upi', paymentDate: null, note: 'UTR 4471',
    });
    // The same payment never makes a second notice.
    await noticeBuyerPayment({
      buyerBusinessId: A, purchaseId: purchase.id, paymentId, amount: 500, paymentMode: 'upi', paymentDate: null, note: null,
    });
    await noticeBuyerDebitNote({ buyerBusinessId: A, purchaseId: purchase.id, returnId: randomUUID(), amount: 80, returnDate: null, reason: '4 short' });

    const asB = await (await moneyGET(call('GET', '/api/suppliers/hub/money-notices', UB, B))).json();
    const pay = asB.notices.filter((n: { kind: string }) => n.kind === 'payment');
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ amount: 500, payment_mode: 'upi', invoice_id: INVOICE });
    const debit = asB.notices.find((n: { kind: string }) => n.kind === 'debit_note');
    expect(debit).toMatchObject({ amount: 80, note: '4 short' });
    // Nobody else sees or acts on them.
    expect((await (await moneyGET(call('GET', '/api/suppliers/hub/money-notices', UC, C))).json()).notices).toHaveLength(0);
    expect((await moneyPOST(post('/api/suppliers/hub/money-notices', UC, C, { notice_id: pay[0].id, action: 'dismiss' }))).status).toBe(404);

    // A credit note on that bill, made after the notice, settles the debit note.
    await query(
      `INSERT INTO credit_notes (business_id, branch_id, customer_id, invoice_id, credit_note_number, credit_note_date, grand_total, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 80, CURRENT_TIMESTAMP + INTERVAL '1 second')`,
      [B, BRB, CUST_A_AT_B, INVOICE, `CN-${tag}`]
    );
    const after = await (await moneyGET(call('GET', '/api/suppliers/hub/money-notices', UB, B))).json();
    expect(after.notices.some((n: { kind: string }) => n.kind === 'debit_note')).toBe(false);

    // One tap records the receipt against B's bill through the normal payments API.
    const recorded = await moneyPOST(post('/api/suppliers/hub/money-notices', UB, B, { notice_id: pay[0].id, action: 'record' }));
    const rec = await recorded.json();
    expect([recorded.status, rec.error]).toEqual([200, undefined]);
    const receipt = await queryOne(`SELECT type, reference_type, reference_id, amount FROM payments WHERE id = $1`, [rec.payment_id]);
    expect(receipt).toMatchObject({ type: 'receivable', reference_type: 'invoice', reference_id: INVOICE });
    expect(Number(receipt.amount)).toBe(500);
    // Tapping again does nothing more.
    expect((await moneyPOST(post('/api/suppliers/hub/money-notices', UB, B, { notice_id: pay[0].id, action: 'record' }))).status).toBe(404);
    expect((await (await moneyGET(call('GET', '/api/suppliers/hub/money-notices', UB, B))).json()).notices).toHaveLength(0);

    expect(upiPayLink({ upiId: 'shop@okicici', payeeName: 'Hub Wholesaler', amount: 1200.5, billNumber: 'HUB-1' })).toBe(
      'upi://pay?pa=shop%40okicici&pn=Hub+Wholesaler&am=1200.50&cu=INR&tn=Bill+HUB-1'
    );
  });

  it('trades: backup supplier, standing orders, sizes running low, and reorder from sales', async () => {
    expect(suggestedBuyerQty({ current_stock: 2, min_stock: 5, sold_30: 60 })).toBe(26); // 2 a day for 14 days, less 2 in stock
    expect(suggestedBuyerQty({ current_stock: 2, min_stock: 5 })).toBe(8);

    // Backup: B cannot supply; the item's backup supplier C gets the order.
    const cSupplier = await queryOne(
      `SELECT id FROM suppliers WHERE business_id = $1 AND linked_business_id = $2 AND approval_status = 'approved'`,
      [A, C]
    );
    const BREAD = randomUUID();
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, default_supplier_id, backup_supplier_id)
       VALUES ($1, $2, 'Bread 400g', 'PCS', 'goods', true, $3, $4)`,
      [BREAD, A, supplierRowId, cSupplier.id]
    );
    const made = await ordersPOST(post('/api/supply-orders', UA, A, { supplier_id: supplierRowId, lines: [{ buyer_item_id: BREAD, buyer_qty: 30 }] }));
    const { order } = await made.json();
    const line = await queryOne(`SELECT id FROM supply_order_lines WHERE order_id = $1`, [order.id]);
    await orderPATCH(
      call('PATCH', `/api/supply-orders/${order.id}`, UB, B, { action: 'respond', lines: [{ id: line.id, confirmed_qty: 0 }] }),
      { params: { id: order.id } }
    );
    const backup = await queryOne(
      `SELECT o.vendor_business_id, o.status, o.origin, l.qty FROM supply_orders o JOIN supply_order_lines l ON l.order_id = o.id
        WHERE o.parent_order_id = $1`,
      [order.id]
    );
    expect(backup).toMatchObject({ vendor_business_id: C, status: 'pending', origin: 'backup' });
    expect(Number(backup.qty)).toBe(30);

    // Standing order: A proposes, C accepts, each due day becomes one confirmed order.
    const proposed = await standingPOST(
      post('/api/supply-orders/standing', UA, A, { supplier_id: cSupplier.id, weekdays: [0, 1, 2, 3, 4, 5, 6], lines: [{ buyer_item_id: BREAD, buyer_qty: 40 }] })
    );
    expect(proposed.status).toBe(201);
    const { standing } = await proposed.json();
    const sctx = { params: { id: standing.id } };
    expect((await runDueStandingOrders()) >= 0).toBe(true);
    expect(await queryOne(`SELECT id FROM supply_orders WHERE standing_order_id = $1`, [standing.id])).toBeNull();
    expect((await standingPATCH(call('PATCH', `/api/supply-orders/standing/${standing.id}`, UA, A, { action: 'accept' }), sctx)).status).toBe(409);
    expect((await standingPATCH(call('PATCH', `/api/supply-orders/standing/${standing.id}`, UC, C, { action: 'accept' }), sctx)).status).toBe(200);
    await runDueStandingOrders();
    await runDueStandingOrders();
    const daily = await query(
      `SELECT o.status, o.origin, l.qty, l.confirmed_qty FROM supply_orders o JOIN supply_order_lines l ON l.order_id = o.id
        WHERE o.standing_order_id = $1`,
      [standing.id]
    );
    expect(daily.rows).toHaveLength(1);
    expect(daily.rows[0]).toMatchObject({ status: 'confirmed', origin: 'standing' });
    expect(Number(daily.rows[0].confirmed_qty)).toBe(40);
    await standingPATCH(call('PATCH', `/api/supply-orders/standing/${standing.id}`, UA, A, { action: 'end' }), sctx);

    // Sizes: a kurti's M runs low on its own and the suggested order names the size.
    const KURTI = randomUUID();
    const [SIZE_M, SIZE_L] = [randomUUID(), randomUUID()];
    await query(`UPDATE suppliers SET allow_low_stock_access = true WHERE id = $1`, [supplierRowId]);
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, has_variants, default_supplier_id)
       VALUES ($1, $2, 'Kurti', 'PCS', 'goods', true, true, $3)`,
      [KURTI, A, supplierRowId]
    );
    await query(
      `INSERT INTO item_variants (id, item_id, variant_name, current_stock, min_stock) VALUES ($1, $3, 'M', 1, 4), ($2, $3, 'L', 9, 4)`,
      [SIZE_M, SIZE_L, KURTI]
    );
    await buildSuggestedOrders({ buyerBusinessId: A });
    const sized = await query(
      `SELECT l.item_name, l.buyer_variant_id FROM supply_order_lines l JOIN supply_orders o ON o.id = l.order_id
        WHERE o.buyer_business_id = $1 AND l.buyer_item_id = $2`,
      [A, KURTI]
    );
    expect(sized.rows).toEqual([{ item_name: 'Kurti – M', buyer_variant_id: SIZE_M }]);
  });

  it('platform review holds new directory listings; warehouse stock counts for low stock', async () => {
    // Review on: a business that has never been reviewed waits when it lists itself.
    const { setListingReview } = await import('@/lib/supplier-hub-visibility');
    await setListingReview(true);
    try {
      await query(`UPDATE business_discovery SET reviewed_at = NULL, directory_approved = true, visibility = 'hidden' WHERE business_id = $1`, [B]);
      const listed = await discoveryPATCH(
        call('PATCH', '/api/suppliers/hub/discovery', UB, B, { visibility: 'directory', profile_summary: 'Biscuits and namkeen wholesale' })
      );
      expect(listed.status).toBe(200);
      expect((await queryOne(`SELECT directory_approved FROM business_discovery WHERE business_id = $1`, [B])).directory_approved).toBe(false);
      // Once a platform admin approved it, saving again keeps it listed.
      await query(`UPDATE business_discovery SET directory_approved = true, reviewed_at = CURRENT_TIMESTAMP WHERE business_id = $1`, [B]);
      await discoveryPATCH(call('PATCH', '/api/suppliers/hub/discovery', UB, B, { visibility: 'directory', profile_summary: 'Biscuits, namkeen' }));
      expect((await queryOne(`SELECT directory_approved FROM business_discovery WHERE business_id = $1`, [B])).directory_approved).toBe(true);
    } finally {
      await setListingReview(false);
    }

    // Warehouse mode: items.current_stock is stale; the sum over locations decides.
    const WH_ITEM = randomUUID();
    const LOC = randomUUID();
    await query(`UPDATE suppliers SET allow_low_stock_access = true WHERE id = $1`, [supplierRowId]);
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, min_stock, current_stock, default_supplier_id)
       VALUES ($1, $2, 'Good Day 75g', 'PCS', 'goods', true, 10, 500, $3)`,
      [WH_ITEM, A, supplierRowId]
    );
    const hadSettings = await queryOne(`SELECT warehouses_enabled FROM business_settings WHERE business_id = $1`, [A]);
    await query(
      `INSERT INTO business_settings (business_id, warehouses_enabled) VALUES ($1, true)
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = true`,
      [A]
    );
    try {
      await query(`INSERT INTO warehouses (id, business_id, name) VALUES ($1, $2, 'Godown')`, [LOC, A]);
      await query(`INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 3)`, [LOC, WH_ITEM]);
      await checkLowStockForItem(WH_ITEM, A);
      expect(await queryOne(`SELECT id FROM low_stock_alerts WHERE item_id = $1 AND alert_status = 'active'`, [WH_ITEM])).toBeTruthy();
    } finally {
      await query(`DELETE FROM location_stock WHERE item_id = $1`, [WH_ITEM]);
      await query(`DELETE FROM warehouses WHERE id = $1`, [LOC]);
      await query(`UPDATE business_settings SET warehouses_enabled = $2 WHERE business_id = $1`, [A, hadSettings?.warehouses_enabled ?? false]);
    }
  });

  it('billing warns about a missing address or HSN; received sizes add stock to that size', async () => {
    const [KURTI2, SIZE_M, SIZE_L, VEND_KURTI] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, has_variants) VALUES ($1, $2, 'Cotton kurti', 'PCS', 'goods', true, true)`,
      [KURTI2, A]
    );
    await query(`INSERT INTO item_variants (id, item_id, variant_name, current_stock) VALUES ($1, $3, 'M', 0), ($2, $3, 'L', 0)`, [SIZE_M, SIZE_L, KURTI2]);
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, is_active, selling_price) VALUES ($1, $2, 'KURTI COTTON', 'PCS', 'goods', true, 400)`,
      [VEND_KURTI, B]
    );
    await query(
      `INSERT INTO supplier_item_links (buyer_business_id, vendor_business_id, buyer_item_id, vendor_item_id, buyer_units_per_vendor_unit, source)
       VALUES ($1, $2, $3, $4, 1, 'manual')`,
      [A, B, KURTI2, VEND_KURTI]
    );
    const order = await queryOne(
      `INSERT INTO supply_orders (buyer_business_id, vendor_business_id, status, origin, created_by_business_id, confirmed_at)
       VALUES ($1, $2, 'confirmed', 'buyer', $1, CURRENT_TIMESTAMP) RETURNING id`,
      [A, B]
    );
    await query(
      `INSERT INTO supply_order_lines (order_id, buyer_item_id, vendor_item_id, item_name, qty, confirmed_qty, buyer_variant_id, sort_order)
       VALUES ($1, $2, $3, 'Cotton kurti – M', 2, 2, $4, 0), ($1, $2, $3, 'Cotton kurti – L', 3, 3, $5, 1)`,
      [order.id, KURTI2, VEND_KURTI, SIZE_M, SIZE_L]
    );

    // B has no address on file and the kurti has no HSN: both are flagged before billing.
    await query(`UPDATE businesses SET address_line1 = NULL WHERE id = $1`, [B]);
    await query(`UPDATE branches SET address_line1 = NULL WHERE business_id = $1`, [B]).catch(() => undefined);
    const octx = { params: { id: order.id } };
    const draft = await (await invoiceDraftGET(call('GET', `/api/supply-orders/${order.id}/invoice-draft`, UB, B), octx)).json();
    expect(draft.warnings.map((w: { code: string }) => w.code)).toEqual(['business_address', 'hsn', 'hsn']);
    expect(draft.lines.map((l: { name: string }) => l.name)).toEqual(['KURTI COTTON (M)', 'KURTI COTTON (L)']);

    // B bills it; A receives: 2 go to M and 3 to L.
    const BILL = randomUUID();
    await query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '29', 2000, 0, 0, 0, 0, 2000, 0, 2000, 'unpaid', $5)`,
      [BILL, B, CUST_A_AT_B, `KUR-${tag}`, BRB]
    );
    await query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, quantity, unit, unit_price, taxable_value, line_total, sort_order)
       VALUES ($1, $2, 'KURTI COTTON (M)', 2, 'PCS', 400, 800, 800, 0), ($1, $2, 'KURTI COTTON (L)', 3, 'PCS', 400, 1200, 1200, 1)`,
      [BILL, VEND_KURTI]
    );
    await query(`UPDATE supply_orders SET status = 'invoiced', invoice_id = $2 WHERE id = $1`, [order.id, BILL]);
    const rec = await convertInvoice(post(`/api/invoices/${BILL}/convert-to-purchase`, UA, A, {}), { params: { id: BILL } });
    const recBody = await rec.json();
    expect([rec.status, recBody.error]).toEqual([201, undefined]);
    const variants = await query(`SELECT id, current_stock FROM item_variants WHERE item_id = $1 ORDER BY variant_name DESC`, [KURTI2]);
    expect(variants.rows.map((v: any) => [v.id, Number(v.current_stock)])).toEqual([
      [SIZE_M, 2],
      [SIZE_L, 3],
    ]);
    const lines = await query(`SELECT variant_id FROM purchase_items WHERE purchase_id = $1 ORDER BY quantity`, [recBody.purchase.id]);
    expect(lines.rows.map((l: any) => l.variant_id)).toEqual([SIZE_M, SIZE_L]);
  });

  it('order list: pick items, suppliers fill in, one pick for the rest, one order per supplier', async () => {
    const NOSUP = randomUUID();
    const OFFLINE2 = randomUUID();
    await query(`INSERT INTO items (id, business_id, name, unit, item_type, is_active, rack) VALUES ($1, $2, 'Matchbox', 'PCS', 'goods', true, 'C1')`, [NOSUP, A]);
    await query(`INSERT INTO suppliers (id, business_id, name, phone) VALUES ($1, $2, 'Local Agencies', '9811111111')`, [OFFLINE2, A]);
    await query(`UPDATE items SET default_supplier_id = $2 WHERE id = $1`, [ITEM_A, supplierRowId]);

    await orderListPOST(post('/api/purchases/order-list', UA, A, { item_id: ITEM_A, qty: 24 }));
    const added = await (await orderListPOST(post('/api/purchases/order-list', UA, A, { item_id: NOSUP, qty: 10 }))).json();
    const byItem = new Map(added.lines.map((l: any) => [l.item_id, l]));
    expect(byItem.get(ITEM_A)).toMatchObject({ supplier_id: supplierRowId, way: 'hub', qty: 24 });
    expect(byItem.get(NOSUP)).toMatchObject({ supplier_id: null, rack: 'C1' });
    // Another business cannot see this list.
    expect((await (await orderListGET(call('GET', '/api/purchases/order-list', UC, C))).json()).lines).toHaveLength(0);

    // Nothing is sent while an item has no supplier.
    const early = await orderListSend(post('/api/purchases/order-list/send', UA, A, {}));
    expect(early.status).toBe(400);
    expect((await early.json()).error).toContain('Choose a supplier for 1 item');

    const noSupLine = (byItem.get(NOSUP) as any).id;
    const assigned = await (
      await orderListAssign(post('/api/purchases/order-list/assign', UA, A, { line_ids: [noSupLine], supplier_id: OFFLINE2 }))
    ).json();
    expect(assigned.lines.find((l: any) => l.item_id === NOSUP)).toMatchObject({ supplier_id: OFFLINE2, way: 'whatsapp' });
    expect((await queryOne(`SELECT default_supplier_id FROM items WHERE id = $1`, [NOSUP])).default_supplier_id).toBe(OFFLINE2);

    const sent = await orderListSend(post('/api/purchases/order-list/send', UA, A, {}));
    const { results } = await sent.json();
    expect(sent.status).toBe(200);
    const hub = results.find((r: any) => r.way === 'hub');
    const wa = results.find((r: any) => r.way === 'whatsapp');
    expect(hub).toMatchObject({ supplier_id: supplierRowId, items: 1 });
    expect((await queryOne(`SELECT status, buyer_business_id FROM supply_orders WHERE id = $1`, [hub.order_id]))).toMatchObject({
      status: 'pending',
      buyer_business_id: A,
    });
    expect(wa).toMatchObject({ supplier_id: OFFLINE2, phone: '9811111111' });
    expect(wa.message).toContain('Matchbox: 10 PCS');
    expect(wa.link).toContain('/so/');

    // The sent list is closed; the next visit starts a fresh one, with the item remembered.
    const fresh = await (await orderListGET(call('GET', '/api/purchases/order-list', UA, A))).json();
    expect(fresh.lines).toHaveLength(0);
    const again = await (await orderListPOST(post('/api/purchases/order-list', UA, A, { item_id: NOSUP, qty: 5 }))).json();
    expect(again.lines[0]).toMatchObject({ supplier_id: OFFLINE2 });
    await query(`DELETE FROM supplier_invite_orders WHERE supplier_id = $1`, [OFFLINE2]);
  });

  it('a queued low-stock check runs after the stock change is saved', async () => {
    const item = randomUUID();
    await query(`UPDATE suppliers SET allow_low_stock_access = true WHERE id = $1`, [supplierRowId]);
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, min_stock, current_stock, is_active, default_supplier_id)
       VALUES ($1, $2, 'Monaco 75g', 'PCS', 'goods', 6, 2, true, $3)`,
      [item, A, supplierRowId]
    );
    queueLowStockCheck(A, item);
    expect(await queryOne(`SELECT id FROM low_stock_alerts WHERE item_id = $1`, [item])).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const alert = await queryOne(`SELECT supplier_business_id FROM low_stock_alerts WHERE item_id = $1`, [item]);
    expect(alert?.supplier_business_id).toBe(B);
  });
});
