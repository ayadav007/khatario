/**
 * Shiprocket bookings from the Orders screen: ids survive a failed step so a retry continues,
 * store orders get the AWB mirrored, labels and manifests are cached, cancel resets the parcel,
 * courier webhooks reach non-store parcels, and extra parcels cannot pile up.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
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
    expect(await applyShiprocketFulfilmentUpdate({ businessId: B, awb, orderRef: '', fulfilmentStatus: 'out_for_delivery' })).toEqual({
      outcome: 'not_found',
    });
    expect(await applyShiprocketFulfilmentUpdate({ businessId: A, awb, orderRef: '', fulfilmentStatus: 'out_for_delivery' })).toEqual({
      outcome: 'updated',
      fulfilment: { fulfilmentId, to: 'out_for_delivery' },
    });
    expect(await applyShiprocketFulfilmentUpdate({ businessId: A, awb: '', orderRef: '9300', fulfilmentStatus: 'delivered' })).toMatchObject({
      outcome: 'updated',
    });
    expect(await applyShiprocketFulfilmentUpdate({ businessId: A, awb, orderRef: '', fulfilmentStatus: 'shipped' })).toEqual({
      outcome: 'unchanged',
    });
    expect((await fulfilment(fulfilmentId)).status).toBe('delivered');
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
