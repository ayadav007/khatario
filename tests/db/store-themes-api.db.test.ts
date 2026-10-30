/**
 * Theme API routes against real PostgreSQL (auth helpers mocked to the test business and user).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with migration 450 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest, NextResponse } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const BIZ = randomUUID();
const USER = randomUUID();
const SUB = `th${Date.now().toString(36)}`;
const state = { allowed: true };

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn(async () => true),
  // Routes call this, which checks the plan inside its own module; the fresh test business has none.
  denyIfFeatureMissing: jest.fn(async () => null),
}));
jest.mock('@/lib/auth-helpers', () => ({
  ...jest.requireActual('@/lib/auth-helpers'),
  requireTenantBusinessId: () => ({ ok: true, businessId: BIZ }),
}));
jest.mock('@/lib/security/require-tenant-permission', () => ({
  requireTenantPermission: jest.fn(async () =>
    state.allowed
      ? { ok: true, businessId: BIZ, userId: USER }
      : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) },
  ),
}));

import { getPool, closePool } from '@/lib/db';
import { verifyThemePreview } from '@/lib/store/engine/preview-token';
import * as listRoute from '@/app/api/settings/online-store/themes/route';
import * as idRoute from '@/app/api/settings/online-store/themes/[id]/route';
import * as publishRoute from '@/app/api/settings/online-store/themes/[id]/publish/route';
import * as workingRoute from '@/app/api/settings/online-store/themes/working-draft/route';
import * as linkRoute from '@/app/api/settings/online-store/themes/[id]/preview-link/route';

const BASE = 'http://localhost:3000/api/settings/online-store/themes';
const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: { id } });

d('Theme API (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  let liveId: string;
  let draftId: string;
  let draftUpdatedAt: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'api-test-secret';
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Theme API test', '29AAAPA1234A1Z5', '29', 'regular')`,
      [BIZ],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled, store_tagline) VALUES ($1, $2, true, 'Fresh tagline')
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain`,
      [BIZ, SUB],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM store_theme_versions WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM store_themes WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM business_settings WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
    await closePool();
  });

  it('first POST is live, second is draft, and a foreign body business_id is ignored', async () => {
    const other = randomUUID();
    let res = await listRoute.POST(req('', 'POST', { name: 'Main', business_id: other }));
    expect(res.status).toBe(201);
    const first = (await res.json()).theme;
    expect(first.role).toBe('live');
    expect(first.business_id).toBe(BIZ);
    liveId = first.id;

    res = await listRoute.POST(req('', 'POST', { name: 'Second', preset: 'blank' }));
    expect(res.status).toBe(201);
    const second = (await res.json()).theme;
    expect(second.role).toBe('draft');
    draftId = second.id;
    draftUpdatedAt = second.updated_at;

    const stray = await pool.query(`SELECT 1 FROM store_themes WHERE business_id = $1`, [other]);
    expect(stray.rowCount).toBe(0);

    res = await listRoute.GET(req('', 'GET'));
    const { themes } = await res.json();
    expect(themes.map((t: { id: string }) => t.id)).toEqual([liveId, draftId]);
  });

  it('rejects a bad preset, a bad duplicate_of and a non-uuid id', async () => {
    expect((await listRoute.POST(req('', 'POST', { name: 'x', preset: 'nope' }))).status).toBe(400);
    expect((await listRoute.POST(req('', 'POST', { name: 'x', duplicate_of: 'nope' }))).status).toBe(400);
    expect((await idRoute.GET(req('/nope', 'GET'), ctx('nope'))).status).toBe(404);
  });

  it('PUT saves a draft, then a stale updated_at is 409', async () => {
    const got = (await (await idRoute.GET(req(`/${draftId}`, 'GET'), ctx(draftId))).json()).theme;
    let res = await idRoute.PUT(req(`/${draftId}`, 'PUT', { data: got.data, updated_at: draftUpdatedAt }), ctx(draftId));
    expect(res.status).toBe(200);
    const saved = (await res.json()).theme;
    expect(saved.updated_at).not.toBe(draftUpdatedAt);

    res = await idRoute.PUT(req(`/${draftId}`, 'PUT', { data: got.data, updated_at: draftUpdatedAt }), ctx(draftId));
    expect(res.status).toBe(409);
    draftUpdatedAt = saved.updated_at;
  });

  it('PUT without a data object or without updated_at is 400 and changes nothing', async () => {
    const before = (await (await idRoute.GET(req(`/${draftId}`, 'GET'), ctx(draftId))).json()).theme;
    for (const body of [{ updated_at: before.updated_at }, { data: before.data }, { data: [], updated_at: before.updated_at }, { data: null, updated_at: before.updated_at }]) {
      expect((await idRoute.PUT(req(`/${draftId}`, 'PUT', body), ctx(draftId))).status).toBe(400);
    }
    const after = (await (await idRoute.GET(req(`/${draftId}`, 'GET'), ctx(draftId))).json()).theme;
    expect(after).toEqual(before);
  });

  it('PUT on the live theme is 409', async () => {
    const res = await idRoute.PUT(req(`/${liveId}`, 'PUT', { data: {}, updated_at: 'x' }), ctx(liveId));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('live_locked');
  });

  it('POST working-draft returns the same draft twice', async () => {
    const a = await workingRoute.POST(req('/working-draft', 'POST', {}));
    expect(a.status).toBe(200);
    const first = (await a.json()).theme;
    expect(first.is_working).toBe(true);
    expect(first.role).toBe('draft');
    const second = (await (await workingRoute.POST(req('/working-draft', 'POST', {}))).json()).theme;
    expect(second.id).toBe(first.id);
    expect(second.business_id).toBe(BIZ);
  });

  it('PUT of 700 KB is 413 before parsing', async () => {
    const res = await idRoute.PUT(req(`/${draftId}`, 'PUT', 'x'.repeat(700_000)), ctx(draftId));
    expect(res.status).toBe(413);
  });

  it('PATCH validates the name then renames', async () => {
    expect((await idRoute.PATCH(req(`/${draftId}`, 'PATCH', { name: '   ' }), ctx(draftId))).status).toBe(400);
    expect((await idRoute.PATCH(req(`/${draftId}`, 'PATCH', { name: 'a'.repeat(61) }), ctx(draftId))).status).toBe(400);
    const res = await idRoute.PATCH(req(`/${draftId}`, 'PATCH', { name: ' Renamed ' }), ctx(draftId));
    expect(res.status).toBe(200);
    expect((await res.json()).theme.name).toBe('Renamed');
  });

  it('preview-link returns a URL whose pt verifies to the theme id', async () => {
    const res = await linkRoute.POST(
      req(`/${draftId}/preview-link`, 'POST', { kind: 'share' }, { host: 'localhost:3000' }),
      ctx(draftId),
    );
    expect(res.status).toBe(200);
    const { url: link, expires_at } = await res.json();
    const u = new URL(link);
    expect(u.host).toBe(`${SUB}.localhost:3000`);
    expect(u.searchParams.get('preview_theme')).toBe(draftId);
    expect(verifyThemePreview(u.searchParams.get('pt'), BIZ)).toBe(draftId);
    expect(new Date(expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
    const bad = await linkRoute.POST(req(`/${draftId}/preview-link`, 'POST', { kind: 'x' }), ctx(draftId));
    expect(bad.status).toBe(400);
  });

  it('publish swaps roles', async () => {
    const res = await publishRoute.POST(req(`/${draftId}/publish`, 'POST', {}), ctx(draftId));
    expect(res.status).toBe(200);
    expect((await res.json()).theme.role).toBe('live');
    const roles = await pool.query(`SELECT id, role FROM store_themes WHERE business_id = $1`, [BIZ]);
    expect(roles.rows.find((r) => r.id === liveId).role).toBe('draft');
    expect(roles.rows.find((r) => r.id === draftId).role).toBe('live');
  });

  it('DELETE refuses the live theme and removes a draft', async () => {
    expect((await idRoute.DELETE(req(`/${draftId}`, 'DELETE'), ctx(draftId))).status).toBe(409);
    expect((await idRoute.DELETE(req(`/${liveId}`, 'DELETE'), ctx(liveId))).status).toBe(200);
    expect((await idRoute.GET(req(`/${liveId}`, 'GET'), ctx(liveId))).status).toBe(404);
  });

  it('a user without settings update permission gets 403 on PUT', async () => {
    state.allowed = false;
    try {
      const res = await idRoute.PUT(req(`/${draftId}`, 'PUT', { data: {}, updated_at: 'x' }), ctx(draftId));
      expect(res.status).toBe(403);
    } finally {
      state.allowed = true;
    }
  });
});
