/**
 * Real-PostgreSQL tests for Phase 3.2 store order safety: lifecycle transitions, quantity
 * validation, order numbering, atomic cancellation, Shiprocket tenant isolation and Razorpay
 * payment idempotency. Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database
 * with migration 327 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/subscription/feature-access', () => ({
  hasFeatureAccess: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreCustomerWhatsApp: jest.fn(), notifyStoreEvent: jest.fn() }));
jest.mock('@/lib/store/notify-merchant', () => ({ notifyStoreMerchantNewOrder: jest.fn() }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { signStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { hashStoreWebhookToken } from '@/lib/store/delivery/webhooks';
import { reserveStoreOrderNumber, transitionStoreOrder } from '@/lib/store/order-lifecycle';
import { fulfillStoreOrderPayment } from '@/lib/store/fulfill-paid-order';
import { POST as placeOrder } from '@/app/api/public/store/[subdomain]/orders/route';
import { PATCH as patchOrder } from '@/app/api/settings/online-store/orders/route';
import { POST as shiprocketWebhook } from '@/app/api/webhooks/store/shiprocket/route';

d('store order safety (real DB)', () => {
  jest.setTimeout(90000);

  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const BR_A = randomUUID();
  const BR_B = randomUUID();
  const tag = A.slice(0, 8);
  const SUB = `sos-${tag}`;
  const ITEM_A = randomUUID();
  const ITEM_A2 = randomUUID();
  const ITEM_B = randomUUID();
  const CUST_A = randomUUID();
  const PHONE = `9${Date.now().toString().slice(-9)}`;
  const TOKEN_A = `TokA${tag.replace(/-/g, '')}0123456789abcdefXYZ`;
  const TOKEN_B = `TokB${tag.replace(/-/g, '')}0123456789abcdefXYZ`;

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function stock(itemId: string): Promise<number> {
    const r = await pool.query(`SELECT current_stock::text AS s FROM items WHERE id = $1`, [itemId]);
    return parseFloat(r.rows[0].s);
  }

  async function setStock(itemId: string, qty: number) {
    await pool.query(`UPDATE items SET current_stock = $2 WHERE id = $1`, [itemId, qty]);
  }

  async function order(id: string) {
    return (
      await pool.query<{ status: string; payment_status: string; order_number: string; awb: string | null }>(
        `SELECT status, payment_status, order_number, awb FROM store_orders WHERE id = $1`,
        [id],
      )
    ).rows[0];
  }

  let seq = 0;
  /** Seeds an order row directly (bypassing checkout) with the given state and lines. */
  async function seedOrder(opts: {
    businessId?: string;
    status?: string;
    paymentStatus?: 'unpaid' | 'paid' | 'cod';
    lines?: Array<{ itemId: string; qty: number }>;
    grandTotal?: number;
    orderNumber?: string;
    awb?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const businessId = opts.businessId ?? A;
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, order_number, customer_name, customer_phone, status, payment_status,
          subtotal, grand_total, delivery_mode, awb)
       VALUES ($1, $2, $3, 'Test buyer', $4, $5, $6, $7, $7, 'pickup', $8)`,
      [
        id,
        businessId,
        opts.orderNumber ?? `T-${tag.slice(0, 4)}-${seq}`,
        PHONE,
        opts.status ?? 'pending',
        opts.paymentStatus ?? 'cod',
        opts.grandTotal ?? 200,
        opts.awb ?? null,
      ],
    );
    for (const line of opts.lines ?? []) {
      await pool.query(
        `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit_price, line_total)
         VALUES ($1, $2, 'Line', $3::numeric, 100, $3::numeric * 100)`,
        [id, line.itemId, line.qty],
      );
    }
    return id;
  }

  const adminHeaders = (businessId: string) => ({
    'x-authenticated-user-id': randomUUID(),
    'x-authenticated-business-id': businessId,
    'content-type': 'application/json',
  });

  async function patch(businessId: string, body: Record<string, unknown>) {
    const res = await patchOrder(
      new NextRequest('http://localhost/api/settings/online-store/orders', {
        method: 'PATCH',
        headers: adminHeaders(businessId),
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as any };
  }

  async function checkout(items: unknown, withCookie = true, paymentMethod = 'cod') {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (withCookie) headers.cookie = `${STORE_CUSTOMER_COOKIE}=${signStoreCustomer(A, CUST_A)}`;
    const res = await placeOrder(
      new NextRequest(`http://localhost/api/public/store/${SUB}/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          payment_method: paymentMethod,
          delivery_mode: 'pickup',
          customer_name: 'Buyer',
          customer_phone: PHONE,
          items,
        }),
      }),
      { params: { subdomain: SUB } },
    );
    return { status: res.status, json: (await res.json()) as any };
  }

  async function shiprocket(token: string | null, body: Record<string, unknown>) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['x-api-key'] = token;
    const res = await shiprocketWebhook(
      new NextRequest('http://localhost/api/webhooks/store/shiprocket', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as any };
  }

  const payment = (key: string, amount: number | null) => ({
    provider: 'razorpay' as const,
    idempotencyKey: `${key}-${tag}`,
    amount,
    currency: 'INR',
    payload: JSON.stringify({ event: 'payment_link.paid', key }),
  });

  async function paymentEvent(key: string) {
    return (
      await pool.query<{ status: string; error_message: string | null }>(
        `SELECT status, error_message FROM store_payment_events WHERE provider = 'razorpay' AND idempotency_key = $1`,
        [`${key}-${tag}`],
      )
    ).rows;
  }

  beforeAll(async () => {
    pool = getPool();
    for (const [biz, br, name] of [
      [A, BR_A, 'A'],
      [B, BR_B, 'B'],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Store safety ${name} ${tag}`],
      );
      await pool.query(
        `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
         VALUES ($1, $2, 'Main', '27', true, true, true)`,
        [br, biz],
      );
    }
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled, store_shiprocket_webhook_token_hash)
       VALUES ($1, $2, true, $3), ($4, NULL, false, $5)`,
      [A, SUB, hashStoreWebhookToken(TOKEN_A), B, hashStoreWebhookToken(TOKEN_B)],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active)
       VALUES ($1, $4, 'Soap', 'PCS', 100, 0, 10, true, true),
              ($2, $4, 'Oil', 'PCS', 100, 0, 10, true, true),
              ($3, $5, 'Other tenant soap', 'PCS', 100, 0, 10, true, true)`,
      [ITEM_A, ITEM_A2, ITEM_B, A, B],
    );
    await pool.query(
      `INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, 'Buyer')`,
      [CUST_A, A, PHONE],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM store_orders WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[A, B]]);
        });
      });
    } finally {
      await closePool();
    }
  });

  describe('checkout payment methods', () => {
    const count = async () =>
      Number((await pool.query(`SELECT COUNT(*) FROM store_orders WHERE business_id = $1`, [A])).rows[0].count);

    test('online payment without a configured gateway is refused before an order is created', async () => {
      const before = await count();
      const r = await checkout([{ item_id: ITEM_A, quantity: 1 }], true, 'online');
      expect(r.status).toBe(400);
      expect(await count()).toBe(before);
    });

    test('direct UPI is refused when the business has no UPI ID', async () => {
      const before = await count();
      const r = await checkout([{ item_id: ITEM_A, quantity: 1 }], true, 'upi');
      expect(r.status).toBe(400);
      expect(await count()).toBe(before);
    });

    test('direct UPI places a COD-style order tagged upi and returns UPI app links', async () => {
      await pool.query(
        `INSERT INTO payment_methods (business_id, method_type, method_name, upi_id, is_active, is_default)
         VALUES ($1, 'upi', 'Shop UPI', 'shop.test@okicici', true, true)`,
        [A],
      );
      try {
        const r = await checkout([{ item_id: ITEM_A, quantity: 1 }], true, 'upi');
        expect(r.status).toBe(200);
        expect(r.json.payment_url).toBeUndefined();
        expect(r.json.upi.vpa).toBe('shop.test@okicici');
        expect(r.json.upi.links.any).toMatch(/^upi:\/\/pay\?pa=shop\.test%40okicici&/);
        expect(r.json.upi.links.any).toContain(`tr=${r.json.order_number}`);
        const row = (
          await pool.query(`SELECT payment_status, payment_provider FROM store_orders WHERE id = $1`, [r.json.order_id])
        ).rows[0];
        expect(row).toEqual({ payment_status: 'cod', payment_provider: 'upi' });

        const collected = await patch(A, { action: 'collect_cash', order_id: r.json.order_id });
        expect(collected.status).toBe(200);
        expect(collected.json.order.cash_collected_at).toBeTruthy();
      } finally {
        await pool.query(`DELETE FROM payment_methods WHERE business_id = $1`, [A]);
      }
    });
  });

  describe('order transitions', () => {
    test('a valid transition is applied through the admin API', async () => {
      const id = await seedOrder({ status: 'pending', paymentStatus: 'cod' });
      const r = await patch(A, { order_id: id, status: 'confirmed' });
      expect(r.status).toBe(200);
      expect((await order(id)).status).toBe('confirmed');
    });

    test('an invalid transition is rejected with 409 and leaves the order unchanged', async () => {
      const id = await seedOrder({ status: 'pending', paymentStatus: 'cod' });
      const r = await patch(A, { order_id: id, status: 'delivered' });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('INVALID_TRANSITION');
      expect(r.json.current_status).toBe('pending');
      expect((await order(id)).status).toBe('pending');
    });

    test('a cancelled order cannot return to confirmed, ready or delivered', async () => {
      const id = await seedOrder({ status: 'cancelled', paymentStatus: 'cod' });
      for (const to of ['confirmed', 'ready', 'delivered', 'pending', 'cancelled']) {
        const r = await patch(A, { order_id: id, status: to, dispatch_mode: 'self' });
        expect([to, r.status]).toEqual([to, 409]);
      }
      expect((await order(id)).status).toBe('cancelled');
    });

    test('an unpaid prepaid order cannot be marked ready', async () => {
      const id = await seedOrder({ status: 'confirmed', paymentStatus: 'unpaid' });
      const r = await transitionStoreOrder({ businessId: A, orderId: id, to: 'ready' });
      expect(r).toMatchObject({ ok: false, status: 409, code: 'PAYMENT_REQUIRED' });
      expect((await order(id)).status).toBe('confirmed');
    });

    test('another business cannot move the order', async () => {
      const id = await seedOrder({ status: 'pending', paymentStatus: 'cod' });
      const r = await patch(B, { order_id: id, status: 'cancelled' });
      expect(r.status).toBe(404);
      expect((await order(id)).status).toBe('pending');
    });
  });

  describe('quantity validation at checkout', () => {
    test.each([
      ['negative', -2],
      ['zero', 0],
      ['fractional', 1.5],
      ['string', '2'],
    ])('rejects a %s quantity before any stock changes', async (_label, qty) => {
      await setStock(ITEM_A, 10);
      const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM store_orders WHERE business_id = $1`, [A]))
        .rows[0].n;
      const r = await checkout([{ item_id: ITEM_A, quantity: qty }]);
      expect(r.status).toBe(400);
      expect(await stock(ITEM_A)).toBe(10);
      const after = (await pool.query(`SELECT COUNT(*)::int AS n FROM store_orders WHERE business_id = $1`, [A]))
        .rows[0].n;
      expect(after).toBe(before);
    });

    test('a valid COD order is placed with a server-issued number and does not deduct stock', async () => {
      await setStock(ITEM_A, 10);
      const r = await checkout([{ item_id: ITEM_A, quantity: 3 }]);
      expect(r.status).toBe(200);
      expect(r.json.order_number).toMatch(/^SO-\d{4,}$/);
      expect(await stock(ITEM_A)).toBe(10);
      const row = await order(r.json.order_id);
      expect(row).toMatchObject({ status: 'pending', payment_status: 'cod', order_number: r.json.order_number });
    });
  });

  describe('order numbering', () => {
    test('concurrent number reservation never issues duplicates', async () => {
      const N = 8;
      const numbers = await Promise.all(
        Array.from({ length: N }, () =>
          tx(async (c) => {
            const n = await reserveStoreOrderNumber(c, B);
            await c.query(
              `INSERT INTO store_orders (business_id, order_number, customer_name, customer_phone)
               VALUES ($1, $2, 'Race', $3)`,
              [B, n, PHONE],
            );
            return n;
          }),
        ),
      );
      expect(new Set(numbers).size).toBe(N);
      const stored = await pool.query(
        `SELECT COUNT(DISTINCT order_number)::int AS n FROM store_orders WHERE business_id = $1 AND customer_name = 'Race'`,
        [B],
      );
      expect(stored.rows[0].n).toBe(N);
    });

    test('the database rejects a duplicate number within a business but allows it across businesses', async () => {
      const num = `DUP-${tag.slice(0, 6)}`;
      await seedOrder({ businessId: A, orderNumber: num });
      await expect(seedOrder({ businessId: A, orderNumber: num })).rejects.toMatchObject({ code: '23505' });
      await expect(seedOrder({ businessId: B, orderNumber: num })).resolves.toEqual(expect.any(String));
    });
  });

  describe('cancellation', () => {
    test('cancelling an uninvoiced COD order cancels status and does not change stock', async () => {
      await setStock(ITEM_A, 5);
      const id = await seedOrder({ status: 'confirmed', paymentStatus: 'cod', lines: [{ itemId: ITEM_A, qty: 2 }] });
      const r = await patch(A, { order_id: id, status: 'cancelled', cancelled_reason: 'Customer asked' });
      expect(r.status).toBe(200);
      expect(await stock(ITEM_A)).toBe(5);
      expect((await order(id)).status).toBe('cancelled');
    });

    test('cancelling an unpaid prepaid order does not touch stock', async () => {
      await setStock(ITEM_A, 5);
      const id = await seedOrder({ status: 'pending', paymentStatus: 'unpaid', lines: [{ itemId: ITEM_A, qty: 2 }] });
      const r = await transitionStoreOrder({ businessId: A, orderId: id, to: 'cancelled' });
      expect(r).toMatchObject({ ok: true, stockRestored: false });
      expect(await stock(ITEM_A)).toBe(5);
    });

    test('cancelling an uninvoiced order does not write a stock movement', async () => {
      await setStock(ITEM_A, 5);
      await setStock(ITEM_A2, 5);
      const id = await seedOrder({
        status: 'confirmed',
        paymentStatus: 'cod',
        lines: [
          { itemId: ITEM_A, qty: 1 },
          { itemId: ITEM_A2, qty: 1 },
        ],
      });
      const before = Number(
        (await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE item_id = ANY($1::uuid[])`, [[ITEM_A, ITEM_A2]])).rows[0].n,
      );
      const moved = await transitionStoreOrder({ businessId: A, orderId: id, to: 'cancelled' });
      expect(moved).toMatchObject({ ok: true, stockRestored: false });
      expect(await stock(ITEM_A)).toBe(5);
      expect(await stock(ITEM_A2)).toBe(5);
      expect((await order(id)).status).toBe('cancelled');
      const after = Number(
        (await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE item_id = ANY($1::uuid[])`, [[ITEM_A, ITEM_A2]])).rows[0].n,
      );
      expect(after).toBe(before);
    });

    test('concurrent cancellations change status once and do not change stock', async () => {
      await setStock(ITEM_A, 5);
      const id = await seedOrder({ status: 'ready', paymentStatus: 'cod', lines: [{ itemId: ITEM_A, qty: 3 }] });
      const results = await Promise.all(
        Array.from({ length: 4 }, () => transitionStoreOrder({ businessId: A, orderId: id, to: 'cancelled' })),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.code === 'INVALID_TRANSITION')).toHaveLength(3);
      expect(await stock(ITEM_A)).toBe(5);
    });
  });

  describe('Shiprocket webhook', () => {
    test('requests without a valid token are refused', async () => {
      expect((await shiprocket(null, { awb: 'X', current_status: 'Delivered' })).status).toBe(401);
      expect((await shiprocket('wrong-token-000000000000000000', { awb: 'X', current_status: 'Delivered' })).status).toBe(
        401,
      );
    });

    test("one business's token cannot change another business's order, even with the same order number", async () => {
      const num = `SR-${tag.slice(0, 6)}`;
      const orderA = await seedOrder({ businessId: A, status: 'ready', orderNumber: num });
      const orderB = await seedOrder({ businessId: B, status: 'ready', orderNumber: num, awb: `AWB-B-${tag}` });

      const byAwb = await shiprocket(TOKEN_A, { awb: `AWB-B-${tag}`, current_status: 'RTO Initiated' });
      expect(byAwb.status).toBe(200);
      expect(byAwb.json.outcome).toBe('not_found');
      expect((await order(orderB)).status).toBe('ready');

      const byNumber = await shiprocket(TOKEN_A, { order_id: num, current_status: 'Delivered' });
      expect(byNumber.json.outcome).toBe('updated');
      expect((await order(orderA)).status).toBe('delivered');
      expect((await order(orderB)).status).toBe('ready');
    });

    test('out-of-order carrier statuses are acknowledged but not applied', async () => {
      const id = await seedOrder({ businessId: B, status: 'cancelled', awb: `AWB-C-${tag}` });
      const r = await shiprocket(TOKEN_B, { awb: `AWB-C-${tag}`, current_status: 'Delivered' });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ outcome: 'rejected', code: 'INVALID_TRANSITION' });
      expect((await order(id)).status).toBe('cancelled');
    });
  });

  describe('Razorpay payment fulfilment', () => {
    test('duplicate deliveries of one payment fulfil the order once', async () => {
      await setStock(ITEM_A, 10);
      const id = await seedOrder({ paymentStatus: 'unpaid', grandTotal: 200, lines: [{ itemId: ITEM_A, qty: 2 }] });
      const ev = payment('dup', 200);
      const results = await Promise.all([
        fulfillStoreOrderPayment(id, A, ev),
        fulfillStoreOrderPayment(id, A, ev),
        fulfillStoreOrderPayment(id, A, ev),
      ]);
      expect(results.filter((r) => r.outcome === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(2);
      expect(await stock(ITEM_A)).toBe(10);
      expect(await order(id)).toMatchObject({ payment_status: 'paid', status: 'confirmed' });
      expect(await paymentEvent('dup')).toEqual([{ status: 'processed', error_message: null }]);
    });

    test('a wrong amount does not mark the order paid', async () => {
      await setStock(ITEM_A, 10);
      const id = await seedOrder({ paymentStatus: 'unpaid', grandTotal: 200, lines: [{ itemId: ITEM_A, qty: 2 }] });
      for (const [key, amount] of [
        ['short', 199.99],
        ['over', 250],
        ['missing', null],
      ] as const) {
        const r = await fulfillStoreOrderPayment(id, A, payment(key, amount));
        expect(r).toEqual({ outcome: 'rejected', reason: 'AMOUNT_MISMATCH' });
        expect(await paymentEvent(key)).toEqual([{ status: 'rejected', error_message: 'AMOUNT_MISMATCH' }]);
      }
      expect(await order(id)).toMatchObject({ payment_status: 'unpaid', status: 'pending' });
      expect(await stock(ITEM_A)).toBe(10);

      expect(await fulfillStoreOrderPayment(id, A, payment('short', 200))).toEqual({ outcome: 'duplicate' });
      expect(await fulfillStoreOrderPayment(id, A, payment('exact', 200))).toEqual({ outcome: 'fulfilled' });
      expect((await order(id)).payment_status).toBe('paid');
      expect(await stock(ITEM_A)).toBe(10);
    });

    test('a payment for a cancelled order is recorded but not applied', async () => {
      await setStock(ITEM_A, 10);
      const id = await seedOrder({
        status: 'cancelled',
        paymentStatus: 'unpaid',
        grandTotal: 200,
        lines: [{ itemId: ITEM_A, qty: 2 }],
      });
      expect(await fulfillStoreOrderPayment(id, A, payment('late', 200))).toEqual({
        outcome: 'rejected',
        reason: 'ORDER_CANCELLED',
      });
      expect(await order(id)).toMatchObject({ payment_status: 'unpaid', status: 'cancelled' });
      expect(await stock(ITEM_A)).toBe(10);
    });

    test('a short shelf does not block payment and does not deduct stock', async () => {
      await setStock(ITEM_A, 1);
      const id = await seedOrder({ paymentStatus: 'unpaid', grandTotal: 300, lines: [{ itemId: ITEM_A, qty: 3 }] });
      const ev = payment('retry', 300);

      expect(await fulfillStoreOrderPayment(id, A, ev)).toEqual({ outcome: 'fulfilled' });
      expect(await paymentEvent('retry')).toEqual([{ status: 'processed', error_message: null }]);
      expect(await order(id)).toMatchObject({ payment_status: 'paid', status: 'confirmed' });
      expect(await stock(ITEM_A)).toBe(1);

      expect(await fulfillStoreOrderPayment(id, A, ev)).toEqual({ outcome: 'duplicate' });
      expect(await stock(ITEM_A)).toBe(1);
    });

    test("a payment signed for one business cannot pay another business's order", async () => {
      const id = await seedOrder({ businessId: B, paymentStatus: 'unpaid', grandTotal: 200 });
      expect(await fulfillStoreOrderPayment(id, A, payment('cross', 200))).toEqual({
        outcome: 'rejected',
        reason: 'ORDER_NOT_FOUND',
      });
      expect((await order(id)).payment_status).toBe('unpaid');
    });
  });
});
