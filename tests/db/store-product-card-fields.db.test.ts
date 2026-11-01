/**
 * Product card fields (badge, tagline, colour swatches) against real PostgreSQL: saved on the item and
 * returned by the shared store items query. Runs only when PHASE2_TEST_DATABASE_URL points at a
 * disposable database with migration 458 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { buildStoreItemsQuery } from '@/lib/store/store-items-query';
import { mapStoreItemRow } from '@/lib/store/map-store-product';

d('Store product card fields (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const WITH_FIELDS = randomUUID();
  const PLAIN = randomUUID();

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Card fields test', '29AAAPA1234A1Z5', '29', 'regular')`,
      [BIZ],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate, show_in_store, store_badge, store_tagline, store_swatches)
       VALUES ($1, $2, 'Banarasi saree', 'PCS', 50, 100, 5, true, 'Pure Katan Silk', 'Varanasi', $3::jsonb)`,
      [WITH_FIELDS, BIZ, JSON.stringify([{ name: 'Gold', hex: '#c89d53' }])],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate, show_in_store)
       VALUES ($1, $2, 'Plain shawl', 'PCS', 50, 100, 5, true)`,
      [PLAIN, BIZ],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM items WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
    await closePool();
  });

  it('stores and lists the card fields', async () => {
    const q = buildStoreItemsQuery({ businessId: BIZ, limit: 10, offset: 0 });
    const rows = (await pool.query(q.listSql, q.listParams)).rows.map(mapStoreItemRow);
    const saree = rows.find((r) => r.id === WITH_FIELDS);
    expect(saree).toMatchObject({
      store_badge: 'Pure Katan Silk',
      store_tagline: 'Varanasi',
      store_swatches: [{ name: 'Gold', hex: '#c89d53' }],
    });
  });

  it('gives items without card fields a null badge, null tagline and no swatches', async () => {
    const q = buildStoreItemsQuery({ businessId: BIZ, limit: 10, offset: 0 });
    const rows = (await pool.query(q.listSql, q.listParams)).rows.map(mapStoreItemRow);
    const plain = rows.find((r) => r.id === PLAIN);
    expect(plain).toMatchObject({ store_badge: null, store_tagline: null, store_swatches: [] });
  });
});
