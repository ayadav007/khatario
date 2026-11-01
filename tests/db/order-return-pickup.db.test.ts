/**
 * Return pickup booking: approving a return with a courier pickup books it with Shiprocket from the
 * customer's address, a failed step keeps Shiprocket's ids so "Book again" continues, a cancel and
 * re-book gets a new reference, and nothing crosses businesses.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

// The webhook route sends buyer messages for forward parcels; none are wanted here.
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
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';
import { ensureFulfilment, setFulfilmentShipping } from '@/lib/fulfilment/service';
import { approveReturn, createReturn, returnableLines, setReturnMethod } from '@/lib/returns/service';
import { bookReturnPickup, cancelAbandonedOrder, cancelReturnPickup, hasLivePickup } from '@/lib/returns/pickup';
import { listReturnEvents } from '@/lib/returns/events';
import { hashStoreWebhookToken } from '@/lib/store/delivery/webhooks';
import { POST as shiprocketWebhook } from '@/app/api/webhooks/store/shiprocket/route';
import type { ShiprocketBooking, ShiprocketClient, ShiprocketReturnParcel } from '@/lib/store/delivery/shiprocket';

function fakeClient(bookResults: ShiprocketBooking[] = []) {
  const bookReturn = jest.fn(
    async (_p: ShiprocketReturnParcel, _e?: { orderId?: string | null; shipmentId?: string | null }) => {
      const next = bookResults.shift();
      if (!next) throw new Error('unexpected bookReturn call');
      return next;
    },
  );
  const client = { bookReturn, cancelOrders: jest.fn(async (_ids: string[]) => undefined) };
  return client as typeof client & ShiprocketClient;
}

d('return pickup booking (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const OTHER = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const ITEM = randomUUID();
  const tag = B.slice(0, 8);
  const PHONE = `97${String(Date.now()).slice(-8)}`;
  const TOKEN_B = `retpick${tag}${'b'.repeat(24)}`;
  const TOKEN_OTHER = `retother${tag}${'c'.repeat(24)}`;
  let seq = 0;

  /** Posts a tracking event to the webhook route as the business that owns `token`. */
  async function postTracking(body: Record<string, unknown>, token = TOKEN_B) {
    const res = await shiprocketWebhook(
      new NextRequest('http://localhost/api/webhooks/store/shiprocket', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': token },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as any };
  }

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

  /**
   * A billed store order of `qty` widgets (₹100 + 18% GST) whose parcel was sent to a Pune
   * address, with a customer-requested return of `returnQty` approved with a courier pickup.
   */
  async function approvedPickup(opts: { qty?: number; returnQty?: number; parcelPhone?: string } = {}) {
    const qty = opts.qty ?? 1;
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Asha Rao',$5,'confirmed','cod',$6,$7,0,0,$8,'delivery')`,
      [id, B, BR, `RP-${tag}-${seq}`, `+91 ${PHONE}`, qty * 100, qty * 18, qty * 118],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',$3,'PCS',100,18,$4)`,
      [id, ITEM, qty, qty * 118],
    );
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
      // The bill may already have its parcel (made with the order), so set the phone on whichever row it is.
      if (opts.parcelPhone) await c.query(`UPDATE order_fulfilments SET buyer_phone = $2 WHERE id = $1`, [row.id, opts.parcelPhone]);
      await setFulfilmentShipping(c, {
        businessId: B,
        fulfilmentId: row.id,
        address: '12 MG Road, Kothrud, Pune, Maharashtra',
        pincode: '411038',
        weightKg: 1.2,
        lengthCm: 20,
        breadthCm: 15,
        heightCm: 8,
      });
    });
    const [line] = await returnableLines(pool, B, invoiceId);
    const returnId = await tx((c) =>
      createReturn(c, {
        businessId: B,
        invoiceId,
        lines: [{ invoice_item_id: line.invoice_item_id, quantity: opts.returnQty ?? qty }],
        reason: 'size_fit',
        initiatedBy: 'customer',
      }),
    );
    const approved = await tx((c) =>
      approveReturn(c, { businessId: B, returnId, userId: A, method: 'courier_pickup' }),
    );
    expect(approved).toMatchObject({ method: 'courier_pickup', needsPickup: true });
    return { returnId, invoiceId };
  }

  async function returnRow(id: string) {
    return (await pool.query(`SELECT * FROM order_returns WHERE id = $1`, [id])).rows[0];
  }

  const booked = (n: number, extra: Partial<ShiprocketBooking> = {}): ShiprocketBooking => ({
    ok: true,
    orderId: `7${n}`,
    shipmentId: `8${n}`,
    awb: `RAWB${tag}${n}`,
    courierName: 'Delhivery',
    trackingUrl: `https://shiprocket.co/tracking/RAWB${tag}${n}`,
    pickupScheduledAt: '2026-11-04 11:00:00',
    ...extra,
  });

  beforeAll(async () => {
    pool = getPool();
    for (const [id, nm] of [[B, `Pickup ${tag}`], [OTHER, `Other ${tag}`]] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '27', 'regular')`,
        [id, nm, `27AABCR${id.slice(0, 4).toUpperCase()}A1Z5`],
      );
    }
    for (const [biz, token] of [[B, TOKEN_B], [OTHER, TOKEN_OTHER]] as const) {
      await pool.query(
        `INSERT INTO business_settings (business_id, store_shiprocket_webhook_token_hash) VALUES ($1, $2)
         ON CONFLICT (business_id) DO UPDATE SET store_shiprocket_webhook_token_hash = EXCLUDED.store_shiprocket_webhook_token_hash`,
        [biz, hashStoreWebhookToken(token)],
      );
    }
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk', $3, true)`, [
      A,
      B,
      `95${PHONE}`,
    ]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac, current_stock)
       VALUES ($1, $2, 'Widget', 'goods', 'PCS', 100, 40, 18, '847130', 50)`,
      [ITEM, B],
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,50)
       ON CONFLICT (business_id, branch_id, item_id) DO UPDATE SET quantity = 50`,
      [B, BR, ITEM],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM order_returns WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM store_orders WHERE business_id = $1`, [B]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test("approving with courier pickup books it with the parcel's address and the return number", async () => {
    const { returnId } = await approvedPickup();
    const before = await returnRow(returnId);
    expect(before).toMatchObject({
      status: 'approved',
      return_method: 'courier_pickup',
      pickup_pincode: '411038',
      pickup_address: '12 MG Road, Kothrud, Pune, Maharashtra',
    });
    expect(before.pickup_phone).toContain(PHONE);

    const client = fakeClient([booked(1)]);
    const res = await bookReturnPickup(B, returnId, { client, actorUserId: A });
    expect(res).toMatchObject({ ok: true, courierName: 'Delhivery' });

    const [parcel, existing] = client.bookReturn.mock.calls[0];
    expect(parcel).toMatchObject({
      ref: before.return_number,
      customerName: 'Asha Rao',
      customerPhone: PHONE,
      pincode: '411038',
      address: '12 MG Road, Kothrud, Pune, Maharashtra',
      weightKg: 1.2,
      lengthCm: 20,
      breadthCm: 15,
      heightCm: 8,
      subTotal: 118,
    });
    expect(parcel.ref).toMatch(/^RET-\d{4}$/);
    expect(parcel.items).toEqual([expect.objectContaining({ name: 'Widget', units: 1, price: 118, reason: 'Size or fit' })]);
    expect(existing).toMatchObject({ orderId: null, shipmentId: null });

    const row = await returnRow(returnId);
    expect(row).toMatchObject({
      awb: `RAWB${tag}1`,
      pickup_status: 'booked',
      carrier_order_id: '71',
      carrier_shipment_id: '81',
      courier_name: 'Delhivery',
      pickup_error: null,
      status: 'approved',
    });
    expect(row.pickup_scheduled_at).not.toBeNull();
    expect(hasLivePickup(row)).toBe(true);
    const events = await listReturnEvents(pool, B, returnId);
    expect(events.map((e) => e.kind)).toEqual(['requested', 'approved', 'pickup_booked']);
  });

  test("a part return uses the default package, not the whole parcel's", async () => {
    const { returnId } = await approvedPickup({ qty: 2, returnQty: 1 });
    const row = await returnRow(returnId);
    expect(Number(row.pickup_weight_kg)).toBe(0.5);
    expect(Number(row.pickup_length_cm)).toBe(10);
    expect(Number(row.pickup_height_cm)).toBe(10);
  });

  test("a failed AWB step keeps Shiprocket's ids and Book again continues", async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([
      { ok: false, stage: 'return_awb', orderId: '77', shipmentId: '88', error: 'Wallet balance low' },
      booked(2, { orderId: '77', shipmentId: '88' }),
    ]);
    const first = await bookReturnPickup(B, returnId, { client });
    expect(first).toMatchObject({ ok: false, code: 'BOOKING_FAILED', error: 'Wallet balance low' });
    const failed = await returnRow(returnId);
    expect(failed).toMatchObject({
      pickup_error: 'Wallet balance low',
      status: 'approved',
      carrier_order_id: '77',
      carrier_shipment_id: '88',
      awb: null,
      pickup_status: null,
    });
    expect(hasLivePickup(failed)).toBe(false);

    const second = await bookReturnPickup(B, returnId, { client });
    expect(second.ok).toBe(true);
    expect(client.bookReturn.mock.calls[1][1]).toMatchObject({ orderId: '77', shipmentId: '88' });
    expect(client.bookReturn.mock.calls[1][0].ref).toBe(client.bookReturn.mock.calls[0][0].ref);
    const row = await returnRow(returnId);
    expect(row).toMatchObject({ pickup_status: 'booked', pickup_error: null });
  });

  test('a pickup Shiprocket could not request is kept as a warning on a booked return', async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([booked(3, { stage: 'pickup', error: 'Pickup slot unavailable' })]);
    const res = await bookReturnPickup(B, returnId, { client });
    expect(res).toMatchObject({ ok: true, warning: expect.stringContaining('Pickup slot unavailable') });
    expect(await returnRow(returnId)).toMatchObject({ pickup_status: 'booked', pickup_error: 'Pickup slot unavailable' });
  });

  test('a live pickup is not booked twice', async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([booked(4)]);
    await bookReturnPickup(B, returnId, { client });
    const again = await bookReturnPickup(B, returnId, { client });
    expect(again).toMatchObject({ ok: true, awb: `RAWB${tag}4` });
    expect(client.bookReturn).toHaveBeenCalledTimes(1);
  });

  test('cancel then re-book uses RET-xxxx-2', async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([booked(5), booked(6)]);
    await bookReturnPickup(B, returnId, { client });
    const number = (await returnRow(returnId)).return_number as string;

    expect(await cancelReturnPickup(B, returnId, { client, actorUserId: A })).toEqual({ ok: true });
    expect(client.cancelOrders).toHaveBeenCalledWith(['75']);
    const cancelled = await returnRow(returnId);
    expect(cancelled).toMatchObject({
      pickup_status: 'cancelled',
      pickup_attempt: 1,
      carrier_order_id: null,
      carrier_shipment_id: null,
      awb: null,
      tracking_url: null,
    });
    expect(hasLivePickup(cancelled)).toBe(false);
    expect(await cancelReturnPickup(B, returnId, { client })).toMatchObject({ ok: false, status: 409 });

    const second = await bookReturnPickup(B, returnId, { client });
    expect(second.ok).toBe(true);
    expect(client.bookReturn.mock.calls[0][0].ref).toBe(number);
    expect(client.bookReturn.mock.calls[1][0].ref).toBe(`${number}-2`);
    expect(client.bookReturn.mock.calls[1][1]).toMatchObject({ orderId: null, shipmentId: null });
    const events = await listReturnEvents(pool, B, returnId);
    expect(events.map((e) => e.kind)).toEqual(['requested', 'approved', 'pickup_booked', 'pickup_cancelled', 'pickup_booked']);
  });

  test('Shiprocket not connected leaves the return approved with a reason', async () => {
    const { returnId } = await approvedPickup();
    const res = await bookReturnPickup(B, returnId);
    expect(res).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
    const row = await returnRow(returnId);
    expect(row.status).toBe('approved');
    expect(row.pickup_error).toMatch(/^Connect Shiprocket/);

    const client = fakeClient([booked(7)]);
    expect((await bookReturnPickup(B, returnId, { client })).ok).toBe(true);
    expect((await returnRow(returnId)).pickup_error).toBeNull();
  });

  test('a phone with fewer than 10 digits is refused', async () => {
    const { returnId } = await approvedPickup({ parcelPhone: '98765' });
    const client = fakeClient();
    const res = await bookReturnPickup(B, returnId, { client });
    expect(res).toMatchObject({ ok: false, code: 'NO_PHONE' });
    expect(client.bookReturn).not.toHaveBeenCalled();
    expect((await returnRow(returnId)).pickup_error).toMatch(/phone/i);
  });

  test('a return that is not approved for courier pickup cannot be booked', async () => {
    const { returnId } = await approvedPickup();
    await pool.query(`UPDATE order_returns SET return_method = 'customer_sends' WHERE id = $1`, [returnId]);
    expect(await bookReturnPickup(B, returnId, { client: fakeClient() })).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
    await pool.query(`UPDATE order_returns SET return_method = 'courier_pickup', status = 'cancelled' WHERE id = $1`, [returnId]);
    expect(await bookReturnPickup(B, returnId, { client: fakeClient() })).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
  });

  test('a parcel already on its way back is never booked again', async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([booked(9)]);
    await bookReturnPickup(B, returnId, { client });
    for (const status of ['in_transit', 'arrived']) {
      await pool.query(`UPDATE order_returns SET pickup_status = $2 WHERE id = $1`, [returnId, status]);
      const res = await bookReturnPickup(B, returnId, { client });
      expect(res).toMatchObject({ ok: false, code: 'NOT_APPROVED', error: expect.stringContaining('on its way back') });
    }
    expect(client.bookReturn).toHaveBeenCalledTimes(1);
    expect(await returnRow(returnId)).toMatchObject({ pickup_status: 'arrived', awb: `RAWB${tag}9`, carrier_order_id: '79' });
  });

  test('a corrected address after a failed booking is sent to Shiprocket as a new order', async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([
      { ok: false, stage: 'return_awb', orderId: '501', shipmentId: '601', error: 'Pickup pincode not serviceable' },
      booked(10, { orderId: '502', shipmentId: '602' }),
    ]);
    const first = await bookReturnPickup(B, returnId, { client });
    expect(first).toMatchObject({ ok: false, code: 'BOOKING_FAILED' });
    const number = (await returnRow(returnId)).return_number as string;
    expect(await returnRow(returnId)).toMatchObject({ carrier_order_id: '501', carrier_shipment_id: '601' });

    // Saving the same details changes nothing: Book again would still continue the old order.
    const same = await tx((c) => setReturnMethod(c, { businessId: B, returnId, method: 'courier_pickup' }));
    expect(same.abandonedOrderId).toBeUndefined();
    expect(await returnRow(returnId)).toMatchObject({ carrier_order_id: '501', pickup_attempt: 0 });

    const fixed = await tx((c) =>
      setReturnMethod(c, { businessId: B, returnId, method: 'courier_pickup', pickup: { pincode: '560001', address: '4 Church Street, Bengaluru' } }),
    );
    expect(fixed).toMatchObject({ needsPickup: true, abandonedOrderId: '501' });
    expect(await returnRow(returnId)).toMatchObject({
      carrier_order_id: null,
      carrier_shipment_id: null,
      pickup_attempt: 1,
      pickup_pincode: '560001',
      pickup_error: null,
    });

    const second = await bookReturnPickup(B, returnId, { client, abandonedOrderId: fixed.abandonedOrderId });
    expect(second.ok).toBe(true);
    expect(client.cancelOrders).toHaveBeenCalledWith(['501']);
    const [parcel, existing] = client.bookReturn.mock.calls[1];
    expect(parcel).toMatchObject({ ref: `${number}-2`, pincode: '560001', address: '4 Church Street, Bengaluru' });
    expect(existing).toMatchObject({ orderId: null, shipmentId: null });
    expect(await returnRow(returnId)).toMatchObject({ carrier_order_id: '502', pickup_status: 'booked', pickup_error: null });
  });

  test('a failed cancel of the abandoned order does not stop the new booking', async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([
      { ok: false, stage: 'return_awb', orderId: '511', shipmentId: '611', error: 'Wallet balance low' },
      booked(11),
    ]);
    await bookReturnPickup(B, returnId, { client });
    const out = await tx((c) => setReturnMethod(c, { businessId: B, returnId, method: 'courier_pickup', pickup: { phone: '9123456780' } }));
    expect(out.abandonedOrderId).toBe('511');
    client.cancelOrders.mockRejectedValueOnce(new Error('Shiprocket down'));
    const res = await bookReturnPickup(B, returnId, { client, abandonedOrderId: out.abandonedOrderId });
    expect(res).toMatchObject({ ok: true, warning: expect.stringContaining('511') });
    expect(client.bookReturn.mock.calls[1][0].customerPhone).toBe('9123456780');
    expect((await returnRow(returnId)).pickup_error).toContain('Shiprocket down');
  });

  test('switching to another way back gives up a half-made order', async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([{ ok: false, stage: 'return_awb', orderId: '521', shipmentId: '621', error: 'Wallet balance low' }]);
    await bookReturnPickup(B, returnId, { client });
    const out = await tx((c) => setReturnMethod(c, { businessId: B, returnId, method: 'customer_sends' }));
    expect(out).toMatchObject({ needsPickup: false, abandonedOrderId: '521' });
    expect(await returnRow(returnId)).toMatchObject({ return_method: 'customer_sends', carrier_order_id: null, carrier_shipment_id: null, pickup_attempt: 1 });
    expect(await cancelAbandonedOrder(B, '521', { client })).toEqual({ ok: true });
    expect(client.cancelOrders).toHaveBeenCalledWith(['521']);
  });

  test("another business cannot book or cancel this return's pickup", async () => {
    const { returnId } = await approvedPickup();
    const client = fakeClient([booked(8)]);
    await bookReturnPickup(B, returnId, { client });
    expect(await bookReturnPickup(OTHER, returnId, { client })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await cancelReturnPickup(OTHER, returnId, { client })).toMatchObject({ ok: false, status: 404 });
    expect(client.bookReturn).toHaveBeenCalledTimes(1);
    expect(client.cancelOrders).not.toHaveBeenCalled();
    expect((await returnRow(returnId)).pickup_status).toBe('booked');
  });

  describe('tracking from the Shiprocket webhook', () => {
    /** A return with a booked pickup (AWB `RAWB<tag><n>`, Shiprocket order `7<n>`). */
    async function bookedReturn(n: number, client = fakeClient([booked(n)])) {
      const { returnId } = await approvedPickup();
      await bookReturnPickup(B, returnId, { client });
      return { returnId, client, awb: `RAWB${tag}${n}` };
    }
    const kinds = async (returnId: string) => (await listReturnEvents(pool, B, returnId)).map((e) => e.kind);

    test("a return's DELIVERED marks the return arrived and never touches the store order", async () => {
      const { returnId, awb } = await bookedReturn(21);
      const ret = await returnRow(returnId);
      // The original order was delivered earlier with its own parcel.
      await pool.query(`UPDATE order_fulfilments SET awb = $2, status = 'delivered' WHERE id = $1`, [ret.fulfilment_id, `F1${tag}`]);
      await pool.query(`UPDATE store_orders SET status = 'delivered' WHERE id = $1`, [ret.store_order_id]);
      const parcelBefore = (await pool.query(`SELECT * FROM order_fulfilments WHERE id = $1`, [ret.fulfilment_id])).rows[0];
      const orderBefore = (await pool.query(`SELECT * FROM store_orders WHERE id = $1`, [ret.store_order_id])).rows[0];

      const res = await postTracking({ awb, is_return: 1, current_status: 'DELIVERED' });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ ok: true, outcome: 'updated', returnId, to: 'arrived' });

      const after = await returnRow(returnId);
      expect(after.pickup_status).toBe('arrived');
      expect(after.arrived_at).not.toBeNull();
      expect((await pool.query(`SELECT * FROM order_fulfilments WHERE id = $1`, [ret.fulfilment_id])).rows[0]).toEqual(parcelBefore);
      expect((await pool.query(`SELECT * FROM store_orders WHERE id = $1`, [ret.store_order_id])).rows[0]).toEqual(orderBefore);
      expect(parcelBefore.status).toBe('delivered');
      expect(orderBefore.status).toBe('delivered');
      expect(await kinds(returnId)).toEqual(['requested', 'approved', 'pickup_booked', 'pickup_status']);
    });

    test("an event that arrives before the AWB is saved matches by Shiprocket's order id", async () => {
      const { returnId } = await approvedPickup();
      const client = fakeClient([{ ok: false, stage: 'return_awb', orderId: '5077', shipmentId: '5088', error: 'Wallet balance low' }]);
      await bookReturnPickup(B, returnId, { client });
      expect(await returnRow(returnId)).toMatchObject({ carrier_order_id: '5077', awb: null, pickup_status: null });

      const res = await postTracking({ sr_order_id: 5077, is_return: 1, current_status: 'PICKUP SCHEDULED' });
      expect(res.json).toMatchObject({ ok: true, outcome: 'updated', returnId, to: 'booked' });
      expect((await returnRow(returnId)).pickup_status).toBe('booked');
    });

    test('the same event twice changes nothing the second time', async () => {
      const { returnId, awb } = await bookedReturn(22);
      const first = await postTracking({ awb, is_return: 1, current_status: 'OUT FOR PICKUP' });
      expect(first.json).toMatchObject({ outcome: 'updated', to: 'out_for_pickup' });
      const second = await postTracking({ awb, is_return: 1, current_status: 'OUT FOR PICKUP' });
      expect(second.status).toBe(200);
      expect(second.json).toMatchObject({ ok: true, outcome: 'unchanged' });
      expect((await listReturnEvents(pool, B, returnId)).filter((e) => e.kind === 'pickup_status')).toHaveLength(1);
    });

    test('an out-of-order event is acknowledged, not applied', async () => {
      const { returnId, awb } = await bookedReturn(23);
      await postTracking({ awb, is_return: 1, current_status: 'IN TRANSIT' });
      const first = await returnRow(returnId);
      expect(first.pickup_status).toBe('in_transit');
      expect(first.picked_up_at).not.toBeNull();

      const late = await postTracking({ awb, is_return: 1, current_status: 'OUT FOR PICKUP' });
      expect(late.status).toBe(200);
      expect(late.json).toMatchObject({ ok: true, outcome: 'unchanged' });
      const after = await returnRow(returnId);
      expect(after.pickup_status).toBe('in_transit');
      expect(after.picked_up_at).toEqual(first.picked_up_at);
      expect((await listReturnEvents(pool, B, returnId)).filter((e) => e.kind === 'pickup_status')).toHaveLength(1);
    });

    test('a pickup issue keeps the label as the reason, and it clears when the pickup goes ahead', async () => {
      const { returnId, awb } = await bookedReturn(24);
      await postTracking({ awb, is_return: 1, current_status: 'PICKUP EXCEPTION' });
      expect(await returnRow(returnId)).toMatchObject({ pickup_status: 'pickup_issue', pickup_error: 'pickup exception' });
      await postTracking({ awb, is_return: 1, current_status: 'OUT FOR PICKUP' });
      expect(await returnRow(returnId)).toMatchObject({ pickup_status: 'out_for_pickup', pickup_error: null });
    });

    test('a QC failure cancels the pickup with the reason, and Book again starts a new order', async () => {
      const { returnId, awb, client } = await bookedReturn(25, fakeClient([booked(25), booked(26)]));
      const number = (await returnRow(returnId)).return_number as string;

      const res = await postTracking({ awb, is_return: 1, current_status: 'CANCELED', qc_failure_reason: 'Used product' });
      expect(res.json).toMatchObject({ ok: true, outcome: 'updated', returnId, to: 'cancelled' });
      const row = await returnRow(returnId);
      expect(row).toMatchObject({
        pickup_status: 'cancelled',
        pickup_error: 'Used product',
        pickup_attempt: 1,
        carrier_order_id: null,
        carrier_shipment_id: null,
        awb: null,
        tracking_url: null,
        status: 'approved',
      });
      expect(hasLivePickup(row)).toBe(false);
      // Shiprocket already cancelled it: no call from our side.
      expect(client.cancelOrders).not.toHaveBeenCalled();

      // The same event again finds nothing (the ids were cleared) and is ignored as a return event.
      const again = await postTracking({ awb, is_return: 1, current_status: 'CANCELED', qc_failure_reason: 'Used product' });
      expect(again.json).toMatchObject({ ok: true, ignored: true });

      const second = await bookReturnPickup(B, returnId, { client });
      expect(second.ok).toBe(true);
      expect(client.bookReturn.mock.calls[1][0].ref).toBe(`${number}-2`);
      expect(client.bookReturn.mock.calls[1][1]).toMatchObject({ orderId: null, shipmentId: null });
      expect(await returnRow(returnId)).toMatchObject({ pickup_status: 'booked', pickup_error: null, carrier_order_id: '726' });
    });

    test('an unknown return AWB with is_return is ignored, not applied to forward orders', async () => {
      const { returnId } = await bookedReturn(27);
      const ret = await returnRow(returnId);
      await pool.query(`UPDATE order_fulfilments SET awb = $2, status = 'shipped' WHERE id = $1`, [ret.fulfilment_id, `F2${tag}`]);
      const parcelBefore = (await pool.query(`SELECT * FROM order_fulfilments WHERE id = $1`, [ret.fulfilment_id])).rows[0];

      // Even an AWB that belongs to a forward parcel is not applied when Shiprocket says it is a return.
      const res = await postTracking({ awb: `F2${tag}`, is_return: 1, current_status: 'DELIVERED' });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ ok: true, ignored: true });
      expect((await pool.query(`SELECT * FROM order_fulfilments WHERE id = $1`, [ret.fulfilment_id])).rows[0]).toEqual(parcelBefore);

      // A return label never reaches the RTO handling either.
      const rto = await postTracking({ awb: `NOPE${tag}`, is_return: 1, current_status: 'RTO IN TRANSIT' });
      expect(rto.json).toEqual({ ok: true, ignored: true });
    });

    test("another business's token never matches this return", async () => {
      const { returnId, awb } = await bookedReturn(28);
      const res = await postTracking({ awb, is_return: 1, current_status: 'DELIVERED' }, TOKEN_OTHER);
      expect(res.json).toEqual({ ok: true, ignored: true });
      expect((await returnRow(returnId)).pickup_status).toBe('booked');
      expect((await postTracking({ awb, is_return: 1, current_status: 'DELIVERED' }, 'x'.repeat(30))).status).toBe(401);
    });
  });
});
