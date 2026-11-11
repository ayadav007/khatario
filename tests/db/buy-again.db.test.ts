/**
 * Buy again on a real database: the public route returns only the signed-in shopper's own items from this store's
 * orders, never another shopper's or another business's, and never a cancelled order's or a product now hidden.
 * Runs only when PHASE2_TEST_DATABASE_URL points at the disposable kh_phase2_test database:
 *   node .superpowers/sdd/2026-11-01-order-returns-pickup-refund/with-test-db.js npx jest tests/db/buy-again.db.test.ts --runInBand
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const TEST_DB = 'kh_phase2_test';
const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
}));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'buy-again-test-secret';

import { getPool, closePool } from '@/lib/db';
import { signStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { GET as getBuyAgain } from '@/app/api/public/store/[subdomain]/buy-again/route';

type BuyAgainBody = { items: Array<{ id: string; name: string; buy_again_variant_id: string | null }> };

d('Buy again (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const OTHER_B = randomUUID();
  const tag = B.slice(0, 8);
  const SUB = `ba-${tag}`;
  const OTHER_SUB = `bb-${tag}`;

  // Shoppers: ME and NEIGHBOUR in this store; ELSEWHERE in the other business's store.
  const ME = randomUUID();
  const NEIGHBOUR = randomUUID();
  const ELSEWHERE = randomUUID();

  // This store's products.
  const RICE = randomUUID();
  const RICE_1KG = randomUUID();
  const RICE_5KG = randomUUID();
  const DAL = randomUUID();
  const OIL = randomUUID();
  const OIL_1L = randomUUID();
  const HIDDEN = randomUUID();
  const CANCELLED_ONLY = randomUUID();
  const NEIGHBOURS = randomUUID();
  // The other business's product.
  const FOREIGN = randomUUID();

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

  let seq = 0;
  async function order(
    businessId: string,
    customerId: string,
    lines: Array<[itemId: string, variantId: string | null]>,
    opts: { status?: string; ago?: string } = {},
  ): Promise<void> {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders (id, business_id, order_number, customer_name, customer_phone, status, store_customer_id, created_at)
       VALUES ($1, $2, $3, 'Buyer', '9000000000', $4, $5, now() - $6::interval)`,
      [id, businessId, `BA-${tag}-${seq}`, opts.status ?? 'delivered', customerId, opts.ago ?? '0 days'],
    );
    for (const [itemId, variantId] of lines) {
      await pool.query(
        `INSERT INTO store_order_items (order_id, item_id, variant_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, 'Thing', 1, 'PCS', 100, 0, 100)`,
        [id, itemId, variantId],
      );
    }
  }

  async function item(businessId: string, id: string, name: string, extra: { hidden?: boolean; variants?: string[] } = {}) {
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active, item_type, has_variants)
       VALUES ($1, $2, $3, 'PCS', 100, 0, 10, $4, true, 'goods', $5)`,
      [id, businessId, name, !extra.hidden, !!extra.variants?.length],
    );
    for (const [i, v] of (extra.variants ?? []).entries()) {
      await pool.query(
        `INSERT INTO item_variants (id, item_id, variant_name, selling_price, current_stock) VALUES ($1, $2, $3, 100, 10)`,
        [v, id, `Pack ${i + 1}`],
      );
    }
  }

  const request = (subdomain: string, cookie?: string) =>
    getBuyAgain(
      new NextRequest(`http://localhost/api/public/store/${subdomain}/buy-again`, {
        headers: cookie ? { cookie } : {},
      }),
      { params: { subdomain } },
    );
  const cookieFor = (businessId: string, customerId: string) =>
    `${STORE_CUSTOMER_COOKIE}=${signStoreCustomer(businessId, customerId)}`;
  const pairs = (body: BuyAgainBody) => body.items.map((i) => [i.id, i.buy_again_variant_id]);

  beforeAll(async () => {
    pool = getPool();
    const db = (await pool.query(`SELECT current_database() AS db`)).rows[0].db;
    if (db !== TEST_DB) throw new Error(`Refusing: connected to ${db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, phone)
       VALUES ($1, $2, $3, '27', 'regular', '9000000007'), ($4, $5, $6, '27', 'regular', '9000000008')`,
      [
        B, `Buy Again Kirana ${tag}`, `27AABCB${tag.slice(0, 4).toUpperCase()}K1Z5`,
        OTHER_B, `Other Kirana ${tag}`, `27AABCC${tag.slice(0, 4).toUpperCase()}K1Z5`,
      ],
    );
    for (const [biz, sub] of [[B, SUB], [OTHER_B, OTHER_SUB]]) {
      await pool.query(
        `INSERT INTO business_settings (business_id, store_subdomain, store_enabled) VALUES ($1, $2, true)
         ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain, store_enabled = true`,
        [biz, sub],
      );
    }
    const phone = String(Date.now()).slice(-6);
    await pool.query(
      `INSERT INTO store_customers (id, business_id, phone, name)
       VALUES ($1, $2, $3, 'Me'), ($4, $2, $5, 'Neighbour'), ($6, $7, $8, 'Elsewhere')`,
      [ME, B, `9811${phone}`, NEIGHBOUR, `9822${phone}`, ELSEWHERE, OTHER_B, `9833${phone}`],
    );

    await item(B, RICE, 'Sona masoori rice', { variants: [RICE_1KG, RICE_5KG] });
    await item(B, DAL, 'Toor dal');
    await item(B, OIL, 'Groundnut oil', { variants: [OIL_1L] });
    await item(B, HIDDEN, 'Hidden pickle', { hidden: true });
    await item(B, CANCELLED_ONLY, 'Cancelled biscuits');
    await item(B, NEIGHBOURS, 'Neighbour soap');
    await item(OTHER_B, FOREIGN, 'Foreign tea');

    // Mine, oldest first: dal; rice 1 kg (with the hidden product); rice 5 kg; oil 1 L; rice 1 kg again.
    await order(B, ME, [[DAL, null]], { ago: '9 days' });
    await order(B, ME, [[RICE, RICE_1KG], [HIDDEN, null]], { ago: '7 days' });
    await order(B, ME, [[RICE, RICE_5KG]], { ago: '5 days' });
    await order(B, ME, [[OIL, OIL_1L]], { ago: '4 days' });
    await order(B, ME, [[RICE, RICE_1KG]], { ago: '3 days' });
    // My cancelled order is left out.
    await order(B, ME, [[CANCELLED_ONLY, null]], { status: 'cancelled', ago: '1 day' });
    // Another shopper's order in this store.
    await order(B, NEIGHBOUR, [[NEIGHBOURS, null]], { ago: '1 day' });
    // The other business's orders: its own shopper, and one carrying my customer id that must never leak.
    await order(OTHER_B, ELSEWHERE, [[FOREIGN, null]], { ago: '1 day' });
    await order(OTHER_B, ME, [[FOREIGN, null]], { ago: '2 days' });
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          // Order lines restrict item deletion, so orders go first.
          await c.query(`DELETE FROM store_orders WHERE business_id = ANY($1::uuid[])`, [[B, OTHER_B]]);
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER_B]]);
        });
      });
    } finally {
      await closePool();
    }
  });

  it("returns only this customer's own orders in this store", async () => {
    const res = await request(SUB, cookieFor(B, ME));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as BuyAgainBody;
    // Newest first, each pack once at its newest order: rice 1 kg (3 days), oil 1 L (4), rice 5 kg (5), dal (9).
    expect(pairs(body)).toEqual([
      [RICE, RICE_1KG],
      [OIL, OIL_1L],
      [RICE, RICE_5KG],
      [DAL, null],
    ]);
    const ids = body.items.map((i) => i.id);
    expect(ids).not.toContain(NEIGHBOURS);
    expect(ids).not.toContain(FOREIGN);

    // The neighbour sees only their own.
    const theirs = (await (await request(SUB, cookieFor(B, NEIGHBOUR))).json()) as BuyAgainBody;
    expect(pairs(theirs)).toEqual([[NEIGHBOURS, null]]);

    // A session from the other business is no session here.
    const crossed = await request(SUB, cookieFor(OTHER_B, ELSEWHERE));
    expect(((await crossed.json()) as BuyAgainBody).items).toEqual([]);
    // And in the other store, my customer id signed for this business gets nothing.
    const wrongStore = await request(OTHER_SUB, cookieFor(B, ME));
    expect(((await wrongStore.json()) as BuyAgainBody).items).toEqual([]);
  });

  it('leaves out cancelled orders and hidden products', async () => {
    const body = (await (await request(SUB, cookieFor(B, ME))).json()) as BuyAgainBody;
    const ids = body.items.map((i) => i.id);
    expect(ids).not.toContain(CANCELLED_ONLY);
    expect(ids).not.toContain(HIDDEN);

    // A product the shop takes off the store later disappears too.
    await pool.query(`UPDATE items SET show_in_store = false WHERE id = $1`, [DAL]);
    try {
      const after = (await (await request(SUB, cookieFor(B, ME))).json()) as BuyAgainBody;
      expect(after.items.map((i) => i.id)).not.toContain(DAL);
    } finally {
      await pool.query(`UPDATE items SET show_in_store = true WHERE id = $1`, [DAL]);
    }
  });

  it('drops a deleted pack but keeps the product', async () => {
    await pool.query(`DELETE FROM item_variants WHERE id = $1`, [OIL_1L]);
    const body = (await (await request(SUB, cookieFor(B, ME))).json()) as BuyAgainBody;
    expect(pairs(body)).toEqual([
      [RICE, RICE_1KG],
      [OIL, null],
      [RICE, RICE_5KG],
      [DAL, null],
    ]);
  });

  it('returns nothing without a session', async () => {
    const res = await request(SUB);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(((await res.json()) as BuyAgainBody).items).toEqual([]);
    // A forged cookie is no session either.
    const forged = await request(SUB, `${STORE_CUSTOMER_COOKIE}=${B}.${ME}.9999999999.deadbeef`);
    expect(((await forged.json()) as BuyAgainBody).items).toEqual([]);
  });
});
