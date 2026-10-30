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
  listThemes,
  publishTheme,
  renameTheme,
  saveTheme,
} from '@/lib/store/engine/themes-repo';
import { presetTheme } from '@/lib/store/engine/presets';
import type { ThemeRow } from '@/lib/store/engine/types';

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

    it('publish clears the working flag and a new working draft copies the new live', async () => {
      const w = ok(await getOrCreateWorkingDraft(WD, USER));
      const pub = ok(await publishTheme(WD, USER, w.id));
      expect(pub.role).toBe('live');
      expect(pub.is_working).toBe(false);
      const next = ok(await getOrCreateWorkingDraft(WD, USER));
      expect(next.id).not.toBe(w.id);
      expect(next.is_working).toBe(true);
      expect(next.data).toEqual((await getLiveTheme(WD))!.data);
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
});
