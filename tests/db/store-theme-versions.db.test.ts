/**
 * Published theme versions (M5 Task 1, D44/D46/D47/D49) against real PostgreSQL: the per-business timeline, names and
 * presets kept at publish time, versions outliving a deleted theme, the per-business prune and the migrated first version.
 * Runs only when PHASE2_TEST_DATABASE_URL points at the disposable kh_phase2_test database with migration 454 applied.
 */
import { randomInt, randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import {
  createTheme,
  deleteTheme,
  getOrCreateWorkingDraft,
  lockBusinessThemes,
  publishTheme,
} from '@/lib/store/engine/themes-repo';
import { getVersion, listVersions, pruneVersionsLocked, versionAsTheme } from '@/lib/store/engine/versions-repo';
import type { ThemeRow } from '@/lib/store/engine/types';
import { groceryAll } from '../lib/store/engine/fixtures/store-themes';

const ctx = { businessName: 'Versions test', tagline: 'Tagline' };
const ISO_US = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;

d('Store theme versions (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const BIZ = randomUUID();
  const OTHER = randomUUID();
  const MIG = randomUUID();
  const ALL = [BIZ, OTHER, MIG];
  const ASHA = randomUUID();
  const SEED = Date.now().toString(36);

  function ok<T>(r: { ok: true; value: T } | { ok: false; code: string }): T {
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
    return r.value;
  }

  beforeAll(async () => {
    pool = getPool();
    for (const id of ALL) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Versions test', '29AAAPA1234A1Z5', '29', 'regular')`,
        [id],
      );
    }
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Asha', $3, false, true)`,
      [ASHA, BIZ, `8${randomInt(100_000_000, 999_999_999)}`],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled, store_tagline, store_theme)
       VALUES ($1, $2, true, 'Fresh every day', $3::jsonb)`,
      [MIG, `tv${SEED}`, JSON.stringify(groceryAll)],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM store_theme_versions WHERE business_id = ANY($1)`, [ALL]);
    await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, [ALL]);
    await pool.query(`DELETE FROM business_settings WHERE business_id = ANY($1)`, [ALL]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ASHA]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [ALL]);
    await closePool();
  });

  let main: ThemeRow;
  let green: ThemeRow;
  let greenVersionId: string;

  it('publish records name and preset', async () => {
    main = ok(await createTheme(BIZ, ASHA, { name: 'Main', preset: 'studio', ctx }));
    green = ok(await createTheme(BIZ, ASHA, { name: 'Green', preset: 'grocery', ctx }));
    ok(await publishTheme(BIZ, ASHA, green.id));
    const list = await listVersions(BIZ);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      theme_id: green.id,
      theme_name: 'Green',
      preset: 'grocery',
      published_by_name: 'Asha',
      theme_exists: true,
    });
    expect(list[0].published_at).toMatch(ISO_US);
    expect(Object.keys(list[0]).sort()).toEqual(
      ['id', 'preset', 'published_at', 'published_by_name', 'theme_exists', 'theme_id', 'theme_name'].sort(),
    );
    greenVersionId = list[0].id;
  });

  it('working-draft publish records the live row', async () => {
    const w = ok(await getOrCreateWorkingDraft(BIZ, ASHA));
    expect(w.name).toBe('Green (editing)');
    const pub = ok(await publishTheme(BIZ, ASHA, w.id));
    expect(pub.id).toBe(green.id);
    const [latest] = await listVersions(BIZ);
    expect(latest.theme_id).toBe(green.id);
    expect(latest.theme_name).toBe('Green');
    expect(latest.theme_exists).toBe(true);
  });

  it('versions outlive a deleted theme', async () => {
    const blue = ok(await createTheme(BIZ, ASHA, { name: 'Blue', preset: 'blank', ctx }));
    ok(await publishTheme(BIZ, ASHA, blue.id));
    ok(await deleteTheme(BIZ, green.id));
    const list = await listVersions(BIZ);
    const gone = list.find((v) => v.id === greenVersionId);
    expect(gone).toMatchObject({ theme_id: null, theme_exists: false, theme_name: 'Green', preset: 'grocery' });
    const full = await getVersion(BIZ, greenVersionId);
    expect(full).not.toBeNull();
    expect(full!.business_id).toBe(BIZ);
    expect(full!.theme_id).toBeNull();
    expect(full!.data.settings.color_schemes.length).toBeGreaterThan(0);
    expect(full!.data).toEqual(green.data);
  });

  it('prune keeps 30 per business', async () => {
    const a = ok(await createTheme(OTHER, ASHA, { name: 'A', preset: 'studio', ctx }));
    const b = ok(await createTheme(OTHER, ASHA, { name: 'B', preset: 'blank', ctx }));
    for (const id of [b.id, a.id, b.id]) ok(await publishTheme(OTHER, ASHA, id));
    expect(await listVersions(OTHER)).toHaveLength(3);

    const blue = (await pool.query(`SELECT id FROM store_themes WHERE business_id = $1 AND role = 'live'`, [BIZ])).rows[0].id;
    const before = await listVersions(BIZ);
    const oldest = before[before.length - 1].id;
    for (let i = 0; i < 31; i++) ok(await publishTheme(BIZ, ASHA, i % 2 === 0 ? main.id : blue));

    const count = (await pool.query(`SELECT count(*)::int AS n FROM store_theme_versions WHERE business_id = $1`, [BIZ])).rows[0].n;
    expect(count).toBe(30);
    const list = await listVersions(BIZ);
    expect(list).toHaveLength(30);
    expect(list.some((v) => v.id === oldest)).toBe(false);
    expect(await getVersion(BIZ, oldest)).toBeNull();
    expect(await listVersions(OTHER)).toHaveLength(3);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].published_at >= list[i].published_at).toBe(true);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockBusinessThemes(client, BIZ);
      expect(await pruneVersionsLocked(client, BIZ)).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('foreign version', async () => {
    const [mine] = await listVersions(BIZ);
    expect(await getVersion(BIZ, mine.id)).not.toBeNull();
    expect(await getVersion(OTHER, mine.id)).toBeNull();
    expect(await getVersion(BIZ, randomUUID())).toBeNull();
  });

  it('versionAsTheme', async () => {
    const [latest] = await listVersions(BIZ);
    const v = (await getVersion(BIZ, latest.id))!;
    const t = versionAsTheme(v);
    expect(t).toEqual({
      id: v.id,
      business_id: BIZ,
      name: v.theme_name,
      role: 'draft',
      preset: v.preset,
      data: v.data,
      updated_at: v.published_at,
      is_working: false,
    });
    expect(t.updated_at).toBe(v.published_at);
  });

  it('migrated live theme records a version', async () => {
    // A session user with no users row stands in for "no author": the script passes null, and so does the name join.
    ok(await getOrCreateWorkingDraft(MIG, randomUUID()));
    const list = await listVersions(MIG);
    expect(list).toHaveLength(1);
    const live = (await pool.query(`SELECT id, name, preset FROM store_themes WHERE business_id = $1 AND role = 'live'`, [MIG])).rows[0];
    expect(list[0]).toMatchObject({
      theme_id: live.id,
      theme_name: live.name,
      preset: 'grocery',
      published_by_name: null,
      theme_exists: true,
    });
  });

  it('migration columns', async () => {
    const cols = (
      await pool.query(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'store_theme_versions'`,
      )
    ).rows as Array<{ column_name: string; is_nullable: string }>;
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable]));
    expect(byName.preset).toBe('YES');
    expect(byName.theme_name).toBe('YES');
    expect(byName.theme_id).toBe('YES');
    const fks = (
      await pool.query(
        `SELECT confdeltype FROM pg_constraint
          WHERE conrelid = 'store_theme_versions'::regclass AND contype = 'f' AND confrelid = 'store_themes'::regclass`,
      )
    ).rows;
    expect(fks).toEqual([{ confdeltype: 'n' }]);
  });
});
