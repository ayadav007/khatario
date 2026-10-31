/**
 * Store theme migration runner (M4 Task 7, D33/D34) against real PostgreSQL.
 * Runs only when PHASE2_TEST_DATABASE_URL points at the disposable kh_phase2_test database.
 * Writes only to the businesses it seeds (by id), and removes them afterwards.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const state = { biz: '', user: randomUUID() };

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn(async () => true),
  denyIfFeatureMissing: jest.fn(async () => null),
}));
jest.mock('@/lib/security/require-tenant-permission', () => ({
  requireTenantPermission: jest.fn(async () => ({ ok: true, businessId: state.biz, userId: state.user })),
}));

import * as db from '@/lib/db';
import * as runner from '@/lib/store/engine/migrate-runner';
import { MigrationRefusedError, migrationInputFor, runStoreThemeMigration } from '@/lib/store/engine/migrate-runner';
import { migrateStoreTheme } from '@/lib/store/engine/migrate';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { getOrCreateWorkingDraft } from '@/lib/store/engine/themes-repo';
import { verifyThemePreview } from '@/lib/store/engine/preview-token';
import * as listRoute from '@/app/api/settings/online-store/themes/route';
import { groceryAll, khatarioAll, studioSaved } from '../lib/store/engine/fixtures/store-themes';

const SEED = Date.now().toString(36);
const GROCERY = randomUUID();
const STUDIO = randomUUID();
const KHATARIO = randomUUID();
const HAS_LIVE = randomUUID();
const ONLY_A = randomUUID();
const ONLY_B = randomUUID();
const WD_FRESH = randomUUID();
const POST_FRESH = randomUUID();
const PREVIEW = randomUUID();
const FOUR = [GROCERY, STUDIO, KHATARIO, HAS_LIVE];
const ALL = [...FOUR, ONLY_A, ONLY_B, WD_FRESH, POST_FRESH, PREVIEW];

const THEMES: Record<string, unknown> = {
  [GROCERY]: groceryAll,
  [STUDIO]: studioSaved,
  [KHATARIO]: khatarioAll,
  [HAS_LIVE]: groceryAll,
  [ONLY_A]: khatarioAll,
  [ONLY_B]: groceryAll,
  [WD_FRESH]: khatarioAll,
  [POST_FRESH]: groceryAll,
  [PREVIEW]: studioSaved,
};

d('Store theme migration runner (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;

  const themeCount = async (ids: string[] = ALL) =>
    (await pool.query(`SELECT count(*)::int AS n FROM store_themes WHERE business_id = ANY($1)`, [ids])).rows[0].n as number;
  const settingsSnapshot = async () =>
    (
      await pool.query(
        `SELECT business_id, store_engine, store_theme FROM business_settings WHERE business_id = ANY($1) ORDER BY business_id`,
        [ALL],
      )
    ).rows;
  const rowFor = <T extends { business_id: string }>(rows: T[], id: string): T => {
    const r = rows.find((x) => x.business_id === id);
    if (!r) throw new Error(`no report row for ${id}`);
    return r;
  };

  let seededSettings: unknown[];

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'migrate-test-secret';
    pool = db.getPool();
    for (const [i, id] of ALL.entries()) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '29AAAPA1234A1Z5', '29', 'regular')`,
        [id, `Migrate test ${i}`],
      );
      await pool.query(
        `INSERT INTO business_settings (business_id, store_subdomain, store_enabled, store_tagline, store_theme)
         VALUES ($1, $2, true, 'Fresh every day', $3::jsonb)`,
        [id, `mg${SEED}${i}`, JSON.stringify(THEMES[id])],
      );
    }
    await pool.query(
      `INSERT INTO store_themes (business_id, name, role, preset, data) VALUES ($1, 'Existing', 'live', 'blank', '{}'::jsonb)`,
      [HAS_LIVE],
    );
    seededSettings = await settingsSnapshot();
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM store_theme_versions WHERE business_id = ANY($1)`, [ALL]);
    await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, [ALL]);
    await pool.query(`DELETE FROM business_settings WHERE business_id = ANY($1)`, [ALL]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [ALL]);
    await db.closePool();
  });

  it('refuses a database it was not allowed', async () => {
    const before = await themeCount();
    const nameSpy = jest.spyOn(runner, 'currentDatabaseName').mockResolvedValue('khatario');
    const querySpy = jest.spyOn(db, 'query');
    const poolQuery = jest.spyOn(pool, 'query');
    const poolConnect = jest.spyOn(pool, 'connect');
    try {
      await expect(runStoreThemeMigration({ all: true })).rejects.toBeInstanceOf(MigrationRefusedError);
      await expect(runStoreThemeMigration({ all: true, allowDatabase: 'kh_phase2_test' })).rejects.toBeInstanceOf(
        MigrationRefusedError,
      );
      expect(nameSpy).toHaveBeenCalledTimes(2);
      expect(querySpy).not.toHaveBeenCalled();
      expect(poolQuery).not.toHaveBeenCalled();
      expect(poolConnect).not.toHaveBeenCalled();
    } finally {
      nameSpy.mockRestore();
      querySpy.mockRestore();
      poolQuery.mockRestore();
      poolConnect.mockRestore();
    }
    expect(await themeCount()).toBe(before);
  });

  it('refuses without exactly one of all or business ids', async () => {
    await expect(runStoreThemeMigration({})).rejects.toBeInstanceOf(MigrationRefusedError);
    await expect(runStoreThemeMigration({ businessIds: [] })).rejects.toBeInstanceOf(MigrationRefusedError);
    await expect(runStoreThemeMigration({ all: true, businessIds: [GROCERY] })).rejects.toBeInstanceOf(MigrationRefusedError);
    await expect(runStoreThemeMigration({ businessIds: ['nope'] })).rejects.toBeInstanceOf(MigrationRefusedError);
  });

  it('dry run writes nothing', async () => {
    const before = await themeCount();
    const out = await runStoreThemeMigration({ all: true, dryRun: true });
    expect(out.database).toBe('kh_phase2_test');
    expect(out.dryRun).toBe(true);
    for (const id of [GROCERY, STUDIO, KHATARIO]) {
      const r = rowFor(out.rows, id);
      expect(r.status).toBe('would_migrate');
      expect(r.theme_id).toBeUndefined();
    }
    expect(rowFor(out.rows, HAS_LIVE).status).toBe('skipped_live');
    expect(rowFor(out.rows, GROCERY).preset).toBe('grocery');
    expect(rowFor(out.rows, GROCERY).subdomain).toBe(`mg${SEED}0`);
    expect(await themeCount()).toBe(before);
  });

  it('migrates once', async () => {
    const out = await runStoreThemeMigration({ businessIds: FOUR });
    expect(out.dryRun).toBe(false);
    const expected: Record<string, string> = { [GROCERY]: 'grocery', [STUDIO]: 'studio', [KHATARIO]: 'khatario' };
    for (const [id, preset] of Object.entries(expected)) {
      const r = rowFor(out.rows, id);
      expect(r.status).toBe('migrated');
      expect(r.preset).toBe(preset);
      const live = (
        await pool.query(`SELECT id, role, preset, name, data, updated_by FROM store_themes WHERE business_id = $1 AND role = 'live'`, [id])
      ).rows;
      expect(live).toHaveLength(1);
      expect(live[0].id).toBe(r.theme_id);
      expect(live[0].preset).toBe(preset);
      expect(live[0].updated_by).toBeNull();
      expect(sanitizeThemeData(live[0].data)).toEqual(live[0].data);
      const input = (await migrationInputFor(id))!;
      expect(live[0].data.templates.home).toEqual(migrateStoreTheme(input.raw, input.ctx).data.templates.home);
    }
    expect(rowFor(out.rows, HAS_LIVE).status).toBe('skipped_live');
  });

  it('idempotent, leaves flags and old theme alone', async () => {
    const stamps = async () =>
      (await pool.query(`SELECT id, updated_at FROM store_themes WHERE business_id = ANY($1) ORDER BY id`, [FOUR])).rows;
    const before = await stamps();
    const out = await runStoreThemeMigration({ businessIds: FOUR });
    expect(FOUR.map((id) => rowFor(out.rows, id).status)).toEqual(['skipped_live', 'skipped_live', 'skipped_live', 'skipped_live']);
    expect(await stamps()).toEqual(before);
    const settings = await settingsSnapshot();
    for (const s of settings) expect(s.store_engine).toBe(false);
    expect(settings).toEqual(seededSettings);
  });

  it('businessIds only touches those', async () => {
    const out = await runStoreThemeMigration({ businessIds: [ONLY_A] });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ business_id: ONLY_A, status: 'migrated', preset: 'khatario' });
    expect(await themeCount([ONLY_A])).toBe(1);
    expect(await themeCount([ONLY_B, WD_FRESH, POST_FRESH, PREVIEW])).toBe(0);
  });

  it('reports an unknown business as not_found', async () => {
    const ghost = randomUUID();
    const out = await runStoreThemeMigration({ businessIds: [ghost], dryRun: true });
    expect(out.rows).toEqual([{ business_id: ghost, subdomain: null, status: 'not_found', warnings: [] }]);
  });

  it('working draft and POST start from the migrated live theme', async () => {
    const w = await getOrCreateWorkingDraft(WD_FRESH, state.user);
    if (!w.ok) throw new Error(w.code);
    const rows = (await pool.query(`SELECT id, role, preset, data, is_working FROM store_themes WHERE business_id = $1`, [WD_FRESH])).rows;
    expect(rows).toHaveLength(2);
    const live = rows.find((r) => r.role === 'live');
    expect(live.preset).toBe('khatario');
    expect(w.value.is_working).toBe(true);
    expect(w.value.preset).toBe('khatario');
    expect(w.value.data).toEqual(live.data);

    state.biz = POST_FRESH;
    const res = await listRoute.POST(
      new NextRequest('http://localhost:3000/api/settings/online-store/themes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Quick try', preset: 'quick', business_id: GROCERY }),
      }),
    );
    expect(res.status).toBe(201);
    const theme = (await res.json()).theme;
    expect(theme).toMatchObject({ role: 'draft', preset: 'quick', business_id: POST_FRESH });
    const lives = (await pool.query(`SELECT preset, updated_by FROM store_themes WHERE business_id = $1 AND role = 'live'`, [POST_FRESH])).rows;
    expect(lives).toEqual([{ preset: 'grocery', updated_by: state.user }]);
    // The body's business_id was ignored: GROCERY still has only its one migrated theme.
    expect(await themeCount([GROCERY])).toBe(1);

    // R16: the migrated first version always shows "Set up automatically", also when the app created it.
    const versions = (
      await pool.query(
        `SELECT business_id, published_by, preset FROM store_theme_versions WHERE business_id = ANY($1) ORDER BY preset`,
        [[WD_FRESH, POST_FRESH]],
      )
    ).rows;
    expect(versions).toEqual([
      { business_id: POST_FRESH, published_by: null, preset: 'grocery' },
      { business_id: WD_FRESH, published_by: null, preset: 'khatario' },
    ]);
  });

  it('preview links', async () => {
    const out = await runStoreThemeMigration({ businessIds: [PREVIEW], previewLinks: true });
    const r = rowFor(out.rows, PREVIEW);
    expect(r.status).toBe('migrated');
    expect(r.preview_path).toBeDefined();
    const u = new URL(r.preview_path!, 'http://store.localhost');
    expect(u.pathname).toBe('/');
    expect(u.searchParams.get('preview_theme')).toBe(r.theme_id);
    expect(verifyThemePreview(u.searchParams.get('pt'), PREVIEW)).toBe(r.theme_id);
    expect(verifyThemePreview(u.searchParams.get('pt'), GROCERY)).toBeNull();
  });
});
