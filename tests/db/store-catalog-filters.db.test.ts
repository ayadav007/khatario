/**
 * Store catalog filters, facets and suggest on a real database (store shopping features, phase 1).
 * Proves the SQL casts of the new filters (brand/category ANY, ids order, in-stock, discount) and
 * every sort. Opt-in, disposable DB only:
 *   STORE_FEATURES_DB_TEST=1 npx jest tests/db/store-catalog-filters.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
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

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { GET as getItems } from '@/app/api/public/store/[subdomain]/items/route';
import { GET as getFacets } from '@/app/api/public/store/[subdomain]/items/facets/route';
import { GET as getSuggest } from '@/app/api/public/store/[subdomain]/search/suggest/route';

d('store catalog filters (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const OWNER = randomUUID();
  const CAT_DAIRY = randomUUID();
  const CAT_STAPLES = randomUUID();
  const MILK = randomUUID(); // Amul, dairy, mrp 200 price 100
  const CURD = randomUUID(); // Mother Dairy, dairy, 60
  const GHEE = randomUUID(); // Amul, dairy, out of stock, 500
  const ATTA = randomUUID(); // no brand, staples, 300
  const tag = B.slice(0, 8);
  const SUB = `cf-${tag}`;

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

  const req = (path: string, qs = '') =>
    new NextRequest(`http://localhost/api/public/store/${SUB}/${path}${qs ? `?${qs}` : ''}`);
  const ctx = { params: { subdomain: SUB } };
  async function items(qs: string) {
    const res = await getItems(req('items', qs), ctx);
    return { status: res.status, json: (await res.json()) as any };
  }
  const ids = (j: any) => j.items.map((i: any) => i.id);

  beforeAll(async () => {
    pool = getPool();
    const db = (await pool.query(`SELECT current_database() AS db`)).rows[0].db;
    if (db !== TEST_DB) throw new Error(`Refusing: connected to ${db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, phone)
       VALUES ($1, $2, $3, '27', 'regular', '9000000002')`,
      [B, `Catalog Traders ${tag}`, `27AABCC${tag.slice(0, 4).toUpperCase()}K1Z5`],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Owner', $3, true, true)`,
      [OWNER, B, `91${Date.now().toString().slice(-9)}`],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled) VALUES ($1, $2, true)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain, store_enabled = true`,
      [B, SUB],
    );
    await pool.query(
      `INSERT INTO categories (id, business_id, name) VALUES ($1, $3, 'Dairy'), ($2, $3, 'Staples')`,
      [CAT_DAIRY, CAT_STAPLES, B],
    );
    const insertItem = (
      id: string,
      name: string,
      cat: string,
      brand: string | null,
      price: number,
      mrp: number | null,
      stock: number,
    ) =>
      pool.query(
        `INSERT INTO items (id, business_id, name, unit, selling_price, mrp, tax_rate, current_stock, category_id, brand,
                            show_in_store, is_active, item_type)
         VALUES ($1, $2, $3, 'PCS', $4, $5, 0, $6, $7, $8, true, true, 'goods')`,
        [id, B, name, price, mrp, stock, cat, brand],
      );
    await insertItem(MILK, 'Full Cream Milk', CAT_DAIRY, 'Amul', 100, 200, 50);
    await insertItem(CURD, 'Fresh Curd', CAT_DAIRY, 'Mother Dairy', 60, null, 20);
    await insertItem(GHEE, 'Pure Ghee', CAT_DAIRY, 'Amul', 500, null, 0);
    await insertItem(ATTA, 'Atta 5kg', CAT_STAPLES, null, 300, null, 10);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', OWNER, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
    } finally {
      await closePool();
    }
  });

  test('filters by brand and in-stock', async () => {
    const r = await items('brand=Amul&stock=1');
    expect(r.status).toBe(200);
    expect(ids(r.json)).toEqual([MILK]);
    expect(r.json.total).toBe(1);
    const both = await items('brand=Amul,Mother%20Dairy');
    expect(ids(both.json).sort()).toEqual([MILK, CURD, GHEE].sort());
  });

  test('filters by category, price range and discount', async () => {
    const cat = await items(`cat=${CAT_STAPLES}`);
    expect(ids(cat.json)).toEqual([ATTA]);
    const price = await items('min=80&max=400');
    expect(ids(price.json).sort()).toEqual([MILK, ATTA].sort());
    const disc = await items('disc=50');
    expect(ids(disc.json)).toEqual([MILK]);
    const old = await items(`category_id=${CAT_DAIRY}&max_price=100`);
    expect(ids(old.json).sort()).toEqual([MILK, CURD].sort());
  });

  test('every sort runs and orders as expected', async () => {
    for (const sort of ['name', 'new', 'bestsellers', 'price_asc', 'price_desc', 'discount', 'rating']) {
      const r = await items(`sort=${sort}`);
      expect(r.status).toBe(200);
      expect(r.json.items).toHaveLength(4);
    }
    expect(ids((await items('sort=price_asc')).json)).toEqual([CURD, MILK, ATTA, GHEE]);
    expect(ids((await items('sort=price_desc')).json)).toEqual([GHEE, ATTA, MILK, CURD]);
    expect(ids((await items('sort=discount')).json)[0]).toBe(MILK);
  });

  test('byIds returns requested order and only items', async () => {
    const r = await items(`ids=${ATTA},${MILK},${CURD}&sort=price_desc`);
    expect(ids(r.json)).toEqual([ATTA, MILK, CURD]);
    expect(r.json.categories).toBeUndefined();
    const bad = await items('ids=nope');
    expect(bad.status).toBe(200);
    expect(bad.json.items).toHaveLength(4);
  });

  test('facets count brands ignoring the brand filter', async () => {
    const res = await getFacets(req('items/facets', 'brand=Amul'), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
    const f = (await res.json()) as any;
    expect(f.brands).toEqual([
      { name: 'Amul', count: 2 },
      { name: 'Mother Dairy', count: 1 },
    ]);
    expect(f.price).toEqual({ min: 100, max: 500 }); // price facet keeps the brand filter;
    expect(f.categories).toEqual(expect.arrayContaining([{ id: CAT_DAIRY, name: 'Dairy', count: 2 }]));
    expect(f.discount.find((b: any) => b.pct === 50).count).toBe(1);
    expect(f.inStock).toBe(1);
  });

  test('suggest finds "amu" by brand and "dai" mid-word', async () => {
    const amu = (await (await getSuggest(req('search/suggest', 'q=amu'), ctx)).json()) as any;
    expect(amu.products.map((p: any) => p.id).sort()).toEqual([MILK, GHEE].sort());
    const dai = (await (await getSuggest(req('search/suggest', 'q=dai'), ctx)).json()) as any;
    expect(dai.products.map((p: any) => p.id)).toEqual([CURD]);
    expect(dai.categories).toEqual([{ id: CAT_DAIRY, name: 'Dairy' }]);
    const short = (await (await getSuggest(req('search/suggest', 'q=a'), ctx)).json()) as any;
    expect(short).toEqual({ products: [], categories: [] });
  });

  test('unknown store is a 404', async () => {
    const res = await getFacets(req('items/facets'), { params: { subdomain: `nope-${tag}` } });
    expect(res.status).toBe(404);
  });
});
