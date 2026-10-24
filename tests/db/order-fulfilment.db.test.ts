/**
 * Delivery records (order_fulfilments) follow store orders, courier updates and sales orders,
 * enforce the payment gate and pickup code, and never leak across businesses.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { applyShiprocketTrackingUpdate, transitionStoreOrder } from '@/lib/store/order-lifecycle';
import { parseShiprocketWebhook } from '@/lib/store/delivery/webhooks';
import {
  ensureFulfilment,
  listFulfilmentEvents,
  markCodCollected,
  setFulfilmentShipping,
  transitionFulfilment,
} from '@/lib/fulfilment/service';
import { listOrderHub, loadShipTo, orderHubNeedsCounts } from '@/lib/fulfilment/hub';
import { loadPublicTracking } from '@/lib/fulfilment/public';

d('order fulfilments (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const tag = A.slice(0, 8);
  const PHONE = `98${String(Date.now()).slice(-8)}`;
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

  async function storeOrder(opts: { delivery?: 'delivery' | 'pickup'; payment?: string } = {}): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, order_number, customer_name, customer_phone, status, payment_status,
          subtotal, grand_total, delivery_mode)
       VALUES ($1, $2, $3, 'Ravi Kumar', $4, 'pending', $5, 500, 500, $6)`,
      [id, A, `F-${tag.slice(0, 4)}-${seq}`, PHONE, opts.payment ?? 'cod', opts.delivery ?? 'delivery'],
    );
    return id;
  }

  async function salesOrder(paid: boolean): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO sales_orders (id, business_id, order_number, order_date, status, subtotal, grand_total, payment_status)
       VALUES ($1, $2, $3, CURRENT_DATE, 'confirmed', 300, 300, $4)`,
      [id, A, `SO-F-${tag}-${seq}`, paid ? 'paid' : 'unpaid'],
    );
    return id;
  }

  async function fulfilmentOf(storeOrderId: string) {
    const r = await pool.query(`SELECT * FROM order_fulfilments WHERE store_order_id = $1`, [storeOrderId]);
    return r.rows;
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
        [biz, `Fulfil ${name} ${tag}`],
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

  test('a store order gets one delivery record that follows its status, with a timeline', async () => {
    const id = await storeOrder();
    const c = await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    expect(c).toMatchObject({ ok: true, fulfilment: { to: 'confirmed' } });
    const r = await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready', dispatchMode: 'self' });
    expect(r).toMatchObject({ ok: true, fulfilment: { to: 'shipped' } });

    const rows = await fulfilmentOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'online_store',
      status: 'shipped',
      method: 'own_rider',
      buyer_name: 'Ravi Kumar',
      buyer_phone: PHONE,
    });
    expect(Number(rows[0].cod_amount)).toBe(500);
    expect(rows[0].public_token).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const events = await listFulfilmentEvents(pool, A, rows[0].id);
    expect(events.map((e) => e.status)).toEqual(['confirmed', 'shipped']);
  });

  test('courier updates move through out for delivery, a failed attempt and delivery', async () => {
    const id = await storeOrder();
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready', dispatchMode: 'shiprocket' });
    const awb = `AWB${tag}${seq}`;
    await pool.query(`UPDATE store_orders SET awb = $2 WHERE id = $1`, [id, awb]);

    const send = (current_status: string) => {
      const p = parseShiprocketWebhook({ awb, current_status });
      return applyShiprocketTrackingUpdate({
        businessId: A,
        awb,
        orderRef: '',
        status: p.status!,
        fulfilmentStatus: p.fulfilmentStatus,
      });
    };

    expect(await send('OUT FOR DELIVERY')).toMatchObject({ outcome: 'updated', fulfilment: { to: 'out_for_delivery' } });
    let row = (await fulfilmentOf(id))[0];
    expect(row).toMatchObject({ status: 'out_for_delivery', awb, partner_name: 'Shiprocket' });
    expect(row.tracking_url).toBe(`https://shiprocket.co/tracking/${awb}`);

    await send('UNDELIVERED');
    expect((await fulfilmentOf(id))[0].status).toBe('delivery_failed');
    const store = await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [id]);
    expect(store.rows[0].status).toBe('ready');

    await send('DELIVERED');
    row = (await fulfilmentOf(id))[0];
    expect(row.status).toBe('delivered');
    expect(row.delivered_at).not.toBeNull();
    const events = await listFulfilmentEvents(pool, A, row.id);
    expect(events.map((e) => e.status)).toEqual(['confirmed', 'shipped', 'out_for_delivery', 'delivery_failed', 'delivered']);
    expect(events.slice(2).every((e) => e.actor_type === 'webhook')).toBe(true);
  });

  test('a repeated courier status is acknowledged without a second timeline entry', async () => {
    const id = await storeOrder();
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready', dispatchMode: 'shiprocket' });
    const awb = `RPT${tag}${seq}`;
    await pool.query(`UPDATE store_orders SET awb = $2 WHERE id = $1`, [id, awb]);
    const p = parseShiprocketWebhook({ awb, current_status: 'OUT FOR DELIVERY' });
    const input = { businessId: A, awb, orderRef: '', status: p.status!, fulfilmentStatus: p.fulfilmentStatus };
    await applyShiprocketTrackingUpdate(input);
    const again = await applyShiprocketTrackingUpdate(input);
    expect(again).toMatchObject({ outcome: 'unchanged', fulfilment: null });
    const row = (await fulfilmentOf(id))[0];
    expect((await listFulfilmentEvents(pool, A, row.id)).filter((e) => e.status === 'out_for_delivery')).toHaveLength(1);
  });

  test('a pickup order gets a handover code that staff must quote', async () => {
    const id = await storeOrder({ delivery: 'pickup', payment: 'paid' });
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready', dispatchMode: 'pickup' });
    const row = (await fulfilmentOf(id))[0];
    expect(row).toMatchObject({ status: 'ready_for_pickup', method: 'pickup' });
    expect(row.pickup_code).toMatch(/^\d{4}$/);

    const bad = await tx((c) =>
      transitionFulfilment(c, {
        businessId: A,
        fulfilmentId: row.id,
        to: 'delivered',
        actorType: 'staff',
        requirePickupCode: true,
        pickupCode: row.pickup_code === '1234' ? '4321' : '1234',
      }),
    );
    expect(bad).toMatchObject({ ok: false, code: 'PICKUP_CODE_MISMATCH' });
    const good = await tx((c) =>
      transitionFulfilment(c, {
        businessId: A,
        fulfilmentId: row.id,
        to: 'delivered',
        actorType: 'staff',
        requirePickupCode: true,
        pickupCode: row.pickup_code,
      }),
    );
    expect(good).toMatchObject({ ok: true, changed: true, to: 'delivered' });
  });

  test('nothing ships until paid or cash on delivery', async () => {
    const so = await salesOrder(false);
    const { row } = await tx((c) => ensureFulfilment(c, { businessId: A, channel: 'sales_order', salesOrderId: so, status: 'confirmed' }));
    const blocked = await tx((c) =>
      transitionFulfilment(c, { businessId: A, fulfilmentId: row.id, to: 'shipped', actorType: 'staff' }),
    );
    expect(blocked).toMatchObject({ ok: false, code: 'PAYMENT_REQUIRED' });

    const cod = await tx((c) =>
      transitionFulfilment(c, {
        businessId: A,
        fulfilmentId: row.id,
        to: 'shipped',
        actorType: 'staff',
        details: { method: 'courier', partnerName: 'Delhivery', awb: 'DL123', codAmount: 300 },
      }),
    );
    expect(cod).toMatchObject({ ok: true, to: 'shipped' });
    const shipped = await pool.query(`SELECT * FROM order_fulfilments WHERE id = $1`, [row.id]);
    expect(shipped.rows[0]).toMatchObject({ partner_name: 'Delhivery', awb: 'DL123' });
    expect(shipped.rows[0].tracking_url).toBe('https://www.delhivery.com/track/package/DL123');

    expect(await tx((c) => markCodCollected(c, { businessId: A, fulfilmentId: row.id }))).toEqual({ ok: true });
    expect(await tx((c) => markCodCollected(c, { businessId: A, fulfilmentId: row.id }))).toEqual({
      ok: true,
      alreadyCollected: true,
    });

    const paid = await salesOrder(true);
    const { row: r2 } = await tx((c) => ensureFulfilment(c, { businessId: A, channel: 'sales_order', salesOrderId: paid }));
    const ok = await tx((c) =>
      transitionFulfilment(c, {
        businessId: A,
        fulfilmentId: r2.id,
        to: 'shipped',
        actorType: 'staff',
        details: { method: 'local_app', partnerName: 'Porter', trackingUrl: 'javascript:alert(1)' },
      }),
    );
    expect(ok).toMatchObject({ ok: true });
    const r2row = await pool.query(`SELECT tracking_url FROM order_fulfilments WHERE id = $1`, [r2.id]);
    expect(r2row.rows[0].tracking_url).toBeNull();
  });

  test('a shipped order cannot be cancelled, only returned', async () => {
    const so = await salesOrder(true);
    const { row } = await tx((c) => ensureFulfilment(c, { businessId: A, channel: 'whatsapp', salesOrderId: so }));
    await tx((c) => transitionFulfilment(c, { businessId: A, fulfilmentId: row.id, to: 'shipped', actorType: 'staff' }));
    const cancel = await tx((c) =>
      transitionFulfilment(c, { businessId: A, fulfilmentId: row.id, to: 'cancelled', actorType: 'staff' }),
    );
    expect(cancel).toMatchObject({ ok: false, code: 'INVALID_TRANSITION', from: 'shipped' });
    const ret = await tx((c) =>
      transitionFulfilment(c, { businessId: A, fulfilmentId: row.id, to: 'returned', actorType: 'staff' }),
    );
    expect(ret).toMatchObject({ ok: true, to: 'returned' });
  });

  test('creating the record twice at once still leaves one row', async () => {
    const so = await salesOrder(true);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        tx((c) => ensureFulfilment(c, { businessId: A, channel: 'whatsapp', salesOrderId: so, status: 'confirmed' })),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM order_fulfilments WHERE sales_order_id = $1`, [so]);
    expect(n.rows[0].n).toBe(1);
    const ev = await pool.query(
      `SELECT COUNT(*)::int AS n FROM order_fulfilment_events e JOIN order_fulfilments f ON f.id = e.fulfilment_id
        WHERE f.sales_order_id = $1`,
      [so],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  test('the order hub lists every source with its delivery status and counts what needs action', async () => {
    const draft = randomUUID();
    await pool.query(
      `INSERT INTO sales_orders (id, business_id, order_number, order_date, status, subtotal, grand_total, payment_status)
       VALUES ($1, $2, $3, CURRENT_DATE, 'draft', 99, 99, 'unpaid')`,
      [draft, A, `SO-DRAFT-${tag}`],
    );
    const fresh = await storeOrder();
    const scope = { businessId: A, branchIds: null };
    const all = await listOrderHub(scope, { slaHours: 24, limit: 100 });
    const byId = new Map(all.rows.map((r) => [r.source_id, r]));
    expect(byId.get(draft)).toMatchObject({ source_type: 'sales_order', delivery_status: 'new', payment_status: 'unpaid' });
    expect(byId.get(fresh)).toMatchObject({ source_type: 'store_order', channel: 'online_store', delivery_status: 'new', payment_status: 'cod' });

    const pending = await listOrderHub(scope, { slaHours: 24, needs: 'payment_pending', limit: 100 });
    expect(pending.rows.map((r) => r.source_id)).toContain(draft);
    const confirm = await listOrderHub(scope, { slaHours: 24, needs: 'to_confirm', limit: 100 });
    expect(confirm.rows.map((r) => r.source_id)).toContain(fresh);

    const counts = await orderHubNeedsCounts(scope, 24);
    expect(counts.payment_pending).toBeGreaterThanOrEqual(1);
    expect(counts.to_confirm).toBeGreaterThanOrEqual(1);

    const searched = await listOrderHub(scope, { slaHours: 24, q: `SO-DRAFT-${tag}` });
    expect(searched.rows.map((r) => r.source_id)).toEqual([draft]);
    const other = await listOrderHub({ businessId: B, branchIds: null }, { slaHours: 24, q: `SO-DRAFT-${tag}` });
    expect(other.total).toBe(0);
  });

  test('the public tracking page shows only the buyer first name, the timeline and no staff notes', async () => {
    const id = await storeOrder();
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready', dispatchMode: 'self' });
    const row = (await fulfilmentOf(id))[0];
    await tx((c) =>
      transitionFulfilment(c, {
        businessId: A,
        fulfilmentId: row.id,
        to: 'delivery_failed',
        actorType: 'staff',
        details: { failureReason: 'Door locked, retry tomorrow' },
      }),
    );
    await pool.query(
      `INSERT INTO order_fulfilment_events (fulfilment_id, business_id, status, note, actor_type)
       VALUES ($1, $2, 'out_for_delivery', 'internal: rider was late', 'staff')`,
      [row.id, A],
    );

    const t = await loadPublicTracking(row.public_token);
    expect(t).toMatchObject({
      buyerFirstName: 'Ravi',
      status: 'delivery_failed',
      failureReason: 'Door locked, retry tomorrow',
      codDue: 500,
      shop: { name: `Fulfil A ${tag}` },
    });
    expect(JSON.stringify(t)).not.toContain('Kumar');
    expect(JSON.stringify(t)).not.toContain(PHONE);
    expect(JSON.stringify(t)).not.toContain('internal');
    expect(await loadPublicTracking('short')).toBeNull();
    expect(await loadPublicTracking('x'.repeat(24))).toBeNull();
  });

  test('the label address comes from the order or customer, and staff can override it per shipment', async () => {
    const store = await storeOrder();
    await pool.query(`UPDATE store_orders SET customer_address = 'Flat 2, Lake Road', customer_pincode = '411001' WHERE id = $1`, [store]);
    expect(await loadShipTo(A, 'store_order', store)).toEqual({ address: 'Flat 2, Lake Road', pincode: '411001' });

    const customer = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, business_id, name, address, city, state, pincode, shipping_address, shipping_city, shipping_pincode)
       VALUES ($1, $2, 'Meena', 'Office 9, FC Road', 'Pune', 'Maharashtra', '411004', NULL, NULL, NULL)`,
      [customer, A],
    );
    const so = await salesOrder(true);
    await pool.query(`UPDATE sales_orders SET customer_id = $2 WHERE id = $1`, [so, customer]);
    expect(await loadShipTo(A, 'sales_order', so)).toEqual({ address: 'Office 9, FC Road, Pune, Maharashtra', pincode: '411004' });

    await pool.query(`UPDATE customers SET shipping_address = 'Godown 3, Hadapsar', shipping_city = 'Pune', shipping_pincode = '411028' WHERE id = $1`, [customer]);
    expect(await loadShipTo(A, 'sales_order', so)).toEqual({ address: 'Godown 3, Hadapsar, Pune', pincode: '411028' });

    await pool.query(`UPDATE sales_orders SET shipping_address = 'Site office, Wakad' WHERE id = $1`, [so]);
    expect((await loadShipTo(A, 'sales_order', so)).address).toBe('Site office, Wakad');
    expect((await loadShipTo(B, 'sales_order', so)).address).toBeNull();

    const { row } = await tx((c) => ensureFulfilment(c, { businessId: A, channel: 'sales_order', salesOrderId: so }));
    expect(await tx((c) => setFulfilmentShipping(c, { businessId: A, fulfilmentId: row.id, address: ' Gate 2 ', pincode: '411 057', packages: 99 }))).toBe(true);
    expect(await tx((c) => setFulfilmentShipping(c, { businessId: B, fulfilmentId: row.id, address: 'hijack' }))).toBe(false);
    const saved = await pool.query(`SELECT ship_address, ship_pincode, packages FROM order_fulfilments WHERE id = $1`, [row.id]);
    expect(saved.rows[0]).toEqual({ ship_address: 'Gate 2', ship_pincode: '411057', packages: 50 });

    await tx((c) => setFulfilmentShipping(c, { businessId: A, fulfilmentId: row.id, packages: 2 }));
    const kept = await pool.query(`SELECT ship_address, packages FROM order_fulfilments WHERE id = $1`, [row.id]);
    expect(kept.rows[0]).toEqual({ ship_address: 'Gate 2', packages: 2 });
    await pool.query(`DELETE FROM order_fulfilments WHERE sales_order_id = $1`, [so]);
    await pool.query(`DELETE FROM sales_orders WHERE id = $1`, [so]);
    await pool.query(`DELETE FROM customers WHERE id = $1`, [customer]);
  });

  test('another business can neither move nor see the record', async () => {
    const so = await salesOrder(true);
    const { row } = await tx((c) => ensureFulfilment(c, { businessId: A, channel: 'whatsapp', salesOrderId: so }));
    const other = await tx((c) =>
      transitionFulfilment(c, { businessId: B, fulfilmentId: row.id, to: 'cancelled', actorType: 'staff' }),
    );
    expect(other).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await listFulfilmentEvents(pool, B, row.id)).toEqual([]);
    expect(await tx((c) => markCodCollected(c, { businessId: B, fulfilmentId: row.id }))).toEqual({
      ok: false,
      alreadyCollected: false,
    });
  });
});
