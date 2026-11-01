/**
 * The catalog page's category lookup (D14) against real PostgreSQL: an existing category with no store
 * products still resolves; unknown, malformed and other-business ids do not.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { catalogCategoryName } from '@/lib/store/engine/section-data';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';

d('catalog category name (real DB)', () => {
  jest.setTimeout(60000);
  const BIZ = '4b49ddef-59bc-4ec3-94c0-65f615ce32a3'; // ganesh
  const EMPTY_CAT = randomUUID();
  const store = { business_id: BIZ, is_demo: false } as unknown as StoreBusinessContext;

  beforeAll(async () => {
    const db = await getPool().query<{ db: string }>('SELECT current_database() AS db');
    if (db.rows[0].db !== 'kh_phase2_test') throw new Error(`Refusing to run against ${db.rows[0].db}`);
    await getPool().query('INSERT INTO categories (id, business_id, name) VALUES ($1, $2, $3)', [
      EMPTY_CAT,
      BIZ,
      'Task5 Empty Category',
    ]);
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM categories WHERE id = $1', [EMPTY_CAT]);
    await closePool();
  });

  it('finds an existing category that has no store products', async () => {
    const items = await getPool().query('SELECT 1 FROM items WHERE category_id = $1', [EMPTY_CAT]);
    expect(items.rowCount).toBe(0);
    await expect(catalogCategoryName(store, EMPTY_CAT)).resolves.toBe('Task5 Empty Category');
  });

  it('is null for an unknown id, a malformed id and another business', async () => {
    await expect(catalogCategoryName(store, randomUUID())).resolves.toBeNull();
    await expect(catalogCategoryName(store, 'bad')).resolves.toBeNull();
    const other = { business_id: randomUUID(), is_demo: false } as unknown as StoreBusinessContext;
    await expect(catalogCategoryName(other, EMPTY_CAT)).resolves.toBeNull();
  });
});
