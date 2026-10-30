/**
 * Abandoned carts on a real database (store shopping features, phase 4, task 19): saving and
 * clearing a shopper's cart, which carts the cron claims (age per business setting, reminders on,
 * not reminded, no order since leaving), single-claim, recovery, and the one-channel reminder.
 * Task 20: the storefront cart API (sign-in required, prices re-read on save, hidden items
 * dropped) and a store order through the orders route marking the open cart recovered.
 * Opt-in, disposable DB only:
 *   STORE_FEATURES_DB_TEST=1 npx jest tests/db/store-abandoned-carts.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migration 449 must be applied there.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.STORE_FEATURES_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}
const d = enabled ? describe : describe.skip;

jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreEvent: jest.fn(), notifyStoreCustomerWhatsApp: jest.fn() }));
jest.mock('@/lib/push/customer-push', () => ({ enqueueCustomerPush: jest.fn() }));
// The orders route (cart recovery test) posts the invoice and notifies; keep that offline.
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/store/notify-merchant', () => ({ notifyStoreMerchantNewOrder: jest.fn() }));
jest.mock('@/lib/fulfilment/notify-trigger', () => ({ triggerFulfilmentNotification: jest.fn() }));
process.env.NEXT_PUBLIC_APP_URL = 'https://staging.khatario.com';

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { notifyStoreEvent } from '@/lib/store/notify-whatsapp';
import { enqueueCustomerPush } from '@/lib/push/customer-push';
import { signStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { GET as getCart, PUT as putCart } from '@/app/api/public/store/[subdomain]/cart/route';
import { POST as placeOrder } from '@/app/api/public/store/[subdomain]/orders/route';
import {
  claimDueCarts,
  markRecovered,
  purgeStaleCarts,
  readCart,
  saveCart,
  sendCartReminder,
  type CartLine,
} from '@/lib/store/abandoned-carts';

const mockPush = enqueueCustomerPush as jest.Mock;
const mockWa = notifyStoreEvent as jest.Mock;

d('store abandoned carts (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID(); // reminders on, 3 h
  const OFF = randomUUID(); // reminders off
  const tag = B.slice(0, 8);
  const SUB = `ac-${tag}`;
  const ids = new Set<string>();
  const BR = randomUUID();
  const OWNER = randomUUID();
  const ATTA = randomUUID();
  const HIDDEN = randomUUID();
  const VARIANT = randomUUID();

  const lines = (n = 2): CartLine[] =>
    Array.from({ length: n }, (_, i) => ({
      item_id: randomUUID(),
      variant_id: null,
      quantity: i + 1,
      price: 125,
      name: ['Basmati rice 5 kg', 'Ghee 1 L', 'Atta 10 kg', 'Salt'][i] ?? `Thing ${i}`,
      image_url: null,
    }));

  let seq = 0;
  async function shopper(business = B, name = 'Priya Sharma'): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await pool.query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, $4)`, [
      id,
      business,
      `97${String(Date.now()).slice(-6)}${String(seq).padStart(2, '0')}`,
      name,
    ]);
    return id;
  }
  /** Saves a cart then back-dates it so it looks abandoned `ago` ago. */
  async function abandoned(business: string, customer: string, ago: string): Promise<string> {
    await saveCart(business, customer, lines());
    const r = await pool.query(
      `UPDATE store_carts SET updated_at = now() - $3::interval WHERE business_id = $1 AND customer_id = $2 RETURNING id`,
      [business, customer, ago],
    );
    ids.add(r.rows[0].id);
    return r.rows[0].id;
  }
  async function order(customer: string, ago: string): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders (id, business_id, order_number, customer_name, customer_phone, status, store_customer_id, created_at)
       VALUES ($1, $2, $3, 'Buyer', '9000000000', 'pending', $4, now() - $5::interval)`,
      [id, B, `AC-${tag}-${seq}`, customer, ago],
    );
    return id;
  }
  const cartApi = (method: 'GET' | 'PUT', customer: string | null, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (customer) headers.cookie = `${STORE_CUSTOMER_COOKIE}=${signStoreCustomer(B, customer)}`;
    const req = new NextRequest(`http://localhost/api/public/store/${SUB}/cart`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (method === 'GET' ? getCart : putCart)(req, { params: { subdomain: SUB } });
  };
  const cartOf = async (customer: string) =>
    (await pool.query(`SELECT * FROM store_carts WHERE business_id = $1 AND customer_id = $2`, [B, customer])).rows[0];
  const cartRow = async (id: string) => (await pool.query(`SELECT * FROM store_carts WHERE id = $1`, [id])).rows[0];
  const ours = (rows: { id: string }[]) => rows.filter((r) => ids.has(r.id));

  beforeAll(async () => {
    pool = getPool();
    const db = (await pool.query(`SELECT current_database() AS db`)).rows[0].db;
    if (db !== TEST_DB) throw new Error(`Refusing: connected to ${db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, phone)
       VALUES ($1, $2, $3, '27', 'regular', '9000000007'), ($4, $5, $6, '27', 'regular', '9000000008')`,
      [
        B, `Cart Traders ${tag}`, `27AABCC${tag.slice(0, 4).toUpperCase()}K1Z5`,
        OFF, `Quiet Traders ${tag}`, `27AABCQ${tag.slice(0, 4).toUpperCase()}K1Z5`,
      ],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled, store_cart_reminder_enabled, store_cart_reminder_hours)
       VALUES ($1, $2, true, true, 3), ($3, $4, true, false, 3)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain, store_enabled = true,
         store_cart_reminder_enabled = EXCLUDED.store_cart_reminder_enabled,
         store_cart_reminder_hours = EXCLUDED.store_cart_reminder_hours`,
      [B, SUB, OFF, `aq-${tag}`],
    );
    // Catalogue and books for the cart API and a real store order.
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Owner', $3, true, true)`,
      [OWNER, B, `96${String(Date.now()).slice(-8)}`],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active, item_type, image_url)
       VALUES ($1, $3, 'Atta', 'PCS', 100, 0, 1000, true, true, 'goods', 'https://img.example/atta.jpg'),
              ($2, $3, 'Secret stock', 'PCS', 70, 0, 1000, false, true, 'goods', null)`,
      [ATTA, HIDDEN, B],
    );
    await pool.query(
      `INSERT INTO item_variants (id, item_id, variant_name, selling_price, current_stock) VALUES ($1, $2, '10 kg', 450, 100)`,
      [VARIANT, ATTA],
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 1000)`,
      [B, BR, ATTA],
    );
  });

  beforeEach(() => {
    mockPush.mockReset().mockResolvedValue({ queued: false, reason: 'no_device' });
    mockWa.mockReset().mockResolvedValue({ via: 'qr' });
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM store_carts WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
          await c.query(`DELETE FROM stock_reservations WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
          await c.query(`DELETE FROM store_orders WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OFF]]);
        });
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    } finally {
      await closePool();
    }
  });

  test('claims only carts older than the business setting and not yet reminded', async () => {
    const old = await abandoned(B, await shopper(), '4 hours');
    const fresh = await abandoned(B, await shopper(), '2 hours');
    const already = await abandoned(B, await shopper(), '5 hours');
    await pool.query(`UPDATE store_carts SET reminded_at = now() - interval '1 hour' WHERE id = $1`, [already]);

    const claimed = ours(await claimDueCarts());
    expect(claimed.map((c) => c.id)).toEqual([old]);
    expect(claimed[0]).toMatchObject({
      businessId: B,
      storeName: `Cart Traders ${tag}`,
      storeSubdomain: SUB,
      customerName: 'Priya Sharma',
      subtotal: 375,
    });
    expect(claimed[0].lines).toHaveLength(2);
    expect((await cartRow(old)).reminded_at).not.toBeNull();
    expect((await cartRow(fresh)).reminded_at).toBeNull();
  });

  test('skips a business with reminders off', async () => {
    const off = await abandoned(OFF, await shopper(OFF), '10 hours');
    expect(ours(await claimDueCarts()).map((c) => c.id)).not.toContain(off);
    expect((await cartRow(off)).reminded_at).toBeNull();
  });

  test('skips a cart whose shopper ordered after leaving it', async () => {
    const s = await shopper();
    const cart = await abandoned(B, s, '6 hours');
    await order(s, '1 hour');
    const s2 = await shopper();
    const cart2 = await abandoned(B, s2, '6 hours');
    await order(s2, '8 hours'); // before leaving the cart: still due
    const claimed = ours(await claimDueCarts()).map((c) => c.id);
    expect(claimed).not.toContain(cart);
    expect(claimed).toContain(cart2);
  });

  test('a second claim run returns nothing', async () => {
    await abandoned(B, await shopper(), '7 hours');
    expect(ours(await claimDueCarts()).length).toBeGreaterThan(0);
    expect(ours(await claimDueCarts())).toEqual([]);
  });

  test('empty save marks the cart cleared', async () => {
    const s = await shopper();
    await saveCart(B, s, lines());
    expect(await readCart(B, s)).toHaveLength(2);
    await saveCart(B, s, []);
    const row = (await pool.query(`SELECT status, items, subtotal FROM store_carts WHERE business_id=$1 AND customer_id=$2`, [B, s]))
      .rows[0];
    expect(row).toMatchObject({ status: 'cleared', items: [], subtotal: '0.00' });
    expect(await readCart(B, s)).toEqual([]);
  });

  test('saving keeps reminded_at on an open cart', async () => {
    const s = await shopper();
    const cart = await abandoned(B, s, '5 hours');
    await pool.query(`UPDATE store_carts SET reminded_at = now() WHERE id = $1`, [cart]);
    await saveCart(B, s, lines(3));
    const row = await cartRow(cart);
    expect(row.status).toBe('open');
    expect(row.reminded_at).not.toBeNull();
  });

  test('refuses more than 50 lines and quantities outside 1-999', async () => {
    const s = await shopper();
    await expect(saveCart(B, s, lines(1).concat(...Array.from({ length: 50 }, () => lines(1))))).rejects.toMatchObject({
      code: 'too_many_lines',
    });
    await expect(saveCart(B, s, [{ ...lines(1)[0], quantity: 1000 }])).rejects.toMatchObject({ code: 'bad_quantity' });
    await expect(saveCart(B, s, [{ ...lines(1)[0], quantity: 0 }])).rejects.toMatchObject({ code: 'bad_quantity' });
  });

  test('markRecovered sets status and order id', async () => {
    const s = await shopper();
    const cart = await abandoned(B, s, '1 hour');
    const orderId = await order(s, '0 hours');
    const c = await pool.connect();
    try {
      await markRecovered(c, B, s, orderId);
    } finally {
      c.release();
    }
    expect(await cartRow(cart)).toMatchObject({ status: 'recovered', recovered_order_id: orderId });
    // Clearing the storefront cart after checkout keeps the recovery on record.
    await saveCart(B, s, []);
    expect((await cartRow(cart)).status).toBe('recovered');
  });

  test('a new cart after recovery is open with reminded_at reset', async () => {
    const s = await shopper();
    const cart = await abandoned(B, s, '5 hours');
    await pool.query(`UPDATE store_carts SET reminded_at = now(), reminder_via = 'push' WHERE id = $1`, [cart]);
    const c = await pool.connect();
    try {
      await markRecovered(c, B, s, await order(s, '0 hours'));
    } finally {
      c.release();
    }
    await saveCart(B, s, lines(1));
    const row = await cartRow(cart);
    expect(row).toMatchObject({ status: 'open', reminded_at: null, reminder_via: null, recovered_order_id: null });
  });

  test('sendCartReminder falls back to WhatsApp when the shopper has no device', async () => {
    await abandoned(B, await shopper(), '9 hours');
    const [due] = ours(await claimDueCarts());
    const res = await sendCartReminder(due, 'auto');
    expect(res).toEqual({ sent: true, channel: 'whatsapp' });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockWa).toHaveBeenCalledTimes(1);
    expect(mockWa).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: B,
        eventKey: 'store_cart_reminder',
        phone: due.phone,
        values: expect.objectContaining({
          customer_name: 'Priya Sharma',
          store_name: `Cart Traders ${tag}`,
          item_names: 'Basmati rice 5 kg, Ghee 1 L',
          total: '375.00',
          cart_link: `https://${SUB}.staging.khatario.com/cart`,
        }),
      }),
    );
    expect((await cartRow(due.id)).reminder_via).toBe('whatsapp');
  });

  test('sendCartReminder pushes only when a device takes the job', async () => {
    mockPush.mockResolvedValue({ queued: true });
    await abandoned(B, await shopper(), '9 hours');
    const [due] = ours(await claimDueCarts());
    expect(await sendCartReminder(due, 'auto')).toEqual({ sent: true, channel: 'push' });
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: B, eventKey: 'store_cart_reminder', href: '/cart' }),
    );
    expect(mockWa).not.toHaveBeenCalled();
    expect((await cartRow(due.id)).reminder_via).toBe('push');
  });

  test('a failed auto send still keeps reminded_at', async () => {
    mockWa.mockResolvedValue({ via: null });
    await abandoned(B, await shopper(), '9 hours');
    const [due] = ours(await claimDueCarts());
    const res = await sendCartReminder(due, 'auto');
    expect(res.sent).toBe(false);
    expect((await cartRow(due.id)).reminded_at).not.toBeNull();
  });

  test('a claimed cart with a corrupt line is logged, not thrown', async () => {
    const cart = await abandoned(B, await shopper(), '9 hours');
    await pool.query(
      `UPDATE store_carts SET items = '[{"item_id":"x","variant_id":null,"quantity":1,"price":5,"name":42,"image_url":null}]'::jsonb
        WHERE id = $1`,
      [cart],
    );
    const due = ours(await claimDueCarts()).find((c) => c.id === cart);
    expect(due).toBeDefined();
    const res = await sendCartReminder(due!, 'auto');
    expect(res).toMatchObject({ sent: false, channel: null });
    expect(res.error).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockWa).not.toHaveBeenCalled();
    expect((await cartRow(cart)).reminded_at).not.toBeNull();
  });

  test('manual send records manual and respects the 24 h window', async () => {
    const cart = await abandoned(B, await shopper(), '1 hour');
    expect(await sendCartReminder({ id: cart, businessId: B }, 'manual')).toEqual({ sent: true, channel: 'whatsapp' });
    const row = await cartRow(cart);
    expect(row.reminder_via).toBe('manual');
    expect(row.reminded_at).not.toBeNull();
    const again = await sendCartReminder({ id: cart, businessId: B }, 'manual');
    expect(again).toMatchObject({ sent: false, channel: null, error: 'too_soon' });
    expect(mockWa).toHaveBeenCalledTimes(1);
  });

  test("manual send for another business's cart is not found", async () => {
    const cart = await abandoned(OFF, await shopper(OFF), '1 hour');
    expect(await sendCartReminder({ id: cart, businessId: B }, 'manual')).toMatchObject({
      sent: false,
      channel: null,
      error: 'not_found',
    });
    expect((await cartRow(cart)).reminded_at).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockWa).not.toHaveBeenCalled();
  });

  test('purgeStaleCarts deletes open and cleared carts untouched for 30 days', async () => {
    const stale = await abandoned(B, await shopper(), '31 days');
    const s = await shopper();
    const kept = await abandoned(B, s, '31 days');
    await pool.query(`UPDATE store_carts SET status = 'recovered' WHERE id = $1`, [kept]);
    expect(await purgeStaleCarts()).toBeGreaterThanOrEqual(1);
    expect(await cartRow(stale)).toBeUndefined();
    expect(await cartRow(kept)).toBeDefined();
  });
  test('cart API: GET and PUT need a store sign-in', async () => {
    expect((await cartApi('GET', null)).status).toBe(401);
    expect((await cartApi('PUT', null, { lines: [] })).status).toBe(401);
  });

  test('cart API: PUT ignores a client-sent price, name and image', async () => {
    const s = await shopper();
    const res = await cartApi('PUT', s, {
      lines: [
        { item_id: ATTA, variant_id: null, quantity: 2, price: 1, name: 'Free atta', image_url: 'https://evil.example/x.png' },
        { item_id: ATTA, variant_id: VARIANT, quantity: 1, price: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = await cartOf(s);
    expect(row.status).toBe('open');
    expect(row.items).toEqual([
      { item_id: ATTA, variant_id: null, quantity: 2, price: 100, name: 'Atta', image_url: 'https://img.example/atta.jpg' },
      { item_id: ATTA, variant_id: VARIANT, quantity: 1, price: 450, name: 'Atta – 10 kg', image_url: 'https://img.example/atta.jpg' },
    ]);
    expect(Number(row.subtotal)).toBe(650);

    const got = await cartApi('GET', s);
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).toMatchObject({ item_id: ATTA, variant_id: null, quantity: 2, price: 100, name: 'Atta' });
  });

  test('cart API: PUT drops a hidden or unknown item and a variant of another item', async () => {
    const s = await shopper();
    const res = await cartApi('PUT', s, {
      lines: [
        { item_id: HIDDEN, variant_id: null, quantity: 1 },
        { item_id: randomUUID(), variant_id: null, quantity: 1 },
        { item_id: HIDDEN, variant_id: VARIANT, quantity: 1 },
        { item_id: ATTA, variant_id: null, quantity: 3 },
      ],
    });
    expect(res.status).toBe(200);
    const row = await cartOf(s);
    expect(row.items.map((l: CartLine) => l.item_id)).toEqual([ATTA]);
    expect(row.items[0].quantity).toBe(3);
  });

  test('cart API: a bad quantity is a 400', async () => {
    const s = await shopper();
    const res = await cartApi('PUT', s, { lines: [{ item_id: ATTA, variant_id: null, quantity: 0 }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  test('placing a store order marks the open cart recovered', async () => {
    const s = await shopper();
    const phone = (await pool.query(`SELECT phone FROM store_customers WHERE id = $1`, [s])).rows[0].phone;
    expect((await cartApi('PUT', s, { lines: [{ item_id: ATTA, variant_id: null, quantity: 1 }] })).status).toBe(200);
    const res = await placeOrder(
      new NextRequest(`http://localhost/api/public/store/${SUB}/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${STORE_CUSTOMER_COOKIE}=${signStoreCustomer(B, s)}`,
        },
        body: JSON.stringify({
          payment_method: 'cod',
          delivery_mode: 'pickup',
          customer_name: 'Priya Sharma',
          customer_phone: phone,
          items: [{ item_id: ATTA, quantity: 1 }],
        }),
      }),
      { params: { subdomain: SUB } },
    );
    const json = (await res.json()) as { order_id?: string; error?: string };
    expect(res.status).toBe(200);
    expect(await cartOf(s)).toMatchObject({ status: 'recovered', recovered_order_id: json.order_id });
    expect(await (await cartApi('GET', s)).json()).toEqual({ lines: [] });
  });
});
