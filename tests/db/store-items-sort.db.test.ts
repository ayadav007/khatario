/**
 * Store item list sorted by new arrivals and best sellers, against real PostgreSQL.
 * Best sellers count units on store orders of this business only, and skip cancelled orders.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { buildStoreItemsQuery } from '@/lib/store/store-items-query';

d('store items sort (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const OTHER_BIZ = randomUUID();
  const OLD = randomUUID();
  const MID = randomUUID();
  const FRESH = randomUUID();

  async function list(sort: 'new' | 'bestsellers') {
    const q = buildStoreItemsQuery({ businessId: BIZ, sort, limit: 10, offset: 0 });
    const { rows } = await pool.query<{ id: string; sold_count: string; created_at: Date }>(q.listSql, q.listParams);
    return rows;
  }

  async function order(business: string, status: string, lines: Array<[string, number]>) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO store_orders (id, business_id, order_number, customer_name, customer_phone, status)
       VALUES ($1, $2, $3, 'Test', '9999999999', $4)`,
      [id, business, `T-${id.slice(0, 8)}`, status],
    );
    for (const [item, qty] of lines) {
      await pool.query(
        `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit_price, line_total)
         VALUES ($1, $2, 'x', $3, 10, 10)`,
        [id, item, qty],
      );
    }
  }

  beforeAll(async () => {
    pool = getPool();
    for (const biz of [BIZ, OTHER_BIZ]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, 'Sort test', '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz],
      );
    }
    const items: Array<[string, string, string]> = [
      [OLD, 'Apple', '2025-01-01'],
      [MID, 'Banana', '2026-05-01'],
      [FRESH, 'Cherry', '2026-10-20'],
    ];
    for (const [id, name, created] of items) {
      await pool.query(
        `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate, show_in_store, created_at)
         VALUES ($1, $2, $3, 'PCS', 5, 10, 0, true, $4)`,
        [id, BIZ, name, created],
      );
    }
    // Banana sells most; a cancelled Apple order and another business's orders must not count.
    await order(BIZ, 'delivered', [[MID, 5], [OLD, 1]]);
    await order(BIZ, 'pending', [[MID, 2]]);
    await order(BIZ, 'cancelled', [[OLD, 50]]);
    await order(OTHER_BIZ, 'delivered', [[FRESH, 99]]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM store_orders WHERE business_id = ANY($1)`, [[BIZ, OTHER_BIZ]]);
    await pool.query(`DELETE FROM items WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [[BIZ, OTHER_BIZ]]);
    await closePool();
  });

  it('lists newest items first', async () => {
    const rows = await list('new');
    expect(rows.map((r) => r.id)).toEqual([FRESH, MID, OLD]);
    expect(rows[0].created_at).toBeTruthy();
  });

  it('ranks by units sold on this store, ignoring cancelled orders and other businesses', async () => {
    const rows = await list('bestsellers');
    expect(rows.map((r) => [r.id, Number(r.sold_count)])).toEqual([
      [MID, 7],
      [OLD, 1],
      [FRESH, 0],
    ]);
  });
});
