/**
 * Shiprocket bookings from the Orders screen: ids survive a failed step so a retry continues,
 * store orders get the AWB mirrored, labels and manifests are cached, cancel resets the parcel,
 * courier webhooks reach non-store parcels, and extra parcels cannot pile up.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

// The webhook route sends buyer messages for status changes; none are wanted here.
jest.mock('@/lib/fulfilment/notify-trigger', () => ({ triggerFulfilmentNotification: jest.fn() }));

import { getPool, closePool } from '@/lib/db';
import { hashStoreWebhookToken } from '@/lib/store/delivery/webhooks';
import { POST as shiprocketWebhook } from '@/app/api/webhooks/store/shiprocket/route';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';
import type { ShiprocketBooking, ShiprocketClient, ShiprocketParcel } from '@/lib/store/delivery/shiprocket';
import {
  addShipment,
  ensureFulfilment,
  removeShipment,
  setFulfilmentShipping,
  transitionFulfilment,
} from '@/lib/fulfilment/service';
import {
  applyShiprocketFulfilmentUpdate,
  bookFulfilmentWithShiprocket,
  cancelShiprocketBooking,
  noteRtoInProgress,
  generateShiprocketManifest,
  pendingManifestCount,
  shiprocketLabelUrl,
} from '@/lib/fulfilment/shiprocket-booking';

function fakeClient(bookResults: ShiprocketBooking[] = []) {
  const book = jest.fn(async (_p: ShiprocketParcel, _e?: { orderId?: string | null; shipmentId?: string | null }) => {
    const next = bookResults.shift();
    if (!next) throw new Error('unexpected book call');
    return next;
  });
  const client = {
    book,
    label: jest.fn(async () => 'https://labels.example/label.pdf'),
    manifest: jest.fn(async () => 'https://labels.example/manifest.pdf'),
    cancelOrders: jest.fn(async () => undefined),
  };
  return client as typeof client & ShiprocketClient;
}

d('Shiprocket booking (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const tag = A.slice(0, 8);
  const PHONE = `97${String(Date.now()).slice(-8)}`;
  let seq = 0;
  const TOKEN_A = `srbook${tag}${'a'.repeat(24)}`;

  /** Posts a tracking event to the webhook route as the business that owns TOKEN_A. */
  async function postTracking(body: Record<string, unknown>) {
    const res = await shiprocketWebhook(
      new NextRequest('http://localhost/api/webhooks/store/shiprocket', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': TOKEN_A },
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

  /** A paid WhatsApp sales order with its first parcel packed and ready to dispatch. */
  async function packedSalesParcel(opts: { address?: boolean } = {}): Promise<{ orderNumber: string; fulfilmentId: string }> {
    const id = randomUUID();
    seq += 1;
    const orderNumber = `SO-SR-${tag}-${seq}`;
    await pool.query(
      `INSERT INTO sales_orders (id, business_id, order_number, order_date, status, subtotal, grand_total, payment_status)
       VALUES ($1, $2, $3, CURRENT_DATE, 'confirmed', 300, 300, 'paid')`,
      [id, A, orderNumber],
    );
    const fulfilmentId = await tx(async (c) => {
      const { row } = await ensureFulfilment(c, {
        businessId: A,
        channel: 'whatsapp',
        salesOrderId: id,
        buyerName: 'Asha Rao',
        buyerPhone: `+91 ${PHONE}`,
        status: 'confirmed',
      });
      await transitionFulfilment(c, { businessId: A, fulfilmentId: row.id, to: 'packed', actorType: 'staff' });
      if (opts.address !== false) {
        await setFulfilmentShipping(c, {
          businessId: A,
          fulfilmentId: row.id,
          address: '12 MG Road, Kothrud, Pune, Maharashtra',
          pincode: '411038',
          weightKg: 1.2,
        });
      }
      return row.id;
    });
    return { orderNumber, fulfilmentId };
  }

  const ok = (n: number): ShiprocketBooking => ({
    ok: true,
    orderId: `9${n}`,
    shipmentId: `8${n}`,
    awb: `AWB${tag}${n}`,
    courierName: 'Delhivery',
    trackingUrl: `https://shiprocket.co/tracking/AWB${tag}${n}`,
    pickupScheduledAt: '2026-10-04 14:00:00',
  });

  async function fulfilment(id: string) {
    return (await pool.query(`SELECT * FROM order_fulfilments WHERE id = $1`, [id])).rows[0];
  }

  async function shipBooked(fulfilmentId: string, n: number) {
    await tx((c) =>
      transitionFulfilment(c, {
        businessId: A,
        fulfilmentId,
        to: 'shipped',
        actorType: 'staff',
        details: { method: 'shiprocket', awb: `AWB${tag}${n}` },
      }),
    );
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    for (const [biz, name] of [
      [A, 'A'],
      [B, 'B'],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Ship ${name} ${tag}`],
      );
    }
    await pool.query(
      `INSERT INTO business_integrations (business_id, provider, webhook_token_hash) VALUES ($1, 'shiprocket', $2)
       ON CONFLICT (business_id, provider) DO UPDATE SET webhook_token_hash = EXCLUDED.webhook_token_hash`,
      [A, hashStoreWebhookToken(TOKEN_A)],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM order_fulfilments WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      await pool.query(`DELETE FROM store_orders WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      await pool.query(`DELETE FROM sales_orders WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[A, B]]);
    } finally {
      await closePool();
    }
  });

  test('a failed AWB step keeps the Shiprocket ids, and the retry continues on the same shipment', async () => {
    const { orderNumber, fulfilmentId } = await packedSalesParcel();
    const client = fakeClient([
      { ok: false, orderId: '9100', shipmentId: '8100', stage: 'awb', error: 'Insufficient wallet balance' },
      { ...ok(100), orderId: '9100', shipmentId: '8100' },
    ]);

    const first = await bookFulfilmentWithShiprocket(A, fulfilmentId, { client });
    expect(first).toEqual({ ok: false, code: 'BOOKING_FAILED', error: 'Insufficient wallet balance' });
    const parcel = client.book.mock.calls[0][0];
    expect(parcel).toMatchObject({
      ref: orderNumber,
      buyerName: 'Asha Rao',
      buyerPhone: `91${PHONE}`,
      address: '12 MG Road, Kothrud, Pune, Maharashtra',
      pincode: '411038',
      cod: false,
      subTotal: 300,
      weightKg: 1.2,
    });
    expect(client.book.mock.calls[0][1]).toEqual({ orderId: null, shipmentId: null });
    expect(await fulfilment(fulfilmentId)).toMatchObject({
      carrier_order_id: '9100',
      carrier_shipment_id: '8100',
      awb: null,
      booking_error: 'Insufficient wallet balance',
      status: 'packed',
    });

    const second = await bookFulfilmentWithShiprocket(A, fulfilmentId, { client });
    expect(second).toMatchObject({ ok: true, awb: `AWB${tag}100`, courierName: 'Delhivery' });
    expect(client.book.mock.calls[1][1]).toEqual({ orderId: '9100', shipmentId: '8100' });
    const row = await fulfilment(fulfilmentId);
    expect(row).toMatchObject({
      awb: `AWB${tag}100`,
      partner_name: 'Delhivery (Shiprocket)',
      method: 'shiprocket',
      booking_error: null,
    });
    expect(new Date(row.pickup_scheduled_at).toISOString()).toBe('2026-10-04T08:30:00.000Z');

    const again = await bookFulfilmentWithShiprocket(A, fulfilmentId, { client });
    expect(again).toMatchObject({ ok: true, awb: `AWB${tag}100` });
    expect(client.book).toHaveBeenCalledTimes(2);
  });

  test('no address or another business: nothing is sent to Shiprocket', async () => {
    const { fulfilmentId } = await packedSalesParcel({ address: false });
    const client = fakeClient();
    expect(await bookFulfilmentWithShiprocket(A, fulfilmentId, { client })).toMatchObject({ ok: false, code: 'NO_ADDRESS' });
    expect(await bookFulfilmentWithShiprocket(B, fulfilmentId, { client })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(client.book).not.toHaveBeenCalled();
  });

  test('label is fetched once and cached; manifest covers booked parcels and can be reprinted', async () => {
    const { fulfilmentId } = await packedSalesParcel();
    const client = fakeClient([ok(200)]);
    await bookFulfilmentWithShiprocket(A, fulfilmentId, { client });

    expect(await shiprocketLabelUrl(A, fulfilmentId, { client })).toEqual({ ok: true, url: 'https://labels.example/label.pdf' });
    expect(await shiprocketLabelUrl(A, fulfilmentId, { client })).toEqual({ ok: true, url: 'https://labels.example/label.pdf' });
    expect(client.label).toHaveBeenCalledTimes(1);
    expect(client.label).toHaveBeenCalledWith(['8200']);
    expect(await shiprocketLabelUrl(B, fulfilmentId, { client })).toMatchObject({ ok: false });

    await shipBooked(fulfilmentId, 200);
    expect(await pendingManifestCount(A, null)).toBeGreaterThanOrEqual(1);
    expect(await pendingManifestCount(B, null)).toBe(0);

    const made = await generateShiprocketManifest(A, null, { client });
    expect(made).toMatchObject({ ok: true, url: 'https://labels.example/manifest.pdf', reprint: false });
    const [shipmentIds, orderIds] = client.manifest.mock.calls[0] as unknown as [string[], string[]];
    expect(shipmentIds).toContain('8200');
    expect(orderIds).toContain('9200');
    expect(await fulfilment(fulfilmentId)).toMatchObject({ manifest_url: 'https://labels.example/manifest.pdf' });
    expect(await pendingManifestCount(A, null)).toBe(0);

    const reprint = await generateShiprocketManifest(A, null, { client });
    expect(reprint).toMatchObject({ ok: true, reprint: true, url: 'https://labels.example/manifest.pdf' });
    expect(client.manifest).toHaveBeenCalledTimes(1);
    expect(await generateShiprocketManifest(B, null, { client })).toMatchObject({ ok: false, status: 404 });
  });

  test('courier webhooks move a non-store parcel, only within its business', async () => {
    const { fulfilmentId } = await packedSalesParcel();
    await bookFulfilmentWithShiprocket(A, fulfilmentId, { client: fakeClient([ok(300)]) });
    await shipBooked(fulfilmentId, 300);

    const awb = `AWB${tag}300`;
    expect(await applyShiprocketFulfilmentUpdate({ businessId: B, awb, orderRef: '', srOrderId: '', fulfilmentStatus: 'out_for_delivery' })).toEqual({
      outcome: 'not_found',
    });
    expect(await applyShiprocketFulfilmentUpdate({ businessId: A, awb, orderRef: '', srOrderId: '', fulfilmentStatus: 'out_for_delivery' })).toEqual({
      outcome: 'updated',
      fulfilment: { fulfilmentId, to: 'out_for_delivery' },
    });
    expect(await applyShiprocketFulfilmentUpdate({ businessId: A, awb: '', orderRef: '', srOrderId: '9300', fulfilmentStatus: 'delivered' })).toMatchObject({
      outcome: 'updated',
    });
    expect(await applyShiprocketFulfilmentUpdate({ businessId: A, awb, orderRef: '', srOrderId: '', fulfilmentStatus: 'shipped' })).toEqual({
      outcome: 'unchanged',
    });
    expect((await fulfilment(fulfilmentId)).status).toBe('delivered');
  });

  test('RTO initiated keeps the store order and parcel as they are and notes it', async () => {
    const id = randomUUID();
    seq += 1;
    const orderNumber = `SR-${tag.slice(0, 4)}-${seq}`;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, order_number, customer_name, customer_phone, status, payment_status,
          subtotal, grand_total, delivery_mode, customer_address, customer_pincode)
       VALUES ($1, $2, $3, 'Ravi Kumar', $4, 'pending', 'cod', 500, 500, 'delivery', 'Flat 4, Baner Road, Pune, Maharashtra', '411045')`,
      [id, A, orderNumber, PHONE],
    );
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready', dispatchMode: 'shiprocket' });
    const f = (await pool.query(`SELECT id FROM order_fulfilments WHERE store_order_id = $1`, [id])).rows[0];
    await bookFulfilmentWithShiprocket(A, f.id, { client: fakeClient([ok(610)]) });
    await shipBooked(f.id, 610);

    const storeStatus = async () => (await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [id])).rows[0].status;
    const storeBefore = await storeStatus();
    const parcelBefore = (await fulfilment(f.id)).status;
    const notes = async (where = `note LIKE 'Coming back to the shop (RTO)%'`) =>
      Number(
        (await pool.query(`SELECT COUNT(*) FROM order_fulfilment_events WHERE fulfilment_id = $1 AND ${where}`, [f.id])).rows[0].count,
      );
    const returnsCount = async () =>
      Number((await pool.query(`SELECT COUNT(*) FROM order_returns WHERE business_id = $1`, [A])).rows[0].count);
    const returnsBefore = await returnsCount();

    const payload = { awb: `AWB${tag}610`, order_id: orderNumber, sr_order_id: 9610, current_status: 'RTO INITIATED' };
    expect(await postTracking(payload)).toEqual({ status: 200, json: { ok: true, outcome: 'rto_noted' } });
    expect(await storeStatus()).toBe(storeBefore);
    expect((await fulfilment(f.id)).status).toBe(parcelBefore);
    expect(await returnsCount()).toBe(returnsBefore);
    expect(await notes(`note = 'Coming back to the shop (RTO)'`)).toBe(1);
    const note = (
      await pool.query(`SELECT status, actor_type FROM order_fulfilment_events WHERE fulfilment_id = $1 AND note LIKE 'Coming back%'`, [f.id])
    ).rows[0];
    expect(note).toEqual({ status: parcelBefore, actor_type: 'webhook' });

    // The same label again adds nothing; a different RTO label is a new note.
    expect((await postTracking(payload)).json).toEqual({ ok: true, outcome: 'rto_noted' });
    expect(await notes()).toBe(1);
    await postTracking({ ...payload, current_status: 'RTO IN TRANSIT' });
    await postTracking({ ...payload, current_status: 'RTO IN TRANSIT' });
    expect(await notes()).toBe(2);
    expect(await storeStatus()).toBe(storeBefore);
    expect(await returnsCount()).toBe(returnsBefore);

    // Another business cannot add a note to this parcel.
    expect(await noteRtoInProgress({ businessId: B, awb: `AWB${tag}610`, srOrderId: '9610', label: 'rto initiated' })).toBe(false);
    expect(await notes()).toBe(2);
  });

  test("the Orders-screen fallback matches Shiprocket's order id", async () => {
    const { fulfilmentId } = await packedSalesParcel();
    await bookFulfilmentWithShiprocket(A, fulfilmentId, { client: fakeClient([ok(620)]) });
    await shipBooked(fulfilmentId, 620);
    await pool.query(`UPDATE order_fulfilments SET carrier_order_id = '555', awb = NULL WHERE id = $1`, [fulfilmentId]);

    const r = await postTracking({ order_id: 'SO-x', sr_order_id: 555, current_status: 'DELIVERED' });
    expect(r.json).toMatchObject({ ok: true, outcome: 'updated' });
    expect((await fulfilment(fulfilmentId)).status).toBe('delivered');
  });

  test("a store order is also matched on Shiprocket's order id when AWB and order number miss", async () => {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, order_number, customer_name, customer_phone, status, payment_status, subtotal, grand_total, delivery_mode, carrier_order_id)
       VALUES ($1, $2, $3, 'Ravi Kumar', $4, 'ready', 'cod', 500, 500, 'delivery', '4321')`,
      [id, A, `SR-${tag.slice(0, 4)}-${seq}`, PHONE],
    );
    const r = await postTracking({ order_id: 'nomatch', sr_order_id: 4321, current_status: 'DELIVERED' });
    expect(r.json).toMatchObject({ ok: true, outcome: 'updated', orderId: id });
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [id])).rows[0].status).toBe('delivered');
  });

  test('cancelling a booking before pickup puts the parcel back to packed', async () => {
    const { fulfilmentId } = await packedSalesParcel();
    const client = fakeClient([ok(400)]);
    await bookFulfilmentWithShiprocket(A, fulfilmentId, { client });
    await shipBooked(fulfilmentId, 400);

    expect(await cancelShiprocketBooking(B, fulfilmentId, { client })).toMatchObject({ ok: false, status: 404 });
    expect(await cancelShiprocketBooking(A, fulfilmentId, { client })).toEqual({ ok: true });
    expect(client.cancelOrders).toHaveBeenCalledWith(['9400']);
    expect(await fulfilment(fulfilmentId)).toMatchObject({
      status: 'packed',
      awb: null,
      carrier_order_id: null,
      carrier_shipment_id: null,
      partner_name: null,
      shipped_at: null,
    });
  });

  test('a store order booking is mirrored onto the store order, as cash on delivery', async () => {
    const id = randomUUID();
    seq += 1;
    const orderNumber = `SR-${tag.slice(0, 4)}-${seq}`;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, order_number, customer_name, customer_phone, status, payment_status,
          subtotal, grand_total, delivery_mode, customer_address, customer_pincode)
       VALUES ($1, $2, $3, 'Ravi Kumar', $4, 'pending', 'cod', 500, 500, 'delivery', 'Flat 4, Baner Road, Pune, Maharashtra', '411045')`,
      [id, A, orderNumber, PHONE],
    );
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready', dispatchMode: 'shiprocket' });
    const f = (await pool.query(`SELECT id FROM order_fulfilments WHERE store_order_id = $1`, [id])).rows[0];

    const client = fakeClient([ok(500)]);
    expect(await bookFulfilmentWithShiprocket(A, f.id, { client })).toMatchObject({ ok: true });
    expect(client.book.mock.calls[0][0]).toMatchObject({
      ref: orderNumber,
      cod: true,
      subTotal: 500,
      pincode: '411045',
      address: 'Flat 4, Baner Road, Pune, Maharashtra',
    });
    const so = (await pool.query(`SELECT * FROM store_orders WHERE id = $1`, [id])).rows[0];
    expect(so).toMatchObject({
      awb: `AWB${tag}500`,
      shipment_id: '8500',
      carrier_order_id: '9500',
      courier_name: 'Delhivery',
      dispatch_mode: 'shiprocket',
    });
  });

  test('a new parcel is refused while one is waiting; an empty extra parcel can be removed', async () => {
    const { fulfilmentId } = await packedSalesParcel();
    const blocked = await tx((c) => addShipment(c, { businessId: A, fulfilmentId }));
    expect(blocked).toMatchObject({ ok: false, code: 'PARCEL_PENDING', pendingSeq: 1 });

    await tx((c) =>
      transitionFulfilment(c, { businessId: A, fulfilmentId, to: 'shipped', actorType: 'staff', details: { method: 'own_rider' } }),
    );
    const added = await tx((c) => addShipment(c, { businessId: A, fulfilmentId }));
    expect(added).toMatchObject({ ok: true, row: { seq: 2, status: 'confirmed' } });
    const again = await tx((c) => addShipment(c, { businessId: A, fulfilmentId }));
    expect(again).toMatchObject({ ok: false, code: 'PARCEL_PENDING', pendingSeq: 2 });

    if (!added.ok) throw new Error('unreachable');
    expect(await tx((c) => removeShipment(c, { businessId: B, fulfilmentId: added.row.id }))).toBe(false);
    expect(await tx((c) => removeShipment(c, { businessId: A, fulfilmentId }))).toBe(false);
    expect(await tx((c) => removeShipment(c, { businessId: A, fulfilmentId: added.row.id }))).toBe(true);
    expect(await fulfilment(added.row.id)).toBeUndefined();
  });
});
