/**
 * Party pricing (migration 434) against real PostgreSQL: price levels with quantity slabs and dates,
 * customer discounts, category discounts, price history, last rates and the Supplier Hub buyer price.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn(async () => undefined),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn(async () => undefined),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as levelsPOST } from '@/app/api/pricing/levels/route';
import { POST as ratesPOST } from '@/app/api/pricing/levels/[id]/rates/route';
import { POST as partyPOST } from '@/app/api/pricing/party-item/route';
import { POST as categoryPOST } from '@/app/api/pricing/party-category/route';
import { GET as historyGET } from '@/app/api/pricing/history/route';
import { POST as resolvePOST } from '@/app/api/pricing/resolve/route';
import { lastPurchaseRates } from '@/lib/pricing/resolve-price';
import { BUYER_PRICE_JOIN } from '@/lib/pricing/buyer-price-sql';

d('price levels and party pricing (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const BUYER_BIZ = randomUUID();
  const USER = randomUUID();
  const CUSTOMER = randomUUID();
  const CATEGORY = randomUUID();
  const ITEM_A = randomUUID();
  const ITEM_C = randomUUID();
  const SUPPLIER = randomUUID();
  const BRANCH = randomUUID();
  let levelId = '';

  const headers = {
    'x-authenticated-user-id': USER,
    'x-authenticated-business-id': BIZ,
    'x-authenticated-session-version': '1',
    'content-type': 'application/json',
  };
  const post = async (fn: (r: NextRequest, ctx?: any) => Promise<Response>, path: string, body: unknown, ctx?: unknown) => {
    const res = await fn(new NextRequest(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), ctx);
    return { status: res.status, body: await res.json() };
  };
  const resolve = async (itemId: string, qty: number, date = '2026-10-28') => {
    const r = await post(resolvePOST, '/api/pricing/resolve', { customer_id: CUSTOMER, date, lines: [{ item_id: itemId, qty }] });
    expect(r.status).toBe(200);
    return r.body.lines[0];
  };

  beforeAll(async () => {
    pool = getPool();
    for (const [id, name] of [[BIZ, 'Pricing seller'], [BUYER_BIZ, 'Pricing buyer']]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [id, name]
      );
    }
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_active) VALUES ($1, $2, 'Pricing tester', $3, true)`, [
      USER,
      BIZ,
      `7${Date.now().toString().slice(-9)}`,
    ]);
    await pool.query(`INSERT INTO customers (id, business_id, name, linked_business_id) VALUES ($1, $2, 'Level buyer', $3)`, [
      CUSTOMER,
      BIZ,
      BUYER_BIZ,
    ]);
    await pool.query(`INSERT INTO categories (id, business_id, name) VALUES ($1, $2, 'Brand X')`, [CATEGORY, BIZ]);
    await pool.query(`INSERT INTO branches (id, business_id, name) VALUES ($1, $2, 'Main')`, [BRANCH, BIZ]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate) VALUES ($1, $2, 'Soap', 'PCS', 70, 100, 18)`,
      [ITEM_A, BIZ]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate, category_id)
       VALUES ($1, $2, 'Shampoo', 'PCS', 150, 200, 18, $3)`,
      [ITEM_C, BIZ, CATEGORY]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[BIZ, BUYER_BIZ]]);
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

  it('creates a level, rejects a duplicate name and puts the customer on it', async () => {
    const created = await post(levelsPOST, '/api/pricing/levels', { name: 'Wholesale' });
    expect(created.status).toBe(201);
    levelId = created.body.level.id;
    expect((await post(levelsPOST, '/api/pricing/levels', { name: 'wholesale' })).status).toBe(409);
    expect((await post(levelsPOST, '/api/pricing/levels', { assign: { price_level_id: levelId, customer_ids: [CUSTOMER] } })).body).toEqual({
      ok: true,
      updated: 1,
    });
  });

  it('bills level rates by quantity slab and date', async () => {
    const r = await post(ratesPOST, `/api/pricing/levels/${levelId}/rates`, {
      rows: [
        { item_id: ITEM_A, price: 95 },
        { item_id: ITEM_A, min_qty: 10, price: 90 },
        { item_id: ITEM_A, price: 50, valid_from: '2026-12-01', valid_to: '2026-12-31' },
      ],
    }, { params: { id: levelId } });
    expect(r).toEqual({ status: 200, body: { ok: true, saved: 3 } });

    expect(await resolve(ITEM_A, 1)).toMatchObject({ price: 95, priceSource: 'level', levelName: 'Wholesale', costPrice: 70 });
    expect((await resolve(ITEM_A, 12)).price).toBe(90);
    expect((await resolve(ITEM_A, 1, '2026-12-05')).price).toBe(50);
    expect((await resolve(ITEM_A, 1, '2027-01-05')).price).toBe(95);
  });

  it('applies a customer discount on the level price, then a customer price over the level', async () => {
    expect((await post(partyPOST, '/api/pricing/party-item', { party_id: CUSTOMER, item_id: ITEM_A, discount_percent: 5 })).status).toBe(200);
    expect(await resolve(ITEM_A, 1)).toMatchObject({ price: 95, priceSource: 'level', discountPercent: 5, discountSource: 'party' });

    await post(partyPOST, '/api/pricing/party-item', { party_id: CUSTOMER, item_id: ITEM_A, price: 80, discount_percent: 5 });
    expect(await resolve(ITEM_A, 12)).toMatchObject({ price: 80, priceSource: 'party', discountPercent: 5 });

    const bad = await post(partyPOST, '/api/pricing/party-item', { party_id: CUSTOMER, item_id: ITEM_A, price: 80, valid_from: '2026-12-01', valid_to: '2026-11-01' });
    expect(bad.status).toBe(400);
  });

  it('gives a category discount to items with no rule of their own', async () => {
    const r = await post(categoryPOST, '/api/pricing/party-category', { party_id: CUSTOMER, rows: [{ category_id: CATEGORY, discount_percent: 7 }] });
    expect(r.status).toBe(200);
    expect(await resolve(ITEM_C, 1)).toMatchObject({ price: 200, priceSource: 'catalog', discountPercent: 7, discountSource: 'category' });
  });

  it('logs every change with who made it', async () => {
    const res = await historyGET(new NextRequest(`http://localhost/api/pricing/history?party_id=${CUSTOMER}`, { headers }));
    const { history } = await res.json();
    expect(history.map((h: any) => h.scope).sort()).toEqual(['party_category', 'party_item', 'party_item']);
    const priceChange = history.find((h: any) => h.new_price === 80);
    expect(priceChange).toMatchObject({ old_price: null, old_discount_percent: 5, new_discount_percent: 5, changed_by_name: 'Pricing tester' });
  });

  it('shows the last rate charged, pre-GST, from final bills only', async () => {
    const inv = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, prices_include_gst)
       VALUES ($1, $2, $4, $3, 'PL-1', '2026-10-20', 'final', true)`,
      [inv, BIZ, CUSTOMER, BRANCH]
    );
    await pool.query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, quantity, unit_price, tax_rate, discount_percent, line_total)
       VALUES ($1, $2, 'Soap', 1, 118, 18, 2, 115.64)`,
      [inv, ITEM_A]
    );
    expect((await resolve(ITEM_A, 1)).lastSale).toEqual({ exclusivePrice: 100, discountPercent: 2, date: '2026-10-20', documentNumber: 'PL-1' });
  });

  it('reads the last rate paid to a supplier', async () => {
    await pool.query(`INSERT INTO suppliers (id, business_id, name) VALUES ($1, $2, 'Soap supplier')`, [SUPPLIER, BIZ]);
    const pur = randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, branch_id, supplier_id, bill_number, bill_date, status)
       VALUES ($1, $2, $4, $3, 'B-9', '2026-10-15', 'final')`,
      [pur, BIZ, SUPPLIER, BRANCH]
    );
    await pool.query(
      `INSERT INTO purchase_items (purchase_id, item_id, item_name, quantity, unit_price, tax_rate, line_total, tax_mode)
       VALUES ($1, $2, 'Soap', 10, 82.6, 18, 826, 'inclusive')`,
      [pur, ITEM_A]
    );
    const rates = await lastPurchaseRates(pool, BIZ, SUPPLIER, [ITEM_A, ITEM_C]);
    expect(rates.get(ITEM_A)).toEqual({ exclusivePrice: 70, discountPercent: 0, date: '2026-10-15', documentNumber: 'B-9' });
    expect(rates.has(ITEM_C)).toBe(false);
  });

  it('shows the hub buyer the linked customer price', async () => {
    const r = await pool.query(
      `SELECT i.id, bp.price::float AS price FROM items i ${BUYER_PRICE_JOIN('i.business_id', '$2::uuid', 'i.id')}
        WHERE i.business_id = $1 ORDER BY i.name`,
      [BIZ, BUYER_BIZ]
    );
    expect(r.rows).toEqual([
      { id: ITEM_C, price: null },
      { id: ITEM_A, price: 80 },
    ]);
  });
});
