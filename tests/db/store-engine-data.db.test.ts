/**
 * Store engine section data resolver against real PostgreSQL: request sources, URL-key narrowing,
 * unknown categories and per-section failure isolation.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

// Lets one test make a single list query throw; everything else hits the real database.
const failure = { failNextList: false };
jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db');
  return {
    ...actual,
    queryRows: jest.fn(async (sql: string, params?: unknown[]) => {
      if (failure.failNextList && sql.includes('FROM items i')) {
        failure.failNextList = false;
        throw new Error('forced list failure');
      }
      return actual.queryRows(sql, params);
    }),
  };
});

import { getPool, closePool } from '@/lib/db';
import { resolveSectionData } from '@/lib/store/engine/section-data';
import type { SectionDataRequest } from '@/lib/store/engine/schema-types';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';

d('store engine section data (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const OTHER_BIZ = randomUUID();
  const CAT_A = randomUUID();
  const CAT_B = randomUUID();
  const FEATURED = randomUUID(); // Apple, category A, featured
  const DISCOUNTED = randomUUID(); // Banana, category A, mrp above price
  const PLAIN = randomUUID(); // Cherry, category B, 2026-10-20
  const store = { business_id: BIZ, is_demo: false } as unknown as StoreBusinessContext;

  const req = (products: NonNullable<SectionDataRequest['products']>): Map<string, SectionDataRequest> =>
    new Map([['s', { products }]]);
  async function ids(products: NonNullable<SectionDataRequest['products']>, opts = {}) {
    const out = await resolveSectionData(store, req(products), opts);
    expect(out.s.error).toBeUndefined();
    return out.s.products!.map((p) => p.id);
  }

  beforeAll(async () => {
    pool = getPool();
    for (const biz of [BIZ, OTHER_BIZ]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, 'Engine data test', '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz],
      );
    }
    await pool.query(`INSERT INTO categories (id, business_id, name) VALUES ($1, $2, 'Fruit'), ($3, $2, 'Berry')`, [
      CAT_A,
      BIZ,
      CAT_B,
    ]);
    const rows: Array<[string, string, string, number, number | null, boolean, string, string]> = [
      [FEATURED, 'Apple', CAT_A, 10, null, true, '2025-01-01', 'APL'],
      [DISCOUNTED, 'Banana', CAT_A, 10, 20, false, '2026-05-01', 'BAN'],
      [PLAIN, 'Cherry', CAT_B, 10, null, false, '2026-10-20', 'CHR'],
    ];
    for (const [id, name, cat, price, mrp, featured, created, code] of rows) {
      await pool.query(
        `INSERT INTO items (id, business_id, category_id, name, code, unit, purchase_price, selling_price, mrp,
                            tax_rate, current_stock, show_in_store, featured_in_store, created_at)
         VALUES ($1, $2, $3, $4, $5, 'PCS', 5, $6, $7, 0, 10, true, $8, $9)`,
        [id, BIZ, cat, name, code, price, mrp, featured, created],
      );
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM items WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM categories WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [[BIZ, OTHER_BIZ]]);
    await closePool();
  });

  it('returns the right items for each source', async () => {
    expect(await ids({ source: 'featured', limit: 10 })).toEqual([FEATURED]);
    expect(await ids({ source: 'discounted', limit: 10 })).toEqual([DISCOUNTED]);
    expect(await ids({ source: 'new', limit: 10 })).toEqual([PLAIN, DISCOUNTED, FEATURED]);
    expect(await ids({ source: 'bestsellers', limit: 10 })).toEqual([FEATURED, DISCOUNTED, PLAIN]);
    expect(await ids({ source: 'category', categoryId: CAT_B, limit: 10 })).toEqual([PLAIN]);
    expect(await ids({ source: 'all', limit: 2 })).toEqual([FEATURED, DISCOUNTED]);
  });

  it('applies price_max only to price_max requests', async () => {
    expect(await ids({ source: 'price_max', priceMax: 5, limit: 10 })).toEqual([]);
    expect(await ids({ source: 'price_max', priceMax: 10, limit: 10 })).toHaveLength(3);
    // priceMax and categoryId are ignored for other sources even when set.
    expect(await ids({ source: 'featured', priceMax: 1, categoryId: CAT_B, limit: 10 })).toEqual([FEATURED]);
  });

  it('narrows an all request by category and search but not a bestsellers one', async () => {
    expect(await ids({ source: 'all', limit: 10 }, { categoryId: CAT_B })).toEqual([PLAIN]);
    expect(await ids({ source: 'all', limit: 10 }, { search: 'ban' })).toEqual([DISCOUNTED]);
    expect(await ids({ source: 'bestsellers', limit: 10 }, { categoryId: CAT_B, search: 'ban' })).toEqual([
      FEATURED,
      DISCOUNTED,
      PLAIN,
    ]);
  });

  it('returns empty items for unknown category and for a category request with none picked', async () => {
    expect(await ids({ source: 'category', categoryId: randomUUID(), limit: 10 })).toEqual([]);
    expect(await ids({ source: 'category', limit: 10 })).toEqual([]);
  });

  it('never returns another business items and carries brand through', async () => {
    await pool.query(`UPDATE items SET brand = 'Orchard' WHERE id = $1`, [FEATURED]);
    const out = await resolveSectionData(store, req({ source: 'featured', limit: 10 }));
    expect(out.s.products![0].brand).toBe('Orchard');
    const other = { business_id: OTHER_BIZ, is_demo: false } as unknown as StoreBusinessContext;
    const none = await resolveSectionData(other, req({ source: 'all', limit: 10 }));
    expect(none.s.products).toEqual([]);
  });

  it('loads categories once for this business with item counts', async () => {
    const out = await resolveSectionData(
      store,
      new Map<string, SectionDataRequest>([
        ['c1', { categories: true }],
        ['c2', { categories: true }],
      ]),
    );
    const expected = [
      { id: CAT_B, name: 'Berry', item_count: 1, image_url: null },
      { id: CAT_A, name: 'Fruit', item_count: 2, image_url: null },
    ];
    expect(out.c1.categories).toEqual(expected);
    expect(out.c2.categories).toEqual(expected);
  });

  it('shares one query between identical product requests', async () => {
    const { queryRows } = jest.requireMock('@/lib/db') as { queryRows: jest.Mock };
    queryRows.mockClear();
    const same: SectionDataRequest = { products: { source: 'new', limit: 3 } };
    const out = await resolveSectionData(
      store,
      new Map<string, SectionDataRequest>([
        ['r1', same],
        ['r2', { products: { ...same.products! } }],
      ]),
    );
    expect(out.r1.products).toEqual(out.r2.products);
    expect(queryRows).toHaveBeenCalledTimes(1);
  });

  it('keeps other sections intact when one section query fails', async () => {
    failure.failNextList = true;
    const out = await resolveSectionData(
      store,
      new Map<string, SectionDataRequest>([
        ['bad', { products: { source: 'featured', limit: 10 } }],
        ['good', { products: { source: 'discounted', limit: 10 } }],
        ['cats', { categories: true }],
      ]),
    );
    expect(out.bad.error).toMatch(/forced list failure/);
    expect(out.bad.products).toBeUndefined();
    expect(out.good.error).toBeUndefined();
    expect(out.good.products!.map((p) => p.id)).toEqual([DISCOUNTED]);
    expect(out.cats.categories).toHaveLength(2);
  });
});
