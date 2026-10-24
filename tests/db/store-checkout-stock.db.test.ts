/**
 * Online store checkout stock: the cart is checked against on-hand minus other orders' holds,
 * placing an order holds its quantities, and the hold ends on invoice (fulfilled) or cancel.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

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
import {
  checkStoreCartStock,
  holdStoreOrderStock,
  releaseStoreOrderStock,
  shortfallMessage,
} from '@/lib/store/checkout-stock';
import { createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';

d('store checkout stock (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const ITEM = randomUUID();
  const SERVICE = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `8${String(Date.now()).slice(-9)}`;
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

  const line = (quantity: number, item_id = ITEM) => ({
    item_id,
    variant_id: null,
    item_name: item_id === ITEM ? 'Widget' : 'Fitting',
    quantity,
  });

  async function setOnHand(qty: number) {
    await pool.query(`UPDATE items SET current_stock = $2 WHERE id = $1`, [ITEM, qty]);
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (business_id, branch_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [B, BR, ITEM, qty],
    );
  }

  async function seedOrder(qty: number): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Buyer',$5,'pending','cod',$6,0,0,0,$6,'pickup')`,
      [id, B, BR, `CS-${tag}-${seq}`, phone, qty * 100],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',$3,'PCS',100,0,$4)`,
      [id, ITEM, qty, qty * 100],
    );
    await tx((c) => holdStoreOrderStock(c, { businessId: B, orderId: id, lines: [line(qty)], expiresAt: null }));
    return id;
  }

  async function holdStatus(orderId: string): Promise<string[]> {
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM stock_reservations WHERE reserved_for_type = 'store_order' AND reserved_for_id = $1`,
      [orderId],
    );
    return r.rows.map((x) => x.status);
  }

  const check = (lines: ReturnType<typeof line>[]) =>
    tx((c) => checkStoreCartStock(c, { businessId: B, branchId: BR, lines }));

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `Checkout stock ${tag}`, `27AABCS${tag.slice(0, 4).toUpperCase()}A1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk', $3, true)`,
      [A, B, `93${phone}`],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, current_stock)
       VALUES ($1, $3, 'Widget', 'goods', 'PCS', 100, 40, 0, 5),
              ($2, $3, 'Fitting', 'service', 'NOS', 50, 0, 0, 0)`,
      [ITEM, SERVICE, B],
    );
    await setOnHand(5);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM stock_reservations WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM store_orders WHERE business_id = $1`, [B]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('a cart within stock passes; more than on-hand is short', async () => {
    expect(await check([line(5)])).toEqual([]);
    const short = await check([line(6)]);
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({ item_id: ITEM, requested: 6, available: 5 });
    expect(shortfallMessage(short)).toBe('Only 5 left: Widget. Please update your cart.');
  });

  test('the same item on two lines is checked as one total', async () => {
    expect(await check([line(3), line(3)])).toHaveLength(1);
  });

  test('services are not stock-checked', async () => {
    expect(await check([line(99, SERVICE)])).toEqual([]);
  });

  test('an item allowed to sell when out of stock is not blocked', async () => {
    await pool.query(`UPDATE items SET allow_sale_when_out_of_stock = true WHERE id = $1`, [ITEM]);
    try {
      expect(await check([line(99)])).toEqual([]);
    } finally {
      await pool.query(`UPDATE items SET allow_sale_when_out_of_stock = NULL WHERE id = $1`, [ITEM]);
    }
  });

  test("another order's hold lowers what is available; cancelling it frees the stock", async () => {
    const first = await seedOrder(4);
    expect(await holdStatus(first)).toEqual(['active']);
    const short = await check([line(2)]);
    expect(short[0]).toMatchObject({ available: 1 });

    await transitionStoreOrder({ businessId: B, orderId: first, to: 'cancelled', cancelledReason: 'Changed mind' });
    expect(await holdStatus(first)).toEqual(['cancelled']);
    expect(await check([line(5)])).toEqual([]);
  });

  test('an expired hold no longer blocks stock', async () => {
    const id = randomUUID();
    await tx((c) =>
      holdStoreOrderStock(c, {
        businessId: B,
        orderId: id,
        lines: [line(5)],
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    expect(await check([line(5)])).toEqual([]);
    await tx((c) => releaseStoreOrderStock(c, { businessId: B, orderId: id, outcome: 'cancelled' }));
  });

  test('posting the invoice ends the hold so stock is not counted twice', async () => {
    await setOnHand(5);
    const id = await seedOrder(2);
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    expect(invoiceId).toBeTruthy();
    expect(await holdStatus(id)).toEqual(['fulfilled']);
    const onHand = Number((await pool.query(`SELECT current_stock::float8 AS q FROM items WHERE id = $1`, [ITEM])).rows[0].q);
    expect(onHand).toBe(3);
    // 3 left on the shelf and nothing held: a cart of 3 passes, 4 does not.
    expect(await check([line(3)])).toEqual([]);
    expect(await check([line(4)])).toHaveLength(1);
  });
});
