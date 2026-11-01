/**
 * Customer prices per variant (migration 433) through /api/pricing/party-item against real PostgreSQL.
 * A variant's own price wins; a variant without one falls back to the whole-item price.
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
import { GET, POST } from '@/app/api/pricing/party-item/route';

d('party item prices per variant (real DB)', () => {
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

  async function save(body: Record<string, unknown>) {
    const res = await POST(
      new NextRequest('http://localhost/api/pricing/party-item', {
        method: 'POST',
        headers,
        body: JSON.stringify({ party_id: CUSTOMER, ...body }),
      })
    );
    return { status: res.status, body: await res.json() };
  }

  async function lookup(variantId?: string) {
    const v = variantId ? `&variant_id=${variantId}` : '';
    const res = await GET(
      new NextRequest(`http://localhost/api/pricing/party-item?party_id=${CUSTOMER}&item_id=${ITEM}${v}`, { headers })
    );
    expect(res.status).toBe(200);
    return (await res.json()).price as number | null;
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, 'Variant price test', '27AAAPA1234A1Z5', '27', 'regular')`,
      [BIZ]
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_active) VALUES ($1, $2, 'Variant tester', $3, true)`, [
      USER,
      BIZ,
      `6${Date.now().toString().slice(-9)}`,
    ]);
    await pool.query(`INSERT INTO customers (id, business_id, name) VALUES ($1, $2, 'Variant buyer')`, [CUSTOMER, BIZ]);
    for (const [id, name] of [[ITEM, 'Shirt'], [OTHER_ITEM, 'Trouser']]) {
      await pool.query(
        `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate, has_variants)
         VALUES ($1, $2, $3, 'PCS', 50, NULL, 5, true)`,
        [id, BIZ, name]
      );
    }
    for (const [id, itemId, name, price] of [
      [RED, ITEM, 'Red / L', 120],
      [BLUE, ITEM, 'Blue / L', 110],
      [OTHER_VARIANT, OTHER_ITEM, 'Black / 32', 300],
    ] as const) {
      await pool.query(`INSERT INTO item_variants (id, item_id, variant_name, selling_price) VALUES ($1, $2, $3, $4)`, [
        id,
        itemId,
        name,
        price,
      ]);
    }
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

  it('uses the variant price when set and the whole-item price for other variants', async () => {
    const r = await save({
      rows: [
        { item_id: ITEM, price: 100 },
        { item_id: ITEM, variant_id: RED, price: 90 },
      ],
    });
    expect(r).toEqual({ status: 200, body: { ok: true, saved: 2 } });

    expect(await lookup(RED)).toBe(90);
    expect(await lookup(BLUE)).toBe(100);
    expect(await lookup()).toBe(100);
  });

  it('updates a variant price in place and lists it with its variant', async () => {
    expect((await save({ item_id: ITEM, variant_id: RED, price: 95 })).status).toBe(200);
    expect(await lookup(RED)).toBe(95);

    const res = await GET(new NextRequest(`http://localhost/api/pricing/party-item?party_id=${CUSTOMER}`, { headers }));
    const body = await res.json();
    const none = { discount_percent: null, valid_from: null, valid_to: null };
    expect(body.overrides).toEqual([
      { item_id: ITEM, variant_id: null, price: 100, ...none },
      { item_id: ITEM, variant_id: RED, price: 95, ...none },
    ]);
    expect(body.variants.map((v: { id: string }) => v.id).sort()).toEqual([RED, BLUE, OTHER_VARIANT].sort());
  });

  it('removing a variant price falls back to the whole-item price and keeps the item row', async () => {
    expect((await save({ item_id: ITEM, variant_id: RED, price: null })).status).toBe(200);
    expect(await lookup(RED)).toBe(100);
    expect(await lookup()).toBe(100);
  });

  it('refuses a variant of another item and a malformed variant id', async () => {
    expect((await save({ item_id: ITEM, variant_id: OTHER_VARIANT, price: 10 })).status).toBe(404);
    expect((await save({ rows: [{ item_id: ITEM, variant_id: 'not-a-uuid', price: 10 }] })).status).toBe(400);
    const res = await GET(
      new NextRequest(`http://localhost/api/pricing/party-item?party_id=${CUSTOMER}&item_id=${ITEM}&variant_id=x`, { headers })
    );
    expect(res.status).toBe(400);
  });
});
