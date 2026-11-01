/**
 * Return actions over HTTP: approving books the courier pickup after the approval commits, reject
 * cancels a live pickup in Shiprocket first, a refund to the original payment goes through the
 * gateway, pickup details are checked, and the shopper sees pickup tracking but not staff-only events.
 *
 * Fakes come in through module mocks: `createShiprocketClient` (lib/store/delivery/shiprocket) returns
 * a fake client, `loadShiprocketCreds` (lib/store/delivery) says which test business is connected,
 * `razorpayRefundRequester` (lib/store/store-refund) returns a fake gateway, and WhatsApp sends are
 * captured at `notifyBusinessEvent` (lib/whatsapp/tenant-send).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const mockShiprocket = { bookReturn: jest.fn(), cancelOrders: jest.fn() };
const mockConnected = new Set<string>();
const mockRequester = jest.fn();
const mockNotify = jest.fn(async (_input: { eventKey: string; fallbackText?: string }) => undefined);

jest.mock('@/lib/store/delivery/shiprocket', () => ({
  ...jest.requireActual('@/lib/store/delivery/shiprocket'),
  createShiprocketClient: jest.fn(() => mockShiprocket),
}));
jest.mock('@/lib/store/delivery', () => ({
  ...jest.requireActual('@/lib/store/delivery'),
  loadShiprocketCreds: jest.fn(async (businessId: string) =>
    mockConnected.has(businessId) ? { email: 'returns@test.local', password: 'not-a-secret' } : null,
  ),
}));
jest.mock('@/lib/store/store-refund', () => ({
  ...jest.requireActual('@/lib/store/store-refund'),
  razorpayRefundRequester: jest.fn(async () => (args: unknown) => mockRequester(args)),
}));
jest.mock('@/lib/whatsapp/tenant-send', () => ({
  ...jest.requireActual('@/lib/whatsapp/tenant-send'),
  notifyBusinessEvent: (input: { eventKey: string; fallbackText?: string }) => mockNotify(input),
}));
jest.mock('@/lib/fulfilment/notify-trigger', () => ({ triggerFulfilmentNotification: jest.fn() }));
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
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
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'order-returns-api-test-secret';

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createInvoiceForStoreOrder, fulfillStoreOrderPayment } from '@/lib/store/fulfill-paid-order';
import { ensureFulfilment, setFulfilmentShipping, transitionFulfilment } from '@/lib/fulfilment/service';
import { createReturn, receiveReturn } from '@/lib/returns/service';
import { applyReturnGatewayRefundResult } from '@/lib/returns/gateway-refund';
import { signStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import type { ShiprocketBooking } from '@/lib/store/delivery/shiprocket';
import { GET as getReturnRoute, PATCH as patchReturnRoute } from '@/app/api/returns/[id]/route';
import { GET as listReturnsRoute, POST as postReturnsRoute } from '@/app/api/returns/route';
import { GET as getStoreReturn, POST as postStoreReturn } from '@/app/api/public/store/[subdomain]/orders/[id]/return/route';

d('return API actions (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const OTHER = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const A2 = randomUUID();
  const ITEM = randomUUID();
  const SHOPPER = randomUUID();
  const tag = B.slice(0, 8);
  const SUB = `rapi-${tag}`;
  const PHONE = `96${String(Date.now()).slice(-8)}`;
  let seq = 0;

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  const staff = (user = A, business = B) => ({
    'content-type': 'application/json',
    'x-authenticated-user-id': user,
    'x-authenticated-business-id': business,
  });

  async function patch(id: string, body: Record<string, unknown>, user = A, business = B) {
    const res = await patchReturnRoute(
      new NextRequest(`http://localhost/api/returns/${id}`, { method: 'PATCH', headers: staff(user, business), body: JSON.stringify(body) }),
      { params: { id } },
    );
    return { status: res.status, json: (await res.json()) as any };
  }

  async function getOne(id: string) {
    const res = await getReturnRoute(new NextRequest(`http://localhost/api/returns/${id}`, { headers: staff() }), { params: { id } });
    return { status: res.status, json: (await res.json()) as any };
  }

  const asShopper = (orderId: string, body?: unknown) =>
    new NextRequest(`http://localhost/api/public/store/${SUB}/orders/${orderId}/return`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', cookie: `${STORE_CUSTOMER_COOKIE}=${signStoreCustomer(B, SHOPPER)}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  const storeCtx = (id: string) => ({ params: { subdomain: SUB, id } });

  /**
   * A billed store order of one widget (₹100 + 18% GST) for the shopper. `paid` goes through the real
   * gateway path (verified payment -> bill with its receipt); otherwise the parcel is delivered to a
   * Pune address, so a pickup can be prefilled from it.
   */
  async function order(opts: { paid?: boolean } = {}): Promise<{ orderId: string; invoiceId: string }> {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone, store_customer_id,
          status, payment_status, payment_provider, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Asha Rao',$5,$6,'confirmed',$7,$8,100,18,0,0,118,'delivery')`,
      [id, B, BR, `RA-${tag}-${seq}`, PHONE, SHOPPER, opts.paid ? 'unpaid' : 'cod', opts.paid ? 'razorpay' : null],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',1,'PCS',100,18,118)`,
      [id, ITEM],
    );
    if (opts.paid) {
      const out = await fulfillStoreOrderPayment(id, B, {
        provider: 'razorpay',
        idempotencyKey: `ra-${id}`,
        amount: 118,
        payload: '{}',
        providerPaymentId: `pay_${id.slice(0, 12)}`,
      });
      expect(out.outcome).not.toBe('rejected');
      const inv = (await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [id])).rows[0].invoice_id as string;
      return { orderId: id, invoiceId: inv };
    }
    const invoiceId = (await createInvoiceForStoreOrder(id, B, A))!;
    await tx(async (c) => {
      const { row } = await ensureFulfilment(c, {
        businessId: B,
        channel: 'online_store',
        storeOrderId: id,
        invoiceId,
        branchId: BR,
        buyerName: 'Asha Rao',
        buyerPhone: `+91 ${PHONE}`,
        status: 'confirmed',
        method: 'own_rider',
        codAmount: 0,
        actorType: 'staff',
        actorUserId: A,
      });
      await setFulfilmentShipping(c, {
        businessId: B,
        fulfilmentId: row.id,
        address: '12 MG Road, Kothrud, Pune, Maharashtra',
        pincode: '411038',
        weightKg: 1.2,
      });
      for (const to of ['packed', 'shipped', 'delivered'] as const) {
        const moved = await transitionFulfilment(c, { businessId: B, fulfilmentId: row.id, to, actorType: 'staff', actorUserId: A, skipPaymentGate: true });
        expect(moved.ok).toBe(true);
      }
    });
    return { orderId: id, invoiceId };
  }

  async function customerRequest(invoiceId: string): Promise<string> {
    return tx((c) => createReturn(c, { businessId: B, invoiceId, reason: 'size_fit', initiatedBy: 'customer' }));
  }

  async function returnRow(id: string) {
    return (await pool.query(`SELECT * FROM order_returns WHERE id = $1`, [id])).rows[0];
  }

  const booked = (n: number): ShiprocketBooking => ({
    ok: true,
    orderId: `9${n}${seq}`,
    shipmentId: `8${n}${seq}`,
    awb: `RA${tag}${n}${seq}`,
    courierName: 'Delhivery',
    trackingUrl: `https://shiprocket.co/tracking/RA${tag}${n}${seq}`,
    pickupScheduledAt: '2026-11-04 11:00:00',
  });

  const sent = (eventKey: string) => mockNotify.mock.calls.map((c) => c[0]).filter((c) => c.eventKey === eventKey);

  beforeAll(async () => {
    pool = getPool();
    for (const [id, nm] of [[B, `Returns API ${tag}`], [OTHER, `Other ${tag}`]] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '27', 'regular')`,
        [id, nm, `27AABCR${id.slice(0, 4).toUpperCase()}A1Z5`],
      );
    }
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk', $3, true)`, [A, B, `91${PHONE}`]);
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Other', $3, true)`, [
      A2,
      OTHER,
      `92${PHONE}`,
    ]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac, current_stock)
       VALUES ($1, $2, 'Widget', 'goods', 'PCS', 100, 40, 18, '847130', 100)`,
      [ITEM, B],
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,100)
       ON CONFLICT (business_id, branch_id, item_id) DO UPDATE SET quantity = 100`,
      [B, BR, ITEM],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled, store_return_window_days) VALUES ($1, $2, true, 7)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain, store_enabled = true, store_return_window_days = 7`,
      [B, SUB],
    );
    await pool.query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, 'Asha Rao')`, [SHOPPER, B, PHONE]);
  });

  beforeEach(() => {
    mockShiprocket.bookReturn.mockReset();
    mockShiprocket.cancelOrders.mockReset().mockResolvedValue(undefined);
    mockRequester.mockReset();
    mockNotify.mockClear();
    mockConnected.clear();
    mockConnected.add(B);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM return_gateway_refunds WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM credit_note_refunds WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM notifications WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM order_returns WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM store_orders WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM store_customers WHERE business_id = $1`, [B]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('approve without a method books a pickup when Shiprocket is connected', async () => {
    const { invoiceId } = await order();
    const id = await customerRequest(invoiceId);
    const b = booked(1);
    mockShiprocket.bookReturn.mockResolvedValueOnce(b);

    const res = await patch(id, { action: 'approve' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, pickup: { ok: true, awb: b.awb, courierName: 'Delhivery' } });
    expect(mockShiprocket.bookReturn).toHaveBeenCalledTimes(1);
    expect(mockShiprocket.bookReturn.mock.calls[0][0]).toMatchObject({ pincode: '411038', address: '12 MG Road, Kothrud, Pune, Maharashtra' });
    expect(await returnRow(id)).toMatchObject({ status: 'approved', return_method: 'courier_pickup', pickup_status: 'booked', awb: b.awb });

    // The approval message goes after the booking, so it carries the AWB.
    const approved = sent('return_approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].fallbackText).toContain(`Pickup booked with Delhivery, AWB ${b.awb}.`);

    const got = await getOne(id);
    expect(got.status).toBe(200);
    expect(got.json.return).toMatchObject({
      method: 'courier_pickup',
      pickup_status: 'booked',
      awb: b.awb,
      tracking_url: b.trackingUrl,
      shiprocket_connected: true,
      pickup: { address: '12 MG Road, Kothrud, Pune, Maharashtra', pincode: '411038', weight_kg: 1.2 },
      original_refund: { allowed: false, max: 0 },
      gateway_refund: null,
    });
    expect(typeof got.json.return.default_instructions).toBe('string');
    expect(got.json.return.events.map((e: { kind: string }) => e.kind)).toEqual(['requested', 'approved', 'pickup_booked']);

    // Without Shiprocket the shop's default is "customer sends it", with the shop address as instructions.
    mockConnected.clear();
    const { invoiceId: inv2 } = await order();
    const id2 = await customerRequest(inv2);
    const res2 = await patch(id2, { action: 'approve' });
    expect(res2.status).toBe(200);
    expect(res2.json.pickup).toBeUndefined();
    expect(mockShiprocket.bookReturn).toHaveBeenCalledTimes(1);
    const row2 = await returnRow(id2);
    expect(row2).toMatchObject({ return_method: 'customer_sends' });
    expect(row2.return_instructions).toMatch(/^Please send it/);
  });

  test('a failed booking says the pickup details will follow, and Book again sends the pickup notice', async () => {
    const { invoiceId } = await order();
    const id = await customerRequest(invoiceId);
    mockShiprocket.bookReturn.mockResolvedValueOnce({ ok: false, orderId: `55${seq}`, shipmentId: `66${seq}`, error: 'Wallet balance is low' });

    const res = await patch(id, { action: 'approve', method: 'courier_pickup' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, pickup: { ok: false, code: 'BOOKING_FAILED', error: 'Wallet balance is low' } });
    expect(res.json.return).toMatchObject({ status: 'approved', pickup_error: 'Wallet balance is low' });
    const approved = sent('return_approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].fallbackText).not.toContain('Pickup booked');
    expect(approved[0].fallbackText).toContain('We will send you the pickup details soon.');

    const b = booked(2);
    mockShiprocket.bookReturn.mockResolvedValueOnce(b);
    const again = await patch(id, { action: 'book_pickup' });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, pickup: { ok: true, awb: b.awb } });
    // The retry continues the half-made Shiprocket order instead of making a second one.
    expect(mockShiprocket.bookReturn.mock.calls[1][1]).toMatchObject({ orderId: `55${seq}`, shipmentId: `66${seq}` });
    const notice = sent('return_pickup_booked');
    expect(notice).toHaveLength(1);
    expect(notice[0].fallbackText).toContain(`AWB ${b.awb}`);

    // A booked pickup is not booked twice.
    const twice = await patch(id, { action: 'book_pickup' });
    expect(twice.status).toBe(409);
    expect(mockShiprocket.bookReturn).toHaveBeenCalledTimes(2);
  });

  test("approve for another business's return is 404", async () => {
    const { invoiceId } = await order();
    const id = await customerRequest(invoiceId);
    const res = await patch(id, { action: 'approve', method: 'customer_sends' }, A2, OTHER);
    expect(res.status).toBe(404);
    expect(await returnRow(id)).toMatchObject({ status: 'requested', return_method: null });
    expect(mockShiprocket.bookReturn).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect((await getReturnRoute(new NextRequest(`http://localhost/api/returns/${id}`, { headers: staff(A2, OTHER) }), { params: { id } })).status).toBe(404);
  });

  test('reject with a live pickup cancels it in Shiprocket first', async () => {
    const { invoiceId } = await order();
    const id = await customerRequest(invoiceId);
    const b = booked(3);
    mockShiprocket.bookReturn.mockResolvedValueOnce(b);
    expect((await patch(id, { action: 'approve', method: 'courier_pickup' })).json.pickup.ok).toBe(true);

    // Shiprocket refuses: the return stays approved with its pickup.
    mockShiprocket.cancelOrders.mockRejectedValueOnce(new Error('Order is already picked up'));
    const refused = await patch(id, { action: 'reject', reason: 'Used item' });
    expect(refused.status).toBe(502);
    expect(refused.json.error).toBe('Order is already picked up');
    expect(await returnRow(id)).toMatchObject({ status: 'approved', pickup_status: 'booked', awb: b.awb });

    const res = await patch(id, { action: 'reject', reason: 'Used item' });
    expect(res.status).toBe(200);
    expect(mockShiprocket.cancelOrders).toHaveBeenLastCalledWith([b.orderId]);
    expect(await returnRow(id)).toMatchObject({ status: 'rejected', pickup_status: 'cancelled', awb: null, rejected_reason: 'Used item' });
    const rejected = sent('return_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].fallbackText).toContain('was not accepted: Used item');
  });

  test('reject while the pickup is being booked waits for the booking (409)', async () => {
    const { invoiceId } = await order();
    const id = await customerRequest(invoiceId);
    const b = booked(8);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockShiprocket.bookReturn.mockImplementationOnce(async () => {
      await gate;
      return b;
    });

    const approving = patch(id, { action: 'approve', method: 'courier_pickup' });
    for (let i = 0; i < 200 && mockShiprocket.bookReturn.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(mockShiprocket.bookReturn).toHaveBeenCalledTimes(1);

    const busyMessage = 'A pickup is already being booked for this return. Try again in a moment.';
    for (const body of [{ action: 'reject', reason: 'Used item' }, { action: 'cancel' }, { action: 'set_method', method: 'customer_sends' }, { action: 'book_pickup' }]) {
      const res = await patch(id, body);
      expect(res.status).toBe(409);
      expect(res.json).toMatchObject({ error: busyMessage, code: 'PICKUP_BUSY' });
    }

    release();
    const approved = await approving;
    expect(approved.json.pickup).toMatchObject({ ok: true, awb: b.awb });
    expect(await returnRow(id)).toMatchObject({ status: 'approved', pickup_status: 'booked', awb: b.awb });
    expect(mockShiprocket.bookReturn).toHaveBeenCalledTimes(1);
    expect(sent('return_rejected')).toHaveLength(0);
  });

  test('settle original_payment refunds through the gateway and reports pending', async () => {
    const { invoiceId } = await order({ paid: true });
    const id = await tx((c) => createReturn(c, { businessId: B, invoiceId, reason: 'wrong_item', initiatedBy: 'merchant', userId: A }));
    await tx((c) => receiveReturn(c, { businessId: B, returnId: id, userId: A }));
    const refundId = `rfnd_${randomUUID().slice(0, 8)}`;
    mockRequester.mockResolvedValueOnce({ providerRefundId: refundId, status: 'pending' });

    const before = await getOne(id);
    expect(before.json.return.original_refund).toMatchObject({ allowed: true, max: 118, reason: null });

    const res = await patch(id, { action: 'settle', refund: { method: 'original_payment' } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, refund: { status: 'pending', amount: 118, providerRefundId: refundId } });
    expect(mockRequester).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 11800 }));
    expect(res.json.return).toMatchObject({ status: 'received', gateway_refund: { status: 'pending', amount: 118, error: null } });
    expect(sent('return_refunded')).toHaveLength(0);

    const list = await listReturnsRoute(new NextRequest('http://localhost/api/returns?status=refund_pending', { headers: staff() }));
    const ids = ((await list.json()) as any).returns.map((r: { id: string }) => r.id);
    expect(ids).toContain(id);

    // The gateway's notice completes it: the money is settled, so now the customer hears about it, once.
    const row = (await pool.query(`SELECT id FROM return_gateway_refunds WHERE order_return_id = $1`, [id])).rows[0];
    const notice = { businessId: B, refundRowId: row.id, providerRefundId: refundId, providerStatus: 'processed' as const, actor: 'webhook' as const };
    expect(await applyReturnGatewayRefundResult(notice)).toBe('processed');
    expect(await applyReturnGatewayRefundResult(notice)).toBe('processed');
    const refunded = sent('return_refunded');
    expect(refunded).toHaveLength(1);
    expect(refunded[0].fallbackText).toBe('₹118 refunded to your original payment; it reaches you in 5–7 working days.');
    expect(await returnRow(id)).toMatchObject({ status: 'closed', refund_method: 'original_payment' });
  });

  test('receive with original_payment commits the receive, then refunds through the gateway', async () => {
    const { invoiceId } = await order({ paid: true });
    const id = await tx((c) => createReturn(c, { businessId: B, invoiceId, reason: 'wrong_item', initiatedBy: 'merchant', userId: A }));
    mockRequester.mockResolvedValueOnce({ providerRefundId: `rfnd_${randomUUID().slice(0, 8)}`, status: 'processed' });

    const res = await patch(id, { action: 'receive', refund: { method: 'original_payment' } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, credit_amount: 118, refund: { status: 'processed', amount: 118 } });
    expect(await returnRow(id)).toMatchObject({ status: 'closed', refund_method: 'original_payment' });
    expect(sent('return_received')).toHaveLength(1);
    expect(sent('return_refunded')).toHaveLength(1);
  });

  test('a pincode that is not 6 digits is refused', async () => {
    const { invoiceId } = await order();
    const id = await customerRequest(invoiceId);
    for (const pincode of ['4110', '41103a', '4110381']) {
      const res = await patch(id, { action: 'approve', method: 'courier_pickup', pickup: { pincode } });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('Enter a 6-digit PIN code');
    }
    expect(await returnRow(id)).toMatchObject({ status: 'requested' });
    expect(mockShiprocket.bookReturn).not.toHaveBeenCalled();

    // Package numbers that are not positive are ignored, not saved.
    mockShiprocket.bookReturn.mockResolvedValueOnce(booked(4));
    const ok = await patch(id, { action: 'approve', method: 'courier_pickup', pickup: { pincode: '411001', weight_kg: -2, length_cm: 'x', height_cm: 30 } });
    expect(ok.status).toBe(200);
    const row = await returnRow(id);
    expect(row.pickup_pincode).toBe('411001');
    expect(Number(row.pickup_weight_kg)).toBe(1.2);
    expect(Number(row.pickup_height_cm)).toBe(30);

    // A merchant-started return with a pickup is checked the same way, and booked after it is saved.
    const { invoiceId: inv2 } = await order();
    const bad = await postReturnsRoute(
      new NextRequest('http://localhost/api/returns', {
        method: 'POST',
        headers: staff(),
        body: JSON.stringify({ invoice_id: inv2, reason: 'damaged', method: 'courier_pickup', pickup: { pincode: '12' } }),
      }),
    );
    expect(bad.status).toBe(400);
    mockShiprocket.bookReturn.mockResolvedValueOnce(booked(5));
    const made = await postReturnsRoute(
      new NextRequest('http://localhost/api/returns', {
        method: 'POST',
        headers: staff(),
        body: JSON.stringify({ invoice_id: inv2, reason: 'damaged', method: 'courier_pickup' }),
      }),
    );
    expect(made.status).toBe(201);
    const madeJson = (await made.json()) as any;
    expect(madeJson.pickup).toMatchObject({ ok: true });
    expect(await returnRow(madeJson.id)).toMatchObject({ status: 'approved', return_method: 'courier_pickup', pickup_status: 'booked' });
  });

  test("the customer's return list shows the pickup tracking and hides staff-only events", async () => {
    const { orderId } = await order();
    const form = (await (await getStoreReturn(asShopper(orderId), storeCtx(orderId))).json()) as any;
    expect(form.can_return).toBe(true);
    const asked = await postStoreReturn(
      asShopper(orderId, { lines: [{ invoice_item_id: form.lines[0].invoice_item_id, quantity: 1 }], reason: 'size_fit' }),
      storeCtx(orderId),
    );
    expect(asked.status).toBe(201);
    const id = (await pool.query(`SELECT id FROM order_returns WHERE store_order_id = $1`, [orderId])).rows[0].id as string;
    // The shop hears about the new request.
    const inbox = await pool.query(`SELECT title FROM notifications WHERE business_id = $1 AND reference_type = 'order_return' AND reference_id = $2`, [B, id]);
    expect(inbox.rows.map((r) => r.title)).toEqual(['New return request']);

    mockShiprocket.bookReturn.mockResolvedValueOnce(booked(6));
    expect((await patch(id, { action: 'approve', method: 'courier_pickup' })).json.pickup.ok).toBe(true);
    expect((await patch(id, { action: 'cancel_pickup' })).status).toBe(200);
    const b = booked(7);
    mockShiprocket.bookReturn.mockResolvedValueOnce(b);
    expect((await patch(id, { action: 'book_pickup' })).json.pickup.ok).toBe(true);

    const got = (await (await getStoreReturn(asShopper(orderId), storeCtx(orderId))).json()) as any;
    expect(got.returns).toHaveLength(1);
    expect(got.returns[0]).toMatchObject({
      status: 'approved',
      method: 'courier_pickup',
      pickup_status: 'booked',
      awb: b.awb,
      tracking_url: b.trackingUrl,
      refund_method: null,
      gateway_refund_status: null,
    });
    const kinds = got.returns[0].events.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(['requested', 'approved', 'pickup_booked', 'pickup_booked']);
    expect(kinds).not.toContain('pickup_cancelled');
    for (const e of got.returns[0].events) expect(Object.keys(e).sort()).toEqual(['created_at', 'kind', 'note']);
  });

  test("a return the shop started does not show the staff's note to the shopper", async () => {
    const { orderId, invoiceId } = await order();
    await tx((c) =>
      createReturn(c, { businessId: B, invoiceId, reason: 'other', reasonNote: 'internal: customer was rude', initiatedBy: 'merchant', userId: A }),
    );
    const got = (await (await getStoreReturn(asShopper(orderId), storeCtx(orderId))).json()) as any;
    expect(got.returns).toHaveLength(1);
    const requested = got.returns[0].events.find((e: { kind: string }) => e.kind === 'requested');
    expect(requested).toMatchObject({ kind: 'requested', note: null });
    expect(JSON.stringify(got)).not.toContain('customer was rude');
    expect(got.returns[0].initiated_by).toBeUndefined();
  });
});
