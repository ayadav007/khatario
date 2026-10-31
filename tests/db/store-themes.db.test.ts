/**
 * Store theme repository against real PostgreSQL: live/draft roles, optimistic save, publish with
 * version history, per-business isolation and limits.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with migration 450 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import {
  createTheme,
  deleteTheme,
  getLiveTheme,
  getOrCreateWorkingDraft,
  getTheme,
  insertMigratedLiveLocked,
  listThemes,
  publishTheme,
  renameTheme,
  resetWorkingDraft,
  saveTheme,
} from '@/lib/store/engine/themes-repo';
import * as migrationInput from '@/lib/store/engine/migration-input';
import { presetTheme } from '@/lib/store/engine/presets';
import { presetContextFromRow } from '@/lib/store/engine/preset-context';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { STORE_THEME_PRESETS } from '@/lib/store/store-theme';
import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';
import { groceryAll } from '../lib/store/engine/fixtures/store-themes';

const ctx = { businessName: 'Theme test', tagline: 'Tagline' };

d('Store themes repository (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const BIZ = randomUUID();
  const OTHER = randomUUID();
  const FULL = randomUUID();
  const WD = randomUUID();
  const WD_EMPTY = randomUUID();
  const WD_FULL = randomUUID();
  const USER = randomUUID();

  function ok<T>(r: { ok: true; value: T } | { ok: false; code: string }): T {
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
    return r.value;
  }

  beforeAll(async () => {
    pool = getPool();
    for (const id of [BIZ, OTHER, FULL, WD, WD_EMPTY, WD_FULL]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Theme test', '29AAAPA1234A1Z5', '29', 'regular')`,
        [id],
      );
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, [[BIZ, OTHER, FULL, WD, WD_EMPTY, WD_FULL]]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [[BIZ, OTHER, FULL, WD, WD_EMPTY, WD_FULL]]);
    await closePool();
  });

  let live: ThemeRow;
  let draft: ThemeRow;

  it('creates the first theme live and the second as a draft', async () => {
    live = ok(await createTheme(BIZ, USER, { name: 'Main', preset: 'studio', ctx }));
    draft = ok(await createTheme(BIZ, USER, { name: 'Festive', preset: 'blank', ctx }));
    expect(live.role).toBe('live');
    expect(draft.role).toBe('draft');
    expect(draft.preset).toBe('blank');
    expect((await getLiveTheme(BIZ))?.id).toBe(live.id);
    const list = await listThemes(BIZ);
    expect(list).toHaveLength(2);
    expect('data' in list[0]).toBe(false);
  });

  it('refuses to save a live theme', async () => {
    const r = await saveTheme(BIZ, USER, live.id, live.data, null);
    expect(r).toEqual({ ok: false, code: 'live_locked' });
  });

  it('saves a draft with the right updated_at and rejects a stale one', async () => {
    const first = ok(await saveTheme(BIZ, USER, draft.id, presetTheme('studio', ctx), draft.updated_at));
    expect(first.updated_at).not.toBe(draft.updated_at);
    expect(first.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    const stale = await saveTheme(BIZ, USER, draft.id, presetTheme('studio', ctx), draft.updated_at);
    expect(stale).toEqual({ ok: false, code: 'conflict' });
    const noCheck = await saveTheme(BIZ, USER, draft.id, presetTheme('studio', ctx), null);
    expect(noCheck.ok).toBe(true);
    draft = (await getTheme(BIZ, draft.id))!;
  });

  it('sanitises saved data', async () => {
    const r = ok(
      await saveTheme(BIZ, USER, draft.id, { templates: { home: { order: ['x'], sections: { x: { type: 'nope' } } } } }, null),
    );
    expect(r.data.templates.home.order).toEqual([]);
    expect(r.data.settings.color_schemes.length).toBeGreaterThan(0);
    draft = r;
  });

  it('renames within 1-60 chars', async () => {
    expect(ok(await renameTheme(BIZ, draft.id, '  Diwali  ')).name).toBe('Diwali');
    expect(await renameTheme(BIZ, draft.id, '   ')).toEqual({ ok: false, code: 'conflict' });
    expect(await renameTheme(BIZ, draft.id, 'x'.repeat(61))).toEqual({ ok: false, code: 'conflict' });
    expect(await renameTheme(BIZ, randomUUID(), 'Ok')).toEqual({ ok: false, code: 'not_found' });
  });

  it('publishes a draft: it goes live, the old live becomes a draft, one version row', async () => {
    const published = ok(await publishTheme(BIZ, USER, draft.id));
    expect(published.role).toBe('live');
    expect((await getTheme(BIZ, live.id))?.role).toBe('draft');
    expect((await getLiveTheme(BIZ))?.id).toBe(draft.id);
    const v = await pool.query(`SELECT * FROM store_theme_versions WHERE business_id = $1`, [BIZ]);
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0].theme_id).toBe(draft.id);
    expect(v.rows[0].published_by).toBe(USER);
  });

  it('keeps only the newest 30 versions after 31 publishes', async () => {
    for (let i = 0; i < 31; i++) {
      ok(await publishTheme(BIZ, USER, i % 2 === 0 ? live.id : draft.id));
    }
    const v = await pool.query(`SELECT count(*)::int AS n FROM store_theme_versions WHERE business_id = $1`, [BIZ]);
    expect(v.rows[0].n).toBe(30);
    const lives = await pool.query(`SELECT count(*)::int AS n FROM store_themes WHERE business_id = $1 AND role = 'live'`, [BIZ]);
    expect(lives.rows[0].n).toBe(1);
  });

  it('serialises concurrent publishes so only one theme is live', async () => {
    const results = await Promise.all([publishTheme(BIZ, USER, live.id), publishTheme(BIZ, USER, draft.id)]);
    expect(results.every((r) => r.ok)).toBe(true);
    const lives = await pool.query(`SELECT count(*)::int AS n FROM store_themes WHERE business_id = $1 AND role = 'live'`, [BIZ]);
    expect(lives.rows[0].n).toBe(1);
  });

  it('isolates businesses', async () => {
    expect(await getTheme(OTHER, live.id)).toBeNull();
    expect(await saveTheme(OTHER, USER, draft.id, live.data, null)).toEqual({ ok: false, code: 'not_found' });
    expect(await publishTheme(OTHER, USER, draft.id)).toEqual({ ok: false, code: 'not_found' });
    expect(await deleteTheme(OTHER, draft.id)).toEqual({ ok: false, code: 'not_found' });
    expect(await renameTheme(OTHER, draft.id, 'Hijack')).toEqual({ ok: false, code: 'not_found' });
    expect(await getLiveTheme(OTHER)).toBeNull();
  });

  it('duplicates data and names the copy', async () => {
    const current = (await getLiveTheme(BIZ))!;
    const copy = ok(await createTheme(BIZ, USER, { name: '', duplicateOf: current.id, ctx }));
    expect(copy.name).toBe(`Copy of ${current.name}`);
    expect(copy.role).toBe('draft');
    expect(copy.data).toEqual(current.data);
    expect(await createTheme(BIZ, USER, { name: 'x', duplicateOf: randomUUID(), ctx })).toEqual({ ok: false, code: 'not_found' });
    expect(await createTheme(OTHER, USER, { name: 'x', duplicateOf: current.id, ctx })).toEqual({ ok: false, code: 'not_found' });
    ok(await deleteTheme(BIZ, copy.id));
  });

  it('rejects oversized data', async () => {
    const html = '<p>' + 'a'.repeat(19000) + '</p>';
    const sections: Record<string, unknown> = {};
    const order: string[] = [];
    for (let i = 0; i < 25; i++) {
      sections[`s${i}`] = { type: 'custom-html', settings: { html } };
      order.push(`s${i}`);
    }
    const templates: Record<string, unknown> = {};
    for (let p = 0; p < 30; p++) templates[`page.p${p}`] = { order, sections };
    const draftId = (await listThemes(BIZ)).find((t) => t.role === 'draft')!.id;
    const r = await saveTheme(BIZ, USER, draftId, { templates }, null);
    expect(r).toEqual({ ok: false, code: 'too_large' });
  });

  it('deletes drafts but not the live theme', async () => {
    const all = await listThemes(BIZ);
    const lv = all.find((t) => t.role === 'live')!;
    const dr = all.find((t) => t.role === 'draft')!;
    expect(await deleteTheme(BIZ, lv.id)).toEqual({ ok: false, code: 'live_locked' });
    expect(await deleteTheme(BIZ, dr.id)).toEqual({ ok: true, value: true });
    expect(await getTheme(BIZ, dr.id)).toBeNull();
  });

  it('stops at 20 themes per business', async () => {
    for (let i = 0; i < 20; i++) ok(await createTheme(FULL, USER, { name: `T${i}`, preset: 'blank', ctx }));
    expect(await createTheme(FULL, USER, { name: 'T21', preset: 'blank', ctx })).toEqual({ ok: false, code: 'limit' });
  });

  describe('working draft', () => {
    it('is created once and reused', async () => {
      ok(await createTheme(WD, USER, { name: 'Main', preset: 'studio', ctx }));
      const a = ok(await getOrCreateWorkingDraft(WD, USER));
      const b = ok(await getOrCreateWorkingDraft(WD, USER));
      expect(b.id).toBe(a.id);
      expect(a.is_working).toBe(true);
      expect(a.role).toBe('draft');
      expect(a.name).toBe('Main (editing)');
      const n = await pool.query(`SELECT count(*)::int AS n FROM store_themes WHERE business_id = $1 AND is_working`, [WD]);
      expect(n.rows[0].n).toBe(1);
      expect((await listThemes(WD)).find((t) => t.id === a.id)?.is_working).toBe(true);
    });

    it('copies the live data', async () => {
      const liveRow = (await getLiveTheme(WD))!;
      const w = ok(await getOrCreateWorkingDraft(WD, USER));
      expect(w.data).toEqual(liveRow.data);
    });

    it('creates a live Studio theme when there is none', async () => {
      const w = ok(await getOrCreateWorkingDraft(WD_EMPTY, USER));
      const rows = await pool.query(`SELECT id, role, preset, is_working FROM store_themes WHERE business_id = $1`, [WD_EMPTY]);
      expect(rows.rows).toHaveLength(2);
      const liveRows = rows.rows.filter((r) => r.role === 'live');
      expect(liveRows).toHaveLength(1);
      expect(liveRows[0].preset).toBe('studio');
      expect(liveRows[0].is_working).toBe(false);
      expect(rows.rows.filter((r) => r.is_working).map((r) => r.id)).toEqual([w.id]);
    });

    it('publishing the working draft copies its data onto the live theme and keeps editing the same draft', async () => {
      const w = ok(await getOrCreateWorkingDraft(WD, USER));
      const liveBefore = (await getLiveTheme(WD))!;
      const countBefore = (await listThemes(WD)).length;
      const versionsBefore = (
        await pool.query(`SELECT count(*)::int AS n FROM store_theme_versions WHERE business_id = $1`, [WD])
      ).rows[0].n;
      const edited = { ...w.data, settings: { ...w.data.settings, button_radius: 3 } };
      const saved = ok(await saveTheme(WD, USER, w.id, edited, w.updated_at));

      const pub = ok(await publishTheme(WD, USER, w.id));
      expect(pub.id).toBe(liveBefore.id);
      expect(pub.role).toBe('live');
      expect(pub.data.settings.button_radius).toBe(3);
      expect(pub.updated_at > liveBefore.updated_at).toBe(true);

      const live = (await getLiveTheme(WD))!;
      expect(live.id).toBe(liveBefore.id);
      expect(live.data).toEqual(saved.data);

      const after = (await getTheme(WD, w.id))!;
      expect(after.role).toBe('draft');
      expect(after.is_working).toBe(true);
      expect(after.updated_at).toBe(saved.updated_at); // the editor's save token still holds
      expect(ok(await getOrCreateWorkingDraft(WD, USER)).id).toBe(w.id);
      expect((await listThemes(WD)).length).toBe(countBefore);

      const v = await pool.query(
        `SELECT theme_id, data, published_by FROM store_theme_versions WHERE business_id = $1 ORDER BY published_at DESC, id DESC`,
        [WD],
      );
      expect(v.rows.length).toBe(versionsBefore + 1);
      expect(v.rows[0].theme_id).toBe(liveBefore.id);
      expect(v.rows[0].data).toEqual(saved.data);
      expect(v.rows[0].published_by).toBe(USER);
    });

    it('publishing the working draft again and again never adds themes or "(editing)"', async () => {
      const w = ok(await getOrCreateWorkingDraft(WD, USER));
      const countBefore = (await listThemes(WD)).length;
      for (let i = 0; i < 3; i++) ok(await publishTheme(WD, USER, w.id));
      const all = await listThemes(WD);
      expect(all.length).toBe(countBefore);
      expect(all.find((t) => t.id === w.id)!.name).toBe('Main (editing)');
      expect(all.some((t) => t.name.includes('(editing) (editing)'))).toBe(false);
    });

    it('publishing a draft that is not the working draft still swaps roles', async () => {
      const w = ok(await getOrCreateWorkingDraft(WD, USER));
      const liveBefore = (await getLiveTheme(WD))!;
      const other = ok(await createTheme(WD, USER, { name: 'Library', preset: 'blank', ctx }));
      const pub = ok(await publishTheme(WD, USER, other.id));
      expect(pub.id).toBe(other.id);
      expect(pub.role).toBe('live');
      expect(pub.is_working).toBe(false);
      expect((await getTheme(WD, liveBefore.id))!.role).toBe('draft');
      const still = (await getTheme(WD, w.id))!;
      expect(still.is_working).toBe(true);
      expect(still.role).toBe('draft');
    });

    it('names a working draft without doubling "(editing)"', async () => {
      const biz = randomUUID();
      await pool.query(`INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Theme test', '29AAAPA1234A1Z5', '29', 'regular')`, [biz]);
      try {
        ok(await createTheme(biz, USER, { name: 'Shop (editing)', preset: 'blank', ctx }));
        expect(ok(await getOrCreateWorkingDraft(biz, USER)).name).toBe('Shop (editing)');
      } finally {
        await pool.query(`DELETE FROM store_themes WHERE business_id = $1`, [biz]);
        await pool.query(`DELETE FROM businesses WHERE id = $1`, [biz]);
      }
    });

    it('two concurrent calls produce one draft', async () => {
      const biz = randomUUID();
      await pool.query(`INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Theme test', '29AAAPA1234A1Z5', '29', 'regular')`, [biz]);
      try {
        const [x, y] = await Promise.all([getOrCreateWorkingDraft(biz, USER), getOrCreateWorkingDraft(biz, USER)]);
        expect(ok(x).id).toBe(ok(y).id);
      } finally {
        await pool.query(`DELETE FROM store_themes WHERE business_id = $1`, [biz]);
        await pool.query(`DELETE FROM businesses WHERE id = $1`, [biz]);
      }
    });

    it('fails with limit at 20 themes', async () => {
      for (let i = 0; i < 20; i++) ok(await createTheme(WD_FULL, USER, { name: `T${i}`, preset: 'blank', ctx }));
      expect(await getOrCreateWorkingDraft(WD_FULL, USER)).toEqual({ ok: false, code: 'limit' });
    });
  });
  describe('library (M5)', () => {
    const made: string[] = [];
    const newBiz = async (storeTheme?: unknown): Promise<string> => {
      const id = randomUUID();
      made.push(id);
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Library test', '29AAAPA1234A1Z5', '29', 'regular')`,
        [id],
      );
      if (storeTheme !== undefined) {
        await pool.query(`INSERT INTO business_settings (business_id, store_theme) VALUES ($1, $2::jsonb)`, [id, JSON.stringify(storeTheme)]);
      }
      return id;
    };
    const count = async (biz: string) =>
      (await pool.query(`SELECT count(*)::int AS n FROM store_themes WHERE business_id = $1`, [biz])).rows[0].n as number;
    /** A copy of `data` whose first product rail has another heading. */
    const withHeading = (data: ThemeData, heading: string): ThemeData => {
      const copy = JSON.parse(JSON.stringify(data)) as ThemeData;
      const home = copy.templates.home;
      const id = home.order.find((k) => home.sections[k].type === 'product-rail');
      if (!id) throw new Error('no product rail');
      home.sections[id].settings.heading = heading;
      return copy;
    };
    /** Live L (Studio), working draft W, and a Blank library draft X. */
    const libraryStore = async () => {
      const biz = await newBiz();
      const live = ok(await createTheme(biz, USER, { name: 'Main', preset: 'studio', ctx }));
      const w = ok(await getOrCreateWorkingDraft(biz, USER));
      const x = ok(await createTheme(biz, USER, { name: 'Festive', preset: 'blank', ctx }));
      expect(x.data).not.toEqual(live.data);
      return { biz, live, w, x };
    };

    afterAll(async () => {
      jest.restoreAllMocks();
      await pool.query(`DELETE FROM store_theme_versions WHERE business_id = ANY($1)`, [made]);
      await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, [made]);
      await pool.query(`DELETE FROM business_settings WHERE business_id = ANY($1)`, [made]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [made]);
    });

    it('N2: publishing a library draft refreshes a clean working draft', async () => {
      const { biz, w, x } = await libraryStore();
      ok(await publishTheme(biz, USER, x.id));
      const refreshed = (await getTheme(biz, w.id))!;
      expect(refreshed.is_working).toBe(true);
      expect(refreshed.data).toEqual(x.data);
      expect(refreshed.preset).toBe(x.preset);
      expect(refreshed.name).toBe('Festive (editing)');
      expect(refreshed.updated_at).not.toBe(w.updated_at);

      ok(await publishTheme(biz, USER, w.id));
      const liveNow = (await getLiveTheme(biz))!;
      expect(liveNow.id).toBe(x.id);
      expect(liveNow.data).toEqual(x.data);
    });

    it('N2: a working draft with edits is kept as a draft', async () => {
      const { biz, w, x } = await libraryStore();
      const edited = ok(await saveTheme(biz, USER, w.id, withHeading(w.data, 'Edited rail'), w.updated_at));
      ok(await publishTheme(biz, USER, x.id));

      const kept = (await getTheme(biz, w.id))!;
      expect(kept.is_working).toBe(false);
      expect(kept.role).toBe('draft');
      expect(kept.name).toBe('Main (unpublished edits)');
      expect(kept.data).toEqual(edited.data);

      const fresh = ok(await getOrCreateWorkingDraft(biz, USER));
      expect(fresh.id).not.toBe(w.id);
      expect(fresh.data).toEqual(x.data);
      expect(fresh.name).toBe('Festive (editing)');
    });

    it('working-draft publish copies the preset', async () => {
      const { biz, live, w } = await libraryStore();
      await pool.query(`UPDATE store_themes SET preset = 'quick' WHERE id = $1`, [w.id]);
      const pub = ok(await publishTheme(biz, USER, w.id));
      expect(pub.id).toBe(live.id);
      expect(pub.preset).toBe('quick');
      expect(pub.name).toBe('Main');
      expect((await getLiveTheme(biz))!.preset).toBe('quick');
    });

    it('has_changes', async () => {
      const { biz, w } = await libraryStore();
      const flags = async () => Object.fromEntries((await listThemes(biz)).map((t) => [t.id, t.has_changes]));
      let f = await flags();
      expect(f[w.id]).toBe(false);
      expect(Object.values(f).every((v) => v === false)).toBe(true);

      ok(await saveTheme(biz, USER, w.id, withHeading(w.data, 'Changed'), null));
      f = await flags();
      expect(f[w.id]).toBe(true);
      expect(Object.entries(f).filter(([id]) => id !== w.id).every(([, v]) => v === false)).toBe(true);
    });

    it('resetWorkingDraft', async () => {
      const { biz, live, w } = await libraryStore();
      const saved = ok(await saveTheme(biz, USER, w.id, withHeading(w.data, 'Throw away'), null));
      await pool.query(`UPDATE store_themes SET preset = 'quick', name = 'Renamed' WHERE id = $1`, [w.id]);
      const reset = ok(await resetWorkingDraft(biz, USER));
      expect(reset.id).toBe(w.id);
      expect(reset.is_working).toBe(true);
      expect(reset.data).toEqual(live.data);
      expect(reset.preset).toBe(live.preset);
      expect(reset.name).toBe('Main (editing)');
      expect(reset.updated_at).not.toBe(saved.updated_at);
      expect((await listThemes(biz)).find((t) => t.id === w.id)!.has_changes).toBe(false);

      const noWorking = await newBiz();
      ok(await createTheme(noWorking, USER, { name: 'Only', preset: 'blank', ctx }));
      expect(await resetWorkingDraft(noWorking, USER)).toEqual({ ok: false, code: 'not_found' });
      expect(await resetWorkingDraft(OTHER, USER)).toEqual({ ok: false, code: 'not_found' });
    });

    it('delete refuses the working draft', async () => {
      const { biz, live, w, x } = await libraryStore();
      expect(await deleteTheme(biz, w.id)).toEqual({ ok: false, code: 'working_locked' });
      expect(await getTheme(biz, w.id)).not.toBeNull();
      expect(await deleteTheme(biz, live.id)).toEqual({ ok: false, code: 'live_locked' });
      expect(await deleteTheme(biz, x.id)).toEqual({ ok: true, value: true });
      expect(await getTheme(biz, x.id)).toBeNull();
    });

    it('migrated source', async () => {
      const biz = await newBiz(groceryAll);
      // The first create puts the store's migrated design live (R16: its version has no author).
      ok(await createTheme(biz, USER, { name: 'First', preset: 'blank', ctx }));
      const versions = (await pool.query(`SELECT published_by FROM store_theme_versions WHERE business_id = $1`, [biz])).rows;
      expect(versions).toEqual([{ published_by: null }]);

      const r = ok(await createTheme(biz, USER, { name: '', source: 'migrated', ctx }));
      expect(r.role).toBe('draft');
      expect(r.is_working).toBe(false);
      expect(r.preset).toBe('grocery');
      expect(r.name).toBe(`${STORE_THEME_PRESETS.grocery.label} (from your store)`);
      expect(r.name).toBe('Premium Grocery (from your store)');
      expect(r.data).toEqual((await getLiveTheme(biz))!.data);
      const named = ok(await createTheme(biz, USER, { name: ' My copy ', source: 'migrated', ctx }));
      expect(named.name).toBe('My copy');

      const bare = await newBiz();
      expect(await createTheme(bare, USER, { name: '', source: 'migrated', ctx })).toEqual({ ok: false, code: 'no_store_design' });
      expect(await count(bare)).toBe(0);
    });

    it('limit applies to every create', async () => {
      const biz = await newBiz(groceryAll);
      while ((await count(biz)) < 20) ok(await createTheme(biz, USER, { name: 'Fill', preset: 'blank', ctx }));
      const anyId = (await listThemes(biz))[0].id;
      expect(await createTheme(biz, USER, { name: 'P', preset: 'studio', ctx })).toEqual({ ok: false, code: 'limit' });
      expect(await createTheme(biz, USER, { name: '', duplicateOf: anyId, ctx })).toEqual({ ok: false, code: 'limit' });
      expect(await createTheme(biz, USER, { name: '', source: 'migrated', ctx })).toEqual({ ok: false, code: 'limit' });
      expect(await count(biz)).toBe(20);
    });

    it('oversized migration falls back', async () => {
      const biz = await newBiz({ preset: 'studio' });
      const ch = '\u0001'; // JSON-escaped to six bytes, so even the capped fields pass 512 KB
      const big = {
        preset: 'studio',
        custom_css: ch.repeat(8000),
        studio_sections: Array.from({ length: 24 }, (_, i) => ({
          id: `rt${i}`,
          type: 'richtext',
          name: 'Text',
          enabled: true,
          settings: { heading: ch.repeat(120), text: ch.repeat(2000), customCss: ch.repeat(3000) },
        })),
      };
      const spy = jest.spyOn(migrationInput, 'migrationInputFor').mockResolvedValue({
        raw: big,
        ctx: { businessName: 'Library test', tagline: '', aboutMd: '', heroUrl: '', logoUrl: '', categories: [] },
      });
      try {
        const w = ok(await getOrCreateWorkingDraft(biz, USER));
        expect(spy).toHaveBeenCalled();
        const liveRow = (await getLiveTheme(biz))!;
        expect(liveRow.preset).toBe('studio');
        expect(w.data).toEqual(liveRow.data);
        // Section ids are random per preset build, so compare the settings and the home's section types.
        const studio = sanitizeThemeData(presetTheme('studio', presetContextFromRow({ name: 'Library test', store_theme: big })));
        const types = (d: ThemeData) => d.templates.home.order.map((k) => d.templates.home.sections[k].type);
        expect(liveRow.data.settings).toEqual(studio.settings);
        expect(types(liveRow.data)).toEqual(types(studio));
        expect(liveRow.name).toBe(STORE_THEME_PRESETS.studio.label);
        const v = (await pool.query(`SELECT published_by, preset FROM store_theme_versions WHERE business_id = $1`, [biz])).rows;
        expect(v).toEqual([{ published_by: null, preset: 'studio' }]);

        // The caller is told why (rolled back: another business with no themes).
        const other = await newBiz({ preset: 'studio' });
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const r = await insertMigratedLiveLocked(client, other, null, (await migrationInput.migrationInputFor(other))!);
          expect(r!.theme.preset).toBe('studio');
          expect(r!.warnings).toContain('Your store design was too large to copy; the Studio theme was used instead');
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      } finally {
        spy.mockRestore();
      }
    });

    it('no migration read when live exists', async () => {
      const biz = await newBiz(groceryAll);
      ok(await createTheme(biz, USER, { name: 'First', preset: 'blank', ctx }));
      const spy = jest.spyOn(migrationInput, 'migrationInputFor');
      try {
        ok(await createTheme(biz, USER, { name: 'Second', preset: 'studio', ctx }));
        ok(await getOrCreateWorkingDraft(biz, USER));
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('R16: the migrated first version has no author when the working draft creates it', async () => {
      const biz = await newBiz(groceryAll);
      ok(await getOrCreateWorkingDraft(biz, USER));
      const v = (await pool.query(`SELECT published_by, preset FROM store_theme_versions WHERE business_id = $1`, [biz])).rows;
      expect(v).toEqual([{ published_by: null, preset: 'grocery' }]);
      const liveRow = (await pool.query(`SELECT updated_by FROM store_themes WHERE business_id = $1 AND role = 'live'`, [biz])).rows;
      expect(liveRow).toEqual([{ updated_by: USER }]);
    });
  });

  describe('menus', () => {
    const made: string[] = [];
    const newBiz = async (): Promise<string> => {
      const id = randomUUID();
      made.push(id);
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Menus test', '29AAAPA1234A1Z5', '29', 'regular')`,
        [id],
      );
      return id;
    };

    afterAll(async () => {
      await pool.query(`DELETE FROM store_theme_versions WHERE business_id = ANY($1)`, [made]);
      await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, [made]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [made]);
    });

    /** A draft saved with `mutate` applied to a copy of the Studio preset's data. */
    const savedDraft = async (mutate: (raw: Record<string, any>) => void) => {
      const biz = await newBiz();
      ok(await createTheme(biz, USER, { name: 'Main', preset: 'studio', ctx }));
      const draft = ok(await createTheme(biz, USER, { name: 'Menus', preset: 'studio', ctx }));
      const raw = JSON.parse(JSON.stringify(draft.data)) as Record<string, any>;
      mutate(raw);
      const saved = ok(await saveTheme(biz, USER, draft.id, raw, null));
      return { biz, id: draft.id, saved };
    };

    it('two menus with three levels, a picture and a categories item survive a save and reload', async () => {
      const menus = [
        {
          id: 'main',
          name: 'Main menu',
          items: [
            {
              id: 'shop',
              label: 'Shop',
              link: '/catalog',
              highlight: true,
              picture: { image: 'https://example.com/shop.jpg', caption: 'New season', link: '/catalog' },
              children: [
                {
                  id: 'women',
                  label: 'Women',
                  link: '',
                  children: [
                    { id: 'sarees', label: 'Sarees', link: '/catalog/sarees' },
                    { id: 'suits', label: 'Suits', link: '/catalog/suits' },
                  ],
                },
                { id: 'men', label: 'Men', link: '/catalog/men' },
              ],
            },
            { id: 'cats', label: 'Categories', link: '', source: 'categories', category_photos: true },
            { id: 'about', label: 'About', link: '/pages/about' },
          ],
        },
        {
          id: 'footer',
          name: 'Footer menu',
          items: [{ id: 'help', label: 'Help', link: '', children: [{ id: 'faq', label: 'FAQ', link: '/pages/faq' }] }],
        },
      ];
      const { biz, id, saved } = await savedDraft((raw) => {
        raw.settings.menus = menus;
      });
      const reloaded = (await getTheme(biz, id))!;
      expect(reloaded.data.settings.menus).toEqual(menus);
      expect(reloaded.data.settings.menus).toEqual(saved.data.settings.menus);
    });

    it('an old theme with header menu_link blocks and no menus loads with the main menu and header menu main', async () => {
      const { biz, id } = await savedDraft((raw) => {
        delete raw.settings.menus;
        const header = raw.header_group.order.map((k: string) => raw.header_group.sections[k]).find((s: any) => s.type === 'header');
        header.blocks = {
          l1: { type: 'menu_link', settings: { label: 'Shop all', link: '/catalog' } },
          l2: { type: 'menu_link', settings: { label: 'Offers', link: '/pages/offers', highlight: true } },
        };
        header.block_order = ['l1', 'l2'];
        delete header.settings.menu;
      });
      const reloaded = (await getTheme(biz, id))!;
      const main = reloaded.data.settings.menus.find((m) => m.id === 'main')!;
      expect(main.items.map((i) => [i.label, i.link, i.highlight === true])).toEqual([
        ['Shop all', '/catalog', false],
        ['Offers', '/pages/offers', true],
      ]);
      expect(reloaded.data.settings.menus.some((m) => m.id === 'footer')).toBe(true);
      const hid = reloaded.data.header_group.order.find((k) => reloaded.data.header_group.sections[k].type === 'header')!;
      const header = reloaded.data.header_group.sections[hid];
      expect(header.settings.menu).toBe('main');
      expect(header.block_order).toEqual([]);
    });
  });
});
