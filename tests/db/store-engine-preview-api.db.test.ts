/**
 * Public store item APIs for an unlaunched store, against real PostgreSQL: they answer only for a
 * verified engine theme preview (token signed for this business, naming an existing theme).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn(async () => true),
}));

import { getPool, closePool } from '@/lib/db';
import { signThemePreview, PREVIEW_TTL } from '@/lib/store/engine/preview-token';
import { createTheme } from '@/lib/store/engine/themes-repo';
import { signThemeDraft } from '@/lib/store/theme-draft';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import * as itemsRoute from '@/app/api/public/store/[subdomain]/items/route';
import * as facetsRoute from '@/app/api/public/store/[subdomain]/items/facets/route';
import * as itemRoute from '@/app/api/public/store/[subdomain]/items/[id]/route';
import * as relatedRoute from '@/app/api/public/store/[subdomain]/items/[id]/related/route';
import * as reviewsRoute from '@/app/api/public/store/[subdomain]/items/[id]/reviews/route';

const BIZ = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
const ITEM = randomUUID();
const SUB = `pv${Date.now().toString(36)}`;
const ctx = { businessName: 'Preview API test', tagline: 'Tagline' };

const get = (path: string, qs: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000/api/public/store/${SUB}${path}?${new URLSearchParams(qs)}`);
const sub = { subdomain: SUB };

d('store API preview access', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  let themeId: string;
  let deletedThemeId: string;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'api-test-secret';
    pool = getPool();
    for (const id of [BIZ, OTHER]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Preview API test', '29AAAPA1234A1Z5', '29', 'regular')`,
        [id],
      );
    }
    // The store is NOT launched: store_enabled = false is what resolveStoreBySubdomain checks.
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled) VALUES ($1, $2, false)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain, store_enabled = false`,
      [BIZ, SUB],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac, current_stock, show_in_store)
       VALUES ($1, $2, 'Preview widget', 'goods', 'PCS', 100, 40, 18, '847130', 10, true)`,
      [ITEM, BIZ],
    );
    const live = await createTheme(BIZ, USER, { name: 'Main', preset: 'studio', ctx });
    const draft = await createTheme(BIZ, USER, { name: 'Draft', preset: 'blank', ctx });
    const gone = await createTheme(BIZ, USER, { name: 'Gone', preset: 'blank', ctx });
    if (!live.ok || !draft.ok || !gone.ok) throw new Error('theme setup failed');
    themeId = draft.value.id;
    deletedThemeId = gone.value.id;
    token = signThemePreview(BIZ, themeId, PREVIEW_TTL.editor);
    await pool.query(`DELETE FROM store_themes WHERE id = $1`, [deletedThemeId]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM items WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM store_theme_versions WHERE business_id = ANY($1)`, [[BIZ, OTHER]]);
    await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, [[BIZ, OTHER]]);
    await pool.query(`DELETE FROM business_settings WHERE business_id = ANY($1)`, [[BIZ, OTHER]]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [[BIZ, OTHER]]);
    await closePool();
  });

  const routes: Array<[string, (qs: Record<string, string>) => Promise<Response>]> = [
    ['items', (qs) => itemsRoute.GET(get('/items', qs), { params: sub })],
    ['facets', (qs) => facetsRoute.GET(get('/items/facets', qs), { params: sub })],
    ['item', (qs) => itemRoute.GET(get(`/items/${ITEM}`, qs), { params: { ...sub, id: ITEM } })],
    ['related', (qs) => relatedRoute.GET(get(`/items/${ITEM}/related`, qs), { params: { ...sub, id: ITEM } })],
    ['reviews', (qs) => reviewsRoute.GET(get(`/items/${ITEM}/reviews`, qs), { params: { ...sub, id: ITEM } })],
  ];

  it('a valid token for an existing theme answers 200 with the items', async () => {
    for (const [name, call] of routes) {
      const res = await call({ preview_theme: themeId, pt: token });
      expect([name, res.status]).toEqual([name, 200]);
    }
    const list = await (await routes[0][1]({ preview_theme: themeId, pt: token })).json();
    expect(list.items.map((i: { id: string }) => i.id)).toContain(ITEM);
    expect((await (await routes[2][1]({ preview_theme: themeId, pt: token })).json()).id).toBe(ITEM);
  });

  it('no preview params means the unlaunched store is 404 everywhere', async () => {
    for (const [name, call] of routes) expect([name, (await call({})).status]).toEqual([name, 404]);
  });

  it('a token signed for another business is 404', async () => {
    const foreign = signThemePreview(OTHER, themeId, PREVIEW_TTL.editor);
    for (const [name, call] of routes) {
      expect([name, (await call({ preview_theme: themeId, pt: foreign })).status]).toEqual([name, 404]);
    }
  });

  it('a token for a deleted theme is 404', async () => {
    const stale = signThemePreview(BIZ, deletedThemeId, PREVIEW_TTL.editor);
    for (const [name, call] of routes) {
      expect([name, (await call({ preview_theme: deletedThemeId, pt: stale })).status]).toEqual([name, 404]);
    }
  });

  it('a token for one theme does not open another theme id, and a bad token is 404', async () => {
    expect((await routes[0][1]({ preview_theme: randomUUID(), pt: token })).status).toBe(404);
    expect((await routes[0][1]({ preview_theme: themeId, pt: `${token}x` })).status).toBe(404);
    expect((await routes[0][1]({ preview_theme: themeId })).status).toBe(404);
  });

  it('the td draft path allows the offline store only with a draft token for its own business', async () => {
    const own = signThemeDraft(BIZ, sanitizeStoreTheme({}));
    const foreign = signThemeDraft(OTHER, sanitizeStoreTheme({}));
    for (const [name, call] of routes.slice(0, 4)) {
      expect([name, (await call({ td: own })).status]).toEqual([name, 200]);
      expect([name, (await call({ td: 'draft-token' })).status]).toEqual([name, 404]);
      expect([name, (await call({ td: '1' })).status]).toEqual([name, 404]);
      expect([name, (await call({ td: foreign })).status]).toEqual([name, 404]);
    }
  });

  it('an online store ignores the preview params and answers as before', async () => {
    await pool.query(`UPDATE business_settings SET store_enabled = true WHERE business_id = $1`, [BIZ]);
    try {
      expect((await routes[0][1]({})).status).toBe(200);
    } finally {
      await pool.query(`UPDATE business_settings SET store_enabled = false WHERE business_id = $1`, [BIZ]);
    }
  });
});
