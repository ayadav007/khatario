/**
 * Store product page APIs on a real database (store shopping features, phase 2, task 10):
 * public detail extras (brand, video, tabs, inherited size chart, variant attributes), related
 * products, and the admin item / category saves that write them. Opt-in, disposable DB only:
 *   STORE_FEATURES_DB_TEST=1 npx jest tests/db/store-product-page.db.test.ts --runInBand
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
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/auth-helpers', () => ({
  ...jest.requireActual('@/lib/auth-helpers'),
  // Session checks hit the users table; the headers below are what the middleware would set.
  requireStrictSession: jest.fn(async (request: any) => ({
    ok: true,
    userId: request.headers.get('x-authenticated-user-id'),
    businessId: request.headers.get('x-authenticated-business-id'),
  })),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { GET as getDetail } from '@/app/api/public/store/[subdomain]/items/[id]/route';
import { GET as getRelated } from '@/app/api/public/store/[subdomain]/items/[id]/related/route';
import { PATCH as patchItem } from '@/app/api/items/[id]/route';
import { GET as getCategories, PATCH as patchCategory } from '@/app/api/categories/route';

d('store product page APIs (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const OTHER_B = randomUUID();
  const OWNER = randomUUID();
  const CAT_SHIRTS = randomUUID();
  const CAT_MUGS = randomUUID();
  const OTHER_CAT = randomUUID();
  const SHIRT = randomUUID(); // no own chart: inherits the category's
  const SHIRT2 = randomUUID(); // own chart
  const SHIRT3 = randomUUID(); // same category, sold more
  const MUG = randomUUID(); // other category, same brand
  const tag = B.slice(0, 8);
  const SUB = `pp-${tag}`;
  const CAT_CHART = { columns: ['Size', 'Chest'], rows: [['S', '36'], ['M', '38']] };
  const OWN_CHART = { columns: ['Size', 'Waist'], rows: [['L', '32']] };

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

  const ctx = (id: string) => ({ params: { subdomain: SUB, id } });
  const pub = (id: string, tail = '') =>
    new NextRequest(`http://localhost/api/public/store/${SUB}/items/${id}${tail}`);
  const admin = (url: string, method: string, body: unknown, businessId = B) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-authenticated-user-id': OWNER,
        'x-authenticated-business-id': businessId,
      },
      body: JSON.stringify(body),
    });
  const savedItem = (id: string, extra: Record<string, unknown>) =>
    patchItem(admin(`/api/items/${id}`, 'PATCH', { name: 'Shirt', unit: 'PCS', selling_price: 500, ...extra }), {
      params: { id },
    });

  beforeAll(async () => {
    pool = getPool();
    const db = (await pool.query(`SELECT current_database() AS db`)).rows[0].db;
    if (db !== TEST_DB) throw new Error(`Refusing: connected to ${db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, phone)
       VALUES ($1, $2, $3, '27', 'regular', '9000000003'), ($4, $5, $6, '27', 'regular', '9000000004')`,
      [
        B, `Product Page Traders ${tag}`, `27AABCP${tag.slice(0, 4).toUpperCase()}K1Z5`,
        OTHER_B, `Other Traders ${tag}`, `27AABCQ${tag.slice(0, 4).toUpperCase()}K1Z5`,
      ],
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
      `INSERT INTO categories (id, business_id, name, size_chart) VALUES ($1, $4, 'Shirts', $5::jsonb), ($2, $4, 'Mugs', NULL), ($3, $6, 'Elsewhere', NULL)`,
      [CAT_SHIRTS, CAT_MUGS, OTHER_CAT, B, JSON.stringify(CAT_CHART), OTHER_B],
    );
    const insertItem = (id: string, name: string, cat: string, brand: string | null, extra = 'NULL') =>
      pool.query(
        `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, category_id, brand,
                            show_in_store, is_active, item_type, size_chart)
         VALUES ($1, $2, $3, 'PCS', 100, 0, 10, $4, $5, true, true, 'goods', ${extra}::jsonb)`,
        [id, B, name, cat, brand],
      );
    await insertItem(SHIRT, 'Plain Shirt', CAT_SHIRTS, 'Acme');
    await insertItem(SHIRT2, 'Formal Shirt', CAT_SHIRTS, 'Other', `'${JSON.stringify(OWN_CHART)}'`);
    await insertItem(SHIRT3, 'Casual Shirt', CAT_SHIRTS, 'Other');
    await insertItem(MUG, 'Acme Mug', CAT_MUGS, 'Acme');
    await pool.query(
      `UPDATE items SET video_url = 'https://youtu.be/dQw4w9WgXcQ',
              store_tabs = '[{"title":"Care","body":"Machine wash"}]'::jsonb
        WHERE id = $1`,
      [SHIRT],
    );
    await pool.query(`UPDATE items SET has_variants = true WHERE id = $1`, [SHIRT]);
    // created_at drives the order: Small first even though its id sorts last.
    await pool.query(
      `INSERT INTO item_variants (item_id, variant_name, selling_price, current_stock, attributes, created_at)
       VALUES ($1, 'M', 100, 5, '{"Size":"M"}'::jsonb, now()),
              ($1, 'S', 100, 5, '{"Size":"S"}'::jsonb, now() - interval '1 hour')`,
      [SHIRT],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', OWNER, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER_B]]);
        });
      });
    } finally {
      await closePool();
    }
  });

  test('detail inherits the category size chart, item chart overrides, extras are returned', async () => {
    const a = await (await getDetail(pub(SHIRT), ctx(SHIRT))).json();
    expect(a.brand).toBe('Acme');
    expect(a.video_url).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(a.store_tabs).toEqual([{ title: 'Care', body: 'Machine wash' }]);
    expect(a.size_chart).toEqual(CAT_CHART);
    const b = await (await getDetail(pub(SHIRT2), ctx(SHIRT2))).json();
    expect(b.size_chart).toEqual(OWN_CHART);
    expect(b.video_url).toBeNull();
    expect(b.store_tabs).toEqual([]);
    const m = await (await getDetail(pub(MUG), ctx(MUG))).json();
    expect(m.size_chart).toBeNull();
  });

  test('variants come back in creation order with attributes', async () => {
    const a = await (await getDetail(pub(SHIRT), ctx(SHIRT))).json();
    expect(a.variants.map((v: any) => v.variant_name)).toEqual(['S', 'M']);
    expect(a.variants[0].attributes).toEqual({ Size: 'S' });
  });

  test('related excludes the item and lists the same category first', async () => {
    const res = await getRelated(pub(SHIRT, '/related'), ctx(SHIRT));
    expect(res.status).toBe(200);
    const { items } = await res.json();
    const ids = items.map((i: any) => i.id);
    expect(ids).not.toContain(SHIRT);
    expect(ids.slice(0, 2).sort()).toEqual([SHIRT2, SHIRT3].sort());
    expect(ids[2]).toBe(MUG);
    expect(items[0]).toHaveProperty('selling_price');
    expect(items[0]).toHaveProperty('images');
    const limited = await (await getRelated(pub(SHIRT, '/related?limit=1'), ctx(SHIRT))).json();
    expect(limited.items).toHaveLength(1);
    // A non-uuid branch_id is dropped rather than reaching a uuid column.
    expect((await getRelated(pub(SHIRT, '/related?branch_id=not-a-uuid'), ctx(SHIRT))).status).toBe(200);
  });

  test('related is 404 for an unknown item or store', async () => {
    const missing = randomUUID();
    expect((await getRelated(pub(missing, '/related'), ctx(missing))).status).toBe(404);
    const other = await getRelated(pub(SHIRT, '/related'), { params: { subdomain: 'nope-' + tag, id: SHIRT } });
    expect(other.status).toBe(404);
  });

  test('item save rejects a fifth tab with the validator message', async () => {
    const tabs = [1, 2, 3, 4, 5].map((n) => ({ title: `T${n}`, body: 'text' }));
    const res = await savedItem(SHIRT3, { store_tabs: tabs });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('You can add up to 4 tabs.');
    const bad = await savedItem(SHIRT3, { video_url: 'http://example.com/x.mp4' });
    expect(bad.status).toBe(400);
  });

  test('item save persists tabs, video and chart; leaving them out keeps them', async () => {
    const chart = { columns: ['Size'], rows: [['XL']] };
    const res = await savedItem(SHIRT3, {
      store_tabs: [{ title: ' Fit ', body: ' Relaxed ' }],
      video_url: 'https://example.com/clip.mp4',
      size_chart: chart,
    });
    expect(res.status).toBe(200);
    const row = (await pool.query(`SELECT video_url, store_tabs, size_chart FROM items WHERE id = $1`, [SHIRT3])).rows[0];
    expect(row.store_tabs).toEqual([{ title: 'Fit', body: 'Relaxed' }]);
    expect(row.video_url).toBe('https://example.com/clip.mp4');
    expect(row.size_chart).toEqual(chart);
    await savedItem(SHIRT3, { description: 'again' });
    const kept = (await pool.query(`SELECT store_tabs FROM items WHERE id = $1`, [SHIRT3])).rows[0];
    expect(kept.store_tabs).toEqual([{ title: 'Fit', body: 'Relaxed' }]);
    await savedItem(SHIRT3, { size_chart: null, video_url: '', store_tabs: [] });
    const cleared = (await pool.query(`SELECT video_url, store_tabs, size_chart FROM items WHERE id = $1`, [SHIRT3])).rows[0];
    expect(cleared).toEqual({ video_url: null, store_tabs: [], size_chart: null });
  });

  test('category chart save: validates, is scoped to the business, and GET returns it', async () => {
    const ok = await patchCategory(admin('/api/categories', 'PATCH', { id: CAT_MUGS, size_chart: OWN_CHART }));
    expect(ok.status).toBe(200);
    const list = await (await getCategories(admin('/api/categories', 'GET', undefined) as any)).json();
    expect(list.categories.find((c: any) => c.id === CAT_MUGS).size_chart).toEqual(OWN_CHART);
    const bad = await patchCategory(admin('/api/categories', 'PATCH', { id: CAT_MUGS, size_chart: { columns: [], rows: [] } }));
    expect(bad.status).toBe(400);
    const foreign = await patchCategory(admin('/api/categories', 'PATCH', { id: OTHER_CAT, size_chart: OWN_CHART }));
    expect(foreign.status).toBe(404);
    const missing = await patchCategory(admin('/api/categories', 'PATCH', { id: CAT_MUGS }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'size_chart is required' });
    const kept = (await pool.query(`SELECT size_chart FROM categories WHERE id = $1`, [CAT_MUGS])).rows[0];
    expect(kept.size_chart).toEqual(OWN_CHART);
    const cleared = await patchCategory(admin('/api/categories', 'PATCH', { id: CAT_MUGS, size_chart: null }));
    expect(cleared.status).toBe(200);
    const gone = (await pool.query(`SELECT size_chart FROM categories WHERE id = $1`, [CAT_MUGS])).rows[0];
    expect(gone.size_chart).toBeNull();
  });
});
