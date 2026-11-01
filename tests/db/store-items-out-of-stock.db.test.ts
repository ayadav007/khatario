/**
 * Where out-of-stock products go in the store item list (`stay` / `end` / `hide`), against real PostgreSQL.
 * A product with sizes is out only when every size is out; the count, the category counts and the facets agree
 * with `hide`; a hand-picked (by ids) list keeps its order. Runs only when PHASE2_TEST_DATABASE_URL points at a
 * disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { buildStoreItemsQuery, type StoreItemsOutOfStock } from '@/lib/store/store-items-query';
import { buildStoreFacetsQuery } from '@/lib/store/store-facets-query';
import { buildSuggestQuery } from '@/lib/store/store-suggest';

d('store items out-of-stock place (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const CAT = randomUUID();
  const BRANCH = randomUUID();
  const id = {
    outPlain: randomUUID(), // 'A Out': no stock
    inPlain: randomUUID(), // 'B In': 5 in stock
    sizedSome: randomUUID(), // 'C Sized some': one size in stock, one out
    sizedNone: randomUUID(), // 'D Sized none': every size out
    inPlain2: randomUUID(), // 'E In': 2 in stock
    sizedEmpty: randomUUID(), // 'F Sized empty': sizes switched on but no size rows
  };
  const NAMES: Record<string, string> = {
    [id.outPlain]: 'A Out',
    [id.inPlain]: 'B In',
    [id.sizedSome]: 'C Sized some',
    [id.sizedNone]: 'D Sized none',
    [id.inPlain2]: 'E In',
    [id.sizedEmpty]: 'F Sized empty',
  };

  async function list(outOfStock: StoreItemsOutOfStock | undefined, extra: Record<string, unknown> = {}) {
    const q = buildStoreItemsQuery({ businessId: BIZ, limit: 20, offset: 0, outOfStock, ...extra });
    const { rows } = await pool.query<{ id: string }>(q.listSql, q.listParams);
    const count = await pool.query<{ count: string }>(q.countSql, q.countParams);
    const cats = await pool.query<{ id: string; item_count: number }>(q.categorySql, q.categoryParams);
    return { ids: rows.map((r) => r.id), count: Number(count.rows[0].count), cats: cats.rows };
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, 'Out of stock place test', '27AAAPA1234A1Z5', '27', 'regular')`,
      [BIZ],
    );
    await pool.query(`INSERT INTO categories (id, business_id, name) VALUES ($1, $2, 'Everything')`, [CAT, BIZ]);
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BRANCH, BIZ],
    );
    const items: Array<[string, number, boolean]> = [
      [id.outPlain, 0, false],
      [id.inPlain, 5, false],
      [id.sizedSome, 0, true],
      [id.sizedNone, 0, true],
      [id.inPlain2, 2, false],
      [id.sizedEmpty, 0, true],
    ];
    for (const [itemId, stock, hasVariants] of items) {
      await pool.query(
        `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate, show_in_store,
                            current_stock, has_variants, category_id)
         VALUES ($1, $2, $3, 'PCS', 5, 10, 0, true, $4, $5, $6)`,
        [itemId, BIZ, NAMES[itemId], stock, hasVariants, CAT],
      );
    }
    const variants: Array<[string, string, number]> = [
      [id.sizedSome, 'S', 0],
      [id.sizedSome, 'M', 3],
      [id.sizedNone, 'S', 0],
      [id.sizedNone, 'M', 0],
    ];
    const variantIds: Record<string, string> = {};
    for (const [itemId, name, stock] of variants) {
      const vid = randomUUID();
      variantIds[`${itemId}:${name}`] = vid;
      await pool.query(
        `INSERT INTO item_variants (id, item_id, variant_name, selling_price, current_stock) VALUES ($1, $2, $3, 10, $4)`,
        [vid, itemId, name, stock],
      );
    }
    // At the branch: B In is sold out there, A Out has stock, D's M size has stock; the rest falls back to the central stock.
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 0), ($1, $2, $4, 4)`,
      [BIZ, BRANCH, id.inPlain, id.outPlain],
    );
    await pool.query(
      `INSERT INTO branch_item_variant_stock (business_id, branch_id, item_variant_id, quantity) VALUES ($1, $2, $3, 7)`,
      [BIZ, BRANCH, variantIds[`${id.sizedNone}:M`]],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM items WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM categories WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM branches WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
    await closePool();
  });

  it('runs on the disposable test database', async () => {
    const { rows } = await pool.query<{ db: string }>('SELECT current_database() AS db');
    expect(rows[0].db).toBe('kh_phase2_test');
  });

  const ALL = () => [id.outPlain, id.inPlain, id.sizedSome, id.sizedNone, id.inPlain2, id.sizedEmpty];

  it('stay (and no option) lists every product in the chosen sort', async () => {
    expect((await list(undefined)).ids).toEqual(ALL());
    const stay = await list('stay');
    expect(stay.ids).toEqual(ALL());
    expect(stay.count).toBe(6);
  });

  it('end lists in-stock products first, out-of-stock last, each group in the chosen sort', async () => {
    const r = await list('end');
    expect(r.ids).toEqual([id.inPlain, id.sizedSome, id.inPlain2, id.outPlain, id.sizedNone, id.sizedEmpty]);
    expect(r.count).toBe(6);
    const desc = await list('end', { sort: 'price_desc' });
    expect(desc.ids.slice(0, 3).sort()).toEqual([id.inPlain, id.sizedSome, id.inPlain2].sort());
  });

  it('end pages through the whole list in that order', async () => {
    const q = buildStoreItemsQuery({ businessId: BIZ, outOfStock: 'end', limit: 2, offset: 2 });
    const { rows } = await pool.query<{ id: string }>(q.listSql, q.listParams);
    expect(rows.map((r) => r.id)).toEqual([id.inPlain2, id.outPlain]);
  });

  it('hide drops out-of-stock products, but keeps a product with sizes while any size is in stock', async () => {
    const r = await list('hide');
    expect(r.ids).toEqual([id.inPlain, id.sizedSome, id.inPlain2]);
    expect(r.count).toBe(3);
    expect(r.cats).toEqual([expect.objectContaining({ id: CAT, item_count: 3 })]);
    expect((await list('stay')).cats).toEqual([expect.objectContaining({ id: CAT, item_count: 6 })]);
  });

  it('hide agrees with the facet counts', async () => {
    const run = async (outOfStock: StoreItemsOutOfStock) => {
      const f = buildStoreFacetsQuery({ businessId: BIZ, outOfStock, limit: 0, offset: 0 });
      const cats = await pool.query<{ count: number }>(f.categories.sql, f.categories.params);
      const stock = await pool.query<{ count: number }>(f.inStock.sql, f.inStock.params);
      return { category: cats.rows[0].count, inStock: stock.rows[0].count };
    };
    expect(await run('hide')).toEqual({ category: 3, inStock: 3 });
    expect(await run('stay')).toEqual({ category: 6, inStock: 3 });
  });

  it('hide combines with the in-stock filter and search without breaking the binds', async () => {
    const r = await list('hide', { inStockOnly: true, search: 'Sized' });
    expect(r.ids).toEqual([id.sizedSome]);
    expect(r.count).toBe(1);
  });

  it('a hand-picked list keeps its exact order with end, and hide still removes the out ones', async () => {
    const picked = [id.sizedNone, id.inPlain2, id.outPlain, id.inPlain];
    expect((await list('end', { ids: picked })).ids).toEqual(picked);
    expect((await list('hide', { ids: picked })).ids).toEqual([id.inPlain2, id.inPlain]);
    expect((await list('stay', { ids: picked })).ids).toEqual(picked);
  });

  it('reads the branch stock when a branch is given', async () => {
    const end = await list('end', { branchId: BRANCH });
    expect(end.ids).toEqual([id.outPlain, id.sizedSome, id.sizedNone, id.inPlain2, id.inPlain, id.sizedEmpty]);
    const hide = await list('hide', { branchId: BRANCH });
    expect(hide.ids).toEqual([id.outPlain, id.sizedSome, id.sizedNone, id.inPlain2]);
    expect(hide.count).toBe(4);
    expect(hide.cats).toEqual([expect.objectContaining({ id: CAT, item_count: 4 })]);
    // with the in-stock filter on the same branch, the shared bind still works
    const both = await list('hide', { branchId: BRANCH, inStockOnly: true });
    expect(both.ids).toEqual(hide.ids);
  });

  it('search suggestions follow the same rule', async () => {
    const run = async (outOfStock: StoreItemsOutOfStock) => {
      const built = buildSuggestQuery(BIZ, 'sized', outOfStock)!;
      const { rows } = await pool.query<{ id: string }>(built.products.sql, built.products.params);
      return rows.map((r) => r.id);
    };
    expect(await run('stay')).toEqual([id.sizedSome, id.sizedNone, id.sizedEmpty]);
    expect(await run('end')).toEqual([id.sizedSome, id.sizedNone, id.sizedEmpty]);
    expect(await run('hide')).toEqual([id.sizedSome]);
  });
});
