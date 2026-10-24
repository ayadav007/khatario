/**
 * Buyer WhatsApp updates for delivery steps: sent once per status, only when switched on, never
 * twice for steps the online store already announces; the bot reads orders from every channel.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const mockNotify = jest.fn();
jest.mock('@/lib/whatsapp/tenant-send', () => ({ notifyBusinessEvent: (...a: unknown[]) => mockNotify(...a) }));
jest.mock('@/lib/meta-whatsapp', () => ({ getMetaWaConfig: jest.fn().mockResolvedValue(null), sendTemplateMessage: jest.fn(), sendTextMessage: jest.fn() }));

import { getPool, closePool } from '@/lib/db';
import { ensureFulfilment, transitionFulfilment } from '@/lib/fulfilment/service';
import { notifyFulfilmentStatus } from '@/lib/fulfilment/notify';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';

d('buyer delivery updates (real DB)', () => {
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

  async function whatsappOrder(paid = true) {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO sales_orders (id, business_id, order_number, order_date, status, subtotal, grand_total, payment_status)
       VALUES ($1, $2, $3, CURRENT_DATE, 'confirmed', 750, 750, $4)`,
      [id, A, `SO-N-${tag}-${seq}`, paid ? 'paid' : 'unpaid'],
    );
    const { row } = await tx((c) =>
      ensureFulfilment(c, {
        businessId: A,
        channel: 'whatsapp',
        salesOrderId: id,
        status: 'confirmed',
        buyerName: 'Meena Shah',
        buyerPhone: PHONE,
      }),
    );
    return row;
  }

  const move = (fulfilmentId: string, to: 'shipped' | 'delivered' | 'cancelled' | 'packed', details = {}) =>
    tx((c) => transitionFulfilment(c, { businessId: A, fulfilmentId, to, actorType: 'staff', details }));

  const notified = async (id: string) =>
    (await pool.query<{ n: string[] }>(`SELECT notified_statuses AS n FROM order_fulfilments WHERE id = $1`, [id])).rows[0].n;

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    for (const [biz, name] of [
      [A, 'A'],
      [B, 'B'],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, address_line1, city)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'Shop 4, MG Road', 'Pune')`,
        [biz, `Notify ${name} ${tag}`],
      );
    }
  });

  beforeEach(() => {
    mockNotify.mockReset();
    mockNotify.mockResolvedValue({ via: 'qr' });
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM order_fulfilments WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      await pool.query(`DELETE FROM store_orders WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      await pool.query(`DELETE FROM sales_orders WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      await pool.query(`DELETE FROM business_settings WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[A, B]]);
    } finally {
      await closePool();
    }
  });

  test('each status is sent once, with the tracking link and courier', async () => {
    const row = await whatsappOrder();
    expect(await notifyFulfilmentStatus(A, row.id)).toBe('sent');
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const first = mockNotify.mock.calls[0][0];
    expect(first).toMatchObject({ businessId: A, eventKey: 'order_confirmed', to: PHONE });
    expect(first.values.customer_name).toBe('Meena');
    expect(first.values.order_link).toContain(`/track/${row.public_token}`);
    expect(first.fallbackText).toContain(`/track/${row.public_token}`);

    const [a, b] = await Promise.all([notifyFulfilmentStatus(A, row.id), notifyFulfilmentStatus(A, row.id)]);
    expect([a, b]).toEqual(['skipped', 'skipped']);
    expect(mockNotify).toHaveBeenCalledTimes(1);

    await move(row.id, 'shipped', { method: 'courier', partnerName: 'Delhivery', awb: 'DLN1' });
    expect(await notifyFulfilmentStatus(A, row.id)).toBe('sent');
    const shipped = mockNotify.mock.calls[1][0];
    expect(shipped.eventKey).toBe('order_shipped');
    expect(shipped.values).toMatchObject({ courier: 'Delhivery', awb: 'DLN1' });
    expect(shipped.fallbackText).toContain('Delhivery, tracking no. DLN1');
    expect(await notified(row.id)).toEqual(['confirmed', 'shipped']);
  });

  test('switched-off steps are skipped and not retried later', async () => {
    const row = await whatsappOrder();
    await pool.query(
      `INSERT INTO business_settings (business_id, order_update_settings) VALUES ($1, $2::jsonb)
       ON CONFLICT (business_id) DO UPDATE SET order_update_settings = EXCLUDED.order_update_settings`,
      [A, JSON.stringify({ notify: { confirmed: false } })],
    );
    try {
      expect(await notifyFulfilmentStatus(A, row.id)).toBe('skipped');
      await move(row.id, 'packed');
      expect(await notifyFulfilmentStatus(A, row.id)).toBe('skipped');
      expect(mockNotify).not.toHaveBeenCalled();
      expect(await notified(row.id)).toEqual(['confirmed', 'packed']);
    } finally {
      await pool.query(`UPDATE business_settings SET order_update_settings = '{}' WHERE business_id = $1`, [A]);
    }
  });

  test('a failed send is released so the next change can retry', async () => {
    const row = await whatsappOrder();
    mockNotify.mockResolvedValueOnce({ via: null });
    expect(await notifyFulfilmentStatus(A, row.id)).toBe('skipped');
    expect(await notified(row.id)).toEqual([]);
    expect(await notifyFulfilmentStatus(A, row.id)).toBe('sent');
  });

  test('cancelling a paid order mentions the refund; delivery sends the bill link when there is a bill', async () => {
    const row = await whatsappOrder(true);
    await move(row.id, 'cancelled');
    await notifyFulfilmentStatus(A, row.id);
    const sent = mockNotify.mock.calls[0][0];
    expect(sent.eventKey).toBe('order_cancelled');
    expect(sent.values.refund_note).toContain('₹750');

    const unpaid = await whatsappOrder(false);
    await move(unpaid.id, 'cancelled');
    await notifyFulfilmentStatus(A, unpaid.id);
    expect(mockNotify.mock.calls[1][0].fallbackText).not.toContain('refund');
  });

  test('the online store does not send its own confirmation or Shiprocket booking twice', async () => {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders (id, business_id, order_number, customer_name, customer_phone, status, payment_status,
                                 subtotal, grand_total, delivery_mode)
       VALUES ($1, $2, $3, 'Ravi Kumar', $4, 'pending', 'cod', 500, 500, 'delivery')`,
      [id, A, `SO-${tag.slice(0, 4)}${seq}`, PHONE],
    );
    const c = await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    expect(c.ok && c.fulfilment).toBeTruthy();
    const fid = c.ok && c.fulfilment ? c.fulfilment.fulfilmentId : '';
    expect(await notifyFulfilmentStatus(A, fid)).toBe('skipped');

    await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready', dispatchMode: 'self' });
    expect(await notifyFulfilmentStatus(A, fid)).toBe('sent');
    expect(mockNotify.mock.calls[0][0].eventKey).toBe('order_shipped');
  });

  test('another business cannot trigger a send for this order', async () => {
    const row = await whatsappOrder();
    expect(await notifyFulfilmentStatus(B, row.id)).toBe('skipped');
    expect(mockNotify).not.toHaveBeenCalled();
    expect(await notified(row.id)).toEqual([]);
  });

  test('the bot finds the order by the sender phone in every channel, and nothing for another business', async () => {
    const { orderStatusContext } = await import('@/lib/whatsapp/customer-bot');
    const id = randomUUID();
    seq += 1;
    const num = `SO-${tag.slice(0, 4)}B${seq}`;
    await pool.query(
      `INSERT INTO store_orders (id, business_id, order_number, customer_name, customer_phone, status, payment_status,
                                 subtotal, grand_total, delivery_mode)
       VALUES ($1, $2, $3, 'Ravi Kumar', $4, 'pending', 'paid', 640, 640, 'delivery')`,
      [id, A, num, `+91 ${PHONE}`],
    );
    await transitionStoreOrder({ businessId: A, orderId: id, to: 'confirmed' });
    const token = (await pool.query(`SELECT public_token FROM order_fulfilments WHERE store_order_id = $1`, [id])).rows[0].public_token;

    const text = await orderStatusContext(A, `91${PHONE}`, `where is my order ${num}`);
    expect(text).toContain(num);
    expect(text).toContain('confirmed, being prepared');
    expect(text).toContain(`/track/${token}`);

    expect(await orderStatusContext(A, '919000000001', `track ${num}`)).toContain(`No order ${num}`);
    expect(await orderStatusContext(B, `91${PHONE}`, `track ${num}`)).toContain(`No order ${num}`);
  });
});
