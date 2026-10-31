/**
 * Version history API routes against real PostgreSQL (auth helpers mocked to the test business and user):
 * list, read-only version preview links and Restore as draft (M5 D45–D48).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with migrations 450–454 applied.
 */
import { randomInt, randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest, NextResponse } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const BIZ = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
const SUB = `tva${Date.now().toString(36)}`;
const state = { allowed: true };

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn(async () => true),
  denyIfFeatureMissing: jest.fn(async () => null),
}));
// Like the real helper: a client business_id that differs from the session is refused, never used.
jest.mock('@/lib/security/require-tenant-permission', () => ({
  requireTenantPermission: jest.fn(async (_req: unknown, claimed: unknown) =>
    state.allowed && !(typeof claimed === 'string' && claimed !== BIZ)
      ? { ok: true, businessId: BIZ, userId: USER }
      : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) },
  ),
}));

import { getPool, closePool } from '@/lib/db';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { verifyPreviewToken, verifyThemePreview, verifyVersionPreview } from '@/lib/store/engine/preview-token';
import { createTheme, getLiveTheme, publishTheme } from '@/lib/store/engine/themes-repo';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { ENGINE_LIMITS } from '@/lib/store/engine/shared';
import * as versionsRoute from '@/app/api/settings/online-store/themes/versions/route';
import * as restoreRoute from '@/app/api/settings/online-store/themes/versions/[vid]/restore/route';
import * as linkRoute from '@/app/api/settings/online-store/themes/versions/[vid]/preview-link/route';

const BASE = 'http://localhost:3000/api/settings/online-store/themes/versions';
const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ctx = (vid: string) => ({ params: { vid } });
const presetCtx = { businessName: 'Versions API', tagline: 'Tagline' };

d('Theme versions API (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  let newest: string; // the latest version of BIZ ("Summer", by Asha)
  let foreignVid: string;

  const ok = <T,>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
    return r.value;
  };
  const count = async (table: 'store_themes' | 'store_theme_versions', biz = BIZ) =>
    (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE business_id = $1`, [biz])).rows[0].n as number;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'versions-api-test-secret';
    pool = getPool();
    for (const id of [BIZ, OTHER]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Versions API test', '29AAAPA1234A1Z5', '29', 'regular')`,
        [id],
      );
    }
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Asha', $3, false, true)`,
      [USER, BIZ, `8${randomInt(100_000_000, 999_999_999)}`],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled) VALUES ($1, $2, true)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain`,
      [BIZ, SUB],
    );
    // BIZ: the migrated live theme (version 1, no author), then "Summer" (grocery) published by Asha (version 2).
    const summer = ok(await createTheme(BIZ, USER, { name: 'Summer', preset: 'grocery', ctx: presetCtx }));
    ok(await publishTheme(BIZ, USER, summer.id));
    newest = (
      await pool.query(`SELECT id FROM store_theme_versions WHERE business_id = $1 ORDER BY published_at DESC, id DESC LIMIT 1`, [BIZ])
    ).rows[0].id;
    // OTHER: one theme published, so it has a version of its own.
    ok(await createTheme(OTHER, USER, { name: 'Other main', preset: 'studio', ctx: presetCtx }));
    const otherDraft = ok(await createTheme(OTHER, USER, { name: 'Other draft', preset: 'blank', ctx: presetCtx }));
    ok(await publishTheme(OTHER, USER, otherDraft.id));
    foreignVid = (await pool.query(`SELECT id FROM store_theme_versions WHERE business_id = $1 LIMIT 1`, [OTHER])).rows[0].id;
  });

  afterAll(async () => {
    if (!pool) return;
    const ids = [[BIZ, OTHER]];
    await pool.query(`DELETE FROM store_theme_versions WHERE business_id = ANY($1)`, ids);
    await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, ids);
    await pool.query(`DELETE FROM business_settings WHERE business_id = ANY($1)`, ids);
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, ids);
    await closePool();
  });

  it('GET lists the business versions newest first with author names, and no data or user ids; it needs settings read', async () => {
    const mocked = requireTenantPermission as jest.Mock;
    mocked.mockClear();
    const res = await versionsRoute.GET(req('', 'GET'));
    expect(res.status).toBe(200);
    expect(mocked.mock.calls[0][2]).toBe('settings');
    expect(mocked.mock.calls[0][3]).toBe('read');
    const { versions } = await res.json();
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ id: newest, theme_name: 'Summer', preset: 'grocery', published_by_name: 'Asha', theme_exists: true });
    expect(versions[1].published_by_name).toBeNull();
    expect(versions[0].published_at >= versions[1].published_at).toBe(true);
    for (const v of versions) {
      expect(v).not.toHaveProperty('data');
      expect(v).not.toHaveProperty('published_by');
      expect(v).not.toHaveProperty('business_id');
    }
    expect(versions.map((v: { id: string }) => v.id)).not.toContain(foreignVid);

    state.allowed = false;
    try {
      expect((await versionsRoute.GET(req('', 'GET'))).status).toBe(403);
    } finally {
      state.allowed = true;
    }
  });

  it('restore makes a "Restored: <name>" draft with the version preset and data; versions are unchanged', async () => {
    const themesBefore = await count('store_themes');
    const versionsBefore = await count('store_theme_versions');
    const liveBefore = await getLiveTheme(BIZ);
    const res = await restoreRoute.POST(req(`/${newest}/restore`, 'POST', {}), ctx(newest));
    expect(res.status).toBe(201);
    const { theme } = await res.json();
    const version = (await pool.query(`SELECT data, preset FROM store_theme_versions WHERE id = $1`, [newest])).rows[0];
    expect(theme).toMatchObject({ name: 'Restored: Summer', role: 'draft', is_working: false, preset: 'grocery', business_id: BIZ });
    expect(theme.data).toEqual(sanitizeThemeData(version.data));
    expect(await count('store_themes')).toBe(themesBefore + 1);
    expect(await count('store_theme_versions')).toBe(versionsBefore);
    expect((await getLiveTheme(BIZ))?.id).toBe(liveBefore?.id);
  });

  it('a body published_by / business_id is never used: the new draft is the session user’s', async () => {
    // A foreign business_id is refused outright.
    const before = await count('store_themes');
    const refused = await restoreRoute.POST(req(`/${newest}/restore`, 'POST', { business_id: OTHER }), ctx(newest));
    expect(refused.status).toBe(403);
    expect(await count('store_themes')).toBe(before);
    expect(await count('store_themes', OTHER)).toBe(2);

    const stranger = randomUUID();
    const res = await restoreRoute.POST(
      req(`/${newest}/restore`, 'POST', { published_by: stranger, updated_by: stranger, created_by: stranger, user_id: stranger, business_id: BIZ }),
      ctx(newest),
    );
    expect(res.status).toBe(201);
    const { theme } = await res.json();
    const row = (await pool.query(`SELECT business_id, updated_by FROM store_themes WHERE id = $1`, [theme.id])).rows[0];
    expect(row).toEqual({ business_id: BIZ, updated_by: USER });
  });

  it('restore at 20 themes is 409 limit and adds nothing', async () => {
    const extra: string[] = [];
    while ((await count('store_themes')) < ENGINE_LIMITS.themesPerBusiness) {
      extra.push(ok(await createTheme(BIZ, USER, { name: `Filler ${extra.length}`, preset: 'blank', ctx: presetCtx })).id);
    }
    try {
      const versionsBefore = await count('store_theme_versions');
      const res = await restoreRoute.POST(req(`/${newest}/restore`, 'POST', {}), ctx(newest));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('limit');
      expect(await count('store_themes')).toBe(ENGINE_LIMITS.themesPerBusiness);
      expect(await count('store_theme_versions')).toBe(versionsBefore);
    } finally {
      await pool.query(`DELETE FROM store_themes WHERE business_id = $1 AND id = ANY($2)`, [BIZ, extra]);
    }
  });

  it("another business's version is 404 for restore and preview-link", async () => {
    const themesBefore = await count('store_themes');
    const otherBefore = await count('store_themes', OTHER);
    const restored = await restoreRoute.POST(req(`/${foreignVid}/restore`, 'POST', {}), ctx(foreignVid));
    expect(restored.status).toBe(404);
    const link = await linkRoute.POST(req(`/${foreignVid}/preview-link`, 'POST', {}, { host: 'localhost:3000' }), ctx(foreignVid));
    expect(link.status).toBe(404);
    expect(await count('store_themes')).toBe(themesBefore);
    expect(await count('store_themes', OTHER)).toBe(otherBefore);
    // An unknown version id is 404 too.
    const unknown = randomUUID();
    expect((await restoreRoute.POST(req(`/${unknown}/restore`, 'POST', {}), ctx(unknown))).status).toBe(404);
  });

  it('preview-link returns a 2 h version link whose pt verifies only as a version token for this business', async () => {
    const res = await linkRoute.POST(req(`/${newest}/preview-link`, 'POST', { path: '/catalog' }, { host: 'localhost:3000' }), ctx(newest));
    expect(res.status).toBe(200);
    const { url: link, expires_at } = await res.json();
    const u = new URL(link);
    expect(u.host).toBe(`${SUB}.localhost:3000`);
    expect(u.pathname).toBe('/catalog');
    expect(u.searchParams.get('preview_theme')).toBe(newest);
    const pt = u.searchParams.get('pt');
    expect(verifyVersionPreview(pt, BIZ)).toBe(newest);
    expect(verifyPreviewToken(pt, BIZ)).toEqual({ kind: 'version', id: newest });
    expect(verifyThemePreview(pt, BIZ)).toBeNull();
    expect(verifyVersionPreview(pt, OTHER)).toBeNull();
    const ahead = new Date(expires_at).getTime() - Date.now();
    expect(ahead).toBeGreaterThan(2 * 3600_000 - 60_000);
    expect(ahead).toBeLessThanOrEqual(2 * 3600_000);

    // Default path is the home page.
    const home = await linkRoute.POST(req(`/${newest}/preview-link`, 'POST', undefined, { host: 'localhost:3000' }), ctx(newest));
    expect(home.status).toBe(200);
    expect(new URL((await home.json()).url).pathname).toBe('/');
  });

  it('a bad path is 400; a non-uuid vid is 404; no subdomain is 409', async () => {
    expect((await linkRoute.POST(req(`/${newest}/preview-link`, 'POST', { path: 'https://evil.com' }), ctx(newest))).status).toBe(400);
    expect((await linkRoute.POST(req(`/${newest}/preview-link`, 'POST', { path: 5 }), ctx(newest))).status).toBe(400);
    expect((await linkRoute.POST(req('/nope/preview-link', 'POST', {}), ctx('nope'))).status).toBe(404);
    expect((await restoreRoute.POST(req('/nope/restore', 'POST', {}), ctx('nope'))).status).toBe(404);

    await pool.query(`UPDATE business_settings SET store_subdomain = NULL WHERE business_id = $1`, [BIZ]);
    try {
      expect((await linkRoute.POST(req(`/${newest}/preview-link`, 'POST', {}), ctx(newest))).status).toBe(409);
    } finally {
      await pool.query(`UPDATE business_settings SET store_subdomain = $2 WHERE business_id = $1`, [BIZ, SUB]);
    }
  });

  it('writes need settings update', async () => {
    const mocked = requireTenantPermission as jest.Mock;
    mocked.mockClear();
    state.allowed = false;
    try {
      expect((await restoreRoute.POST(req(`/${newest}/restore`, 'POST', {}), ctx(newest))).status).toBe(403);
      expect((await linkRoute.POST(req(`/${newest}/preview-link`, 'POST', {}), ctx(newest))).status).toBe(403);
    } finally {
      state.allowed = true;
    }
    for (const call of mocked.mock.calls) {
      expect(call[2]).toBe('settings');
      expect(call[3]).toBe('update');
    }
  });
});
