/**
 * Editing an item with variants through PATCH /api/items/[id] against real PostgreSQL.
 * Variants sent back with their id are updated in place: the id, the stock already moved and the
 * customer price on that variant all survive. Only variants left out of the edit are deleted.
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
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { PATCH } from '@/app/api/items/[id]/route';

d('item edit keeps its variants (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const USER = randomUUID();
  const CUSTOMER = randomUUID();
  const ITEM = randomUUID();
  const OTHER_ITEM = randomUUID();
  const RED = randomUUID();
  const BLUE = randomUUID();
  const OTHER_VARIANT = randomUUID();

  const headers = {
    'x-authenticated-user-id': USER,
    'x-authenticated-business-id': BIZ,
    'x-authenticated-session-version': '1',
    'content-type': 'application/json',
  };

  async function edit(variants: Record<string, unknown>[]) {
    const res = await PATCH(
      new NextRequest(`http://localhost/api/items/${ITEM}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'Shirt', unit: 'PCS', purchase_price: 50, tax_rate: 5, has_variants: true, variants }),
      }),
      { params: { id: ITEM } }
    );
    return { status: res.status, body: await res.json() };
  }

  const variantsNow = async () =>
    (
      await pool.query(
        `SELECT id, variant_name, selling_price::float AS selling_price, opening_stock::float AS opening_stock,
                current_stock::float AS current_stock
           FROM item_variants WHERE item_id = $1 ORDER BY variant_name`,
        [ITEM]
      )
    ).rows;

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, 'Variant sync test', '27AAAPA1234A1Z5', '27', 'regular')`,
      [BIZ]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_active, auth_session_version)
       VALUES ($1, $2, 'Variant editor', $3, true, 1)`,
      [USER, BIZ, `6${Date.now().toString().slice(-9)}`]
    );
    // The edit re-posts the opening-stock voucher, which needs the inventory account.
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [BIZ]);
    await pool.query(`INSERT INTO customers (id, business_id, name) VALUES ($1, $2, 'Variant buyer')`, [CUSTOMER, BIZ]);
    for (const [id, name] of [[ITEM, 'Shirt'], [OTHER_ITEM, 'Trouser']]) {
      await pool.query(
        `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate, has_variants)
         VALUES ($1, $2, $3, 'PCS', 50, NULL, 5, true)`,
        [id, BIZ, name]
      );
    }
    // Red opened with 10 and has sold 3 since, so 7 are on hand.
    for (const [id, itemId, name, price, opening, current] of [
      [RED, ITEM, 'Red / L', 120, 10, 7],
      [BLUE, ITEM, 'Blue / L', 110, 4, 4],
      [OTHER_VARIANT, OTHER_ITEM, 'Black / 32', 300, 2, 2],
    ] as const) {
      await pool.query(
        `INSERT INTO item_variants (id, item_id, variant_name, selling_price, opening_stock, current_stock)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, itemId, name, price, opening, current]
      );
    }
    await pool.query(
      `INSERT INTO party_item_prices (business_id, party_id, item_id, variant_id, price) VALUES ($1, $2, $3, $4, 90)`,
      [BIZ, CUSTOMER, ITEM, RED]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
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

  it('keeps an edited variant’s id, stock and customer price, adds the new one and drops the removed one', async () => {
    const r = await edit([
      { id: RED, name: 'Red / Large', selling_price: '125', opening_stock: '10', attributes: { color: 'Red' } },
      { name: 'Green / L', selling_price: '115', opening_stock: '3' },
    ]);
    expect([r.status, r.body.error]).toEqual([200, undefined]);

    const rows = await variantsNow();
    expect(rows.map((v) => v.variant_name)).toEqual(['Green / L', 'Red / Large']);
    const [green, red] = rows;
    expect(red).toEqual({ id: RED, variant_name: 'Red / Large', selling_price: 125, opening_stock: 10, current_stock: 7 });
    expect(green.id).not.toBe(BLUE);
    expect([green.opening_stock, green.current_stock]).toEqual([3, 3]);

    const prices = await pool.query(
      `SELECT variant_id, price::float AS price FROM party_item_prices WHERE party_id = $1 AND item_id = $2`,
      [CUSTOMER, ITEM]
    );
    expect(prices.rows).toEqual([{ variant_id: RED, price: 90 }]);
  });

  it('shifts stock on hand only by a change to opening stock', async () => {
    const before = await variantsNow();
    const green = before.find((v) => v.variant_name === 'Green / L')!;
    const r = await edit([
      { id: RED, name: 'Red / Large', selling_price: '125', opening_stock: '12' },
      { id: green.id, name: 'Green / L', selling_price: '115', opening_stock: '3' },
    ]);
    expect(r.status).toBe(200);
    const after = await variantsNow();
    expect(after.map((v) => [v.id, v.opening_stock, v.current_stock])).toEqual([
      [green.id, 3, 3],
      [RED, 12, 9],
    ]);
  });

  it('treats an id from another item as a new variant and leaves that item alone', async () => {
    const r = await edit([
      { id: RED, name: 'Red / Large', selling_price: '125', opening_stock: '12' },
      { id: OTHER_VARIANT, name: 'Black / L', selling_price: '130', opening_stock: '1' },
    ]);
    expect(r.status).toBe(200);
    const rows = await variantsNow();
    expect(rows.map((v) => v.variant_name)).toEqual(['Black / L', 'Red / Large']);
    expect(rows[0].id).not.toBe(OTHER_VARIANT);
    const other = await pool.query(`SELECT item_id, variant_name FROM item_variants WHERE id = $1`, [OTHER_VARIANT]);
    expect(other.rows).toEqual([{ item_id: OTHER_ITEM, variant_name: 'Black / 32' }]);
  });

  it('lets an edit swap barcodes between two variants and still drops a duplicate', async () => {
    const A = '8901396151005';
    const B = '4006381333931';
    const black = (await variantsNow()).find((v) => v.variant_name === 'Black / L')!;
    const barcodes = async () =>
      (await pool.query(`SELECT id, barcode FROM item_variants WHERE item_id = $1 ORDER BY variant_name`, [ITEM])).rows;
    const save = (red: string, blk: string) =>
      edit([
        { id: RED, name: 'Red / Large', selling_price: '125', opening_stock: '12', barcode: red },
        { id: black.id, name: 'Black / L', selling_price: '130', opening_stock: '1', barcode: blk },
      ]);

    expect((await save(A, B)).status).toBe(200);
    expect(await barcodes()).toEqual([{ id: black.id, barcode: B }, { id: RED, barcode: A }]);

    expect((await save(B, A)).status).toBe(200);
    expect(await barcodes()).toEqual([{ id: black.id, barcode: A }, { id: RED, barcode: B }]);

    // The same barcode twice in one edit: the first variant keeps it, the second is cleared.
    expect((await save(A, A)).status).toBe(200);
    expect(await barcodes()).toEqual([{ id: black.id, barcode: null }, { id: RED, barcode: A }]);
  });
});
