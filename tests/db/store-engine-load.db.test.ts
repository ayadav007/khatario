/**
 * Storefront theme loading against real PostgreSQL: the store_engine flag, live theme, and signed previews.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with migration 450 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
// Store resolution checks the plan; these test businesses have no subscription.
jest.mock('@/lib/subscription/feature-access', () => ({ hasFeatureAccess: jest.fn(async () => true) }));

import { getPool, closePool } from '@/lib/db';
import { createTheme, getLiveTheme } from '@/lib/store/engine/themes-repo';
import { signThemePreview, signVersionPreview, PREVIEW_TTL } from '@/lib/store/engine/preview-token';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { loadEngineTheme } from '@/lib/store/engine/load-theme';
import { loadEnginePage } from '@/lib/store/engine/page-loader';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { resolveOfflineStoreForPreview } from '@/lib/store/preview-store';
import { THEME_DEMO_SLUGS, themeDemoStore } from '@/lib/store/theme-demo';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { ThemeRow } from '@/lib/store/engine/types';

const ctx = { businessName: 'Load test', tagline: 'Tagline' };

d('Storefront theme loading (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const OTHER = randomUUID();
  const EMPTY = randomUUID();
  const USER = randomUUID();
  const storeOf = (id: string, extra = {}) => ({ business_id: id, is_demo: false, ...extra }) as unknown as StoreBusinessContext;
  let live: ThemeRow;
  let draft: ThemeRow;
  let otherDraft: ThemeRow;
  const savedSecret = process.env.JWT_SECRET;
  const SUB = `lt${BIZ.replace(/-/g, '').slice(0, 12)}`;

  const setFlag = (id: string, on: boolean) =>
    pool.query(`UPDATE business_settings SET store_engine = $2 WHERE business_id = $1`, [id, on]);
  const ok = <T,>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
    return r.value;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'load-theme-test-secret';
    pool = getPool();
    for (const id of [BIZ, OTHER, EMPTY]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Load test', '29AAAPA1234A1Z5', '29', 'regular')`,
        [id],
      );
      await pool.query(`INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [id]);
    }
    // These stores have a settings row, so the first create puts the store's migrated design live (D33, M5).
    ok(await createTheme(BIZ, USER, { name: 'Main', preset: 'studio', ctx }));
    live = (await getLiveTheme(BIZ))!;
    draft = ok(await createTheme(BIZ, USER, { name: 'Draft', preset: 'blank', ctx }));
    ok(await createTheme(OTHER, USER, { name: 'Other live', preset: 'studio', ctx }));
    otherDraft = ok(await createTheme(OTHER, USER, { name: 'Other draft', preset: 'blank', ctx }));
    await pool.query(`UPDATE business_settings SET store_subdomain = $2, store_enabled = false WHERE business_id = $1`, [BIZ, SUB]);
  });

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
    if (!pool) return;
    const ids = [[BIZ, OTHER, EMPTY]];
    await pool.query(`DELETE FROM store_theme_versions WHERE business_id = ANY($1)`, ids);
    await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, ids);
    await pool.query(`DELETE FROM business_settings WHERE business_id = ANY($1)`, ids);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, ids);
    await closePool();
  });

  it('returns null when the flag is off and there is no token', async () => {
    await setFlag(BIZ, false);
    expect(await loadEngineTheme(storeOf(BIZ), {})).toBeNull();
  });

  it('returns the live theme when the flag is on', async () => {
    await setFlag(BIZ, true);
    const out = await loadEngineTheme(storeOf(BIZ), {});
    expect(out?.preview).toBe(false);
    expect(out?.theme.id).toBe(live.id);
  });

  it('returns null when the flag is on but there is no live theme', async () => {
    await setFlag(EMPTY, true);
    expect(await loadEngineTheme(storeOf(EMPTY), {})).toBeNull();
  });

  it('returns null for demo stores before touching the database', async () => {
    await setFlag(BIZ, true);
    const pt = signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor);
    expect(await loadEngineTheme(storeOf(BIZ, { is_demo: true }), { preview_theme: draft.id, pt })).toBeNull();
  });

  it('previews a draft with a valid token, even when the flag is off', async () => {
    const pt = signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor);
    for (const on of [true, false]) {
      await setFlag(BIZ, on);
      const out = await loadEngineTheme(storeOf(BIZ), { preview_theme: draft.id, pt });
      expect(out?.preview).toBe(true);
      expect(out?.theme.id).toBe(draft.id);
    }
  });

  it('ignores a token signed for another business theme', async () => {
    await setFlag(BIZ, true);
    const pt = signThemePreview(OTHER, otherDraft.id, PREVIEW_TTL.editor);
    const out = await loadEngineTheme(storeOf(BIZ), { preview_theme: otherDraft.id, pt });
    expect(out?.preview).toBe(false);
    expect(out?.theme.id).toBe(live.id);
  });

  it('ignores an expired token', async () => {
    await setFlag(BIZ, true);
    const pt = signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor, Date.now() - 3 * 3600_000);
    const out = await loadEngineTheme(storeOf(BIZ), { preview_theme: draft.id, pt });
    expect(out?.preview).toBe(false);
    expect(out?.theme.id).toBe(live.id);
  });

  it('ignores a valid token when preview_theme names a different theme', async () => {
    await setFlag(BIZ, true);
    const pt = signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor);
    const out = await loadEngineTheme(storeOf(BIZ), { preview_theme: live.id, pt });
    expect(out?.preview).toBe(false);
    expect(out?.theme.id).toBe(live.id);
  });

  it('ignores a non-uuid preview_theme and a token for a theme that no longer exists', async () => {
    await setFlag(BIZ, true);
    const pt = signThemePreview(BIZ, 'not-a-uuid', PREVIEW_TTL.editor);
    expect((await loadEngineTheme(storeOf(BIZ), { preview_theme: 'not-a-uuid', pt }))?.preview).toBe(false);
    const gone = randomUUID();
    const pt2 = signThemePreview(BIZ, gone, PREVIEW_TTL.editor);
    expect((await loadEngineTheme(storeOf(BIZ), { preview_theme: gone, pt: pt2 }))?.preview).toBe(false);
  });

  it('falls back to the live path instead of throwing when no signing secret is configured', async () => {
    await setFlag(BIZ, true);
    const pt = signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor);
    delete process.env.JWT_SECRET;
    const savedNext = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      const out = await loadEngineTheme(storeOf(BIZ), { preview_theme: draft.id, pt });
      expect(out?.preview).toBe(false);
      expect(out?.theme.id).toBe(live.id);
    } finally {
      process.env.JWT_SECRET = 'load-theme-test-secret';
      if (savedNext !== undefined) process.env.NEXTAUTH_SECRET = savedNext;
    }
  });

  it('an offline store renders its draft with a valid token and stays hidden without one', async () => {
    await setFlag(BIZ, false);
    // Not launched: the normal lookup does not find it.
    expect(await resolveStoreBySubdomain(SUB)).toBeNull();

    // No token, or only half of the preview params: still hidden.
    expect(await resolveOfflineStoreForPreview(SUB, null, null)).toBeNull();
    expect(await resolveOfflineStoreForPreview(SUB, draft.id, null)).toBeNull();
    expect(await resolveOfflineStoreForPreview(SUB, null, signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor))).toBeNull();

    // Tokens that do not name this theme for this business: still hidden.
    expect(await resolveOfflineStoreForPreview(SUB, otherDraft.id, signThemePreview(OTHER, otherDraft.id, PREVIEW_TTL.editor))).toBeNull();
    expect(await resolveOfflineStoreForPreview(SUB, live.id, signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor))).toBeNull();
    expect(await resolveOfflineStoreForPreview(SUB, draft.id, 'garbage.token')).toBeNull();
    const expired = signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor, Date.now() - 3 * 3600_000);
    expect(await resolveOfflineStoreForPreview(SUB, draft.id, expired)).toBeNull();

    // A verified token for this business and theme: the store resolves and renders the draft.
    const pt = signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor);
    const store = await resolveOfflineStoreForPreview(SUB, draft.id.toUpperCase(), pt);
    expect(store?.business_id).toBe(BIZ);
    const out = await loadEngineTheme(store!, { preview_theme: draft.id, pt });
    expect(out?.preview).toBe(true);
    expect(out?.theme.id).toBe(draft.id);
  });

  it('keeps an offline store hidden when the valid token names a deleted theme', async () => {
    const gone = ok(await createTheme(BIZ, USER, { name: 'Gone', preset: 'blank', ctx }));
    const pt = signThemePreview(BIZ, gone.id, PREVIEW_TTL.editor);
    expect((await resolveOfflineStoreForPreview(SUB, gone.id, pt))?.business_id).toBe(BIZ);
    await pool.query(`DELETE FROM store_themes WHERE business_id = $1 AND id = $2`, [BIZ, gone.id]);
    expect(await resolveOfflineStoreForPreview(SUB, gone.id, pt)).toBeNull();
  });

  it('custom page loads by handle', async () => {
    await setFlag(BIZ, true);
    const sale = {
      order: ['intro'],
      sections: { intro: { type: 'rich-text', settings: { heading: 'Big Sale' } } },
      title: 'Sale',
      seo_title: 'Big Sale',
    };
    // Written straight to the row: `page.cart` is reserved, so the sanitiser must drop it on read.
    await pool.query(
      `UPDATE store_themes SET data = jsonb_set(jsonb_set(data, '{templates,page.sale}', $3::jsonb), '{templates,page.cart}', $3::jsonb)
       WHERE business_id = $1 AND id = $2`,
      [BIZ, live.id, JSON.stringify(sale)],
    );
    const store = storeOf(BIZ);
    const found = await loadEnginePage(store, {}, 'page.sale');
    expect(found?.template?.title).toBe('Sale');
    expect(found?.template?.seo_title).toBe('Big Sale');
    expect(found?.template?.order).toEqual(['intro']);
    expect((await loadEnginePage(store, {}, 'page.missing'))?.template).toBeNull();
    const reserved = await loadEnginePage(store, {}, 'page.cart');
    expect(reserved).not.toBeNull();
    expect(reserved?.template).toBeNull();
  });

  it('never resolves a demo store through the preview path', async () => {
    const slug = Object.keys(THEME_DEMO_SLUGS)[0];
    const demo = themeDemoStore(slug)!;
    expect(demo.is_demo).toBe(true);
    const pt = signThemePreview(demo.business_id, draft.id, PREVIEW_TTL.editor);
    expect(await resolveOfflineStoreForPreview(slug, draft.id, pt)).toBeNull();
  });

  describe('version previews (M5 D47)', () => {
    let vid: string;
    let otherVid: string;
    const addVersion = async (theme: ThemeRow, name: string) =>
      (
        await pool.query(
          `INSERT INTO store_theme_versions (theme_id, business_id, data, preset, theme_name, published_by)
           SELECT id, business_id, data, preset, $2, NULL FROM store_themes WHERE id = $1 RETURNING id`,
          [theme.id, name],
        )
      ).rows[0].id as string;

    beforeAll(async () => {
      vid = await addVersion(draft, 'Old look');
      otherVid = await addVersion(otherDraft, 'Other old look');
    });

    it("a version token opens the version's data read-only, even when the flag is off", async () => {
      await setFlag(BIZ, false);
      const pt = signVersionPreview(BIZ, vid, PREVIEW_TTL.version);
      const out = await loadEngineTheme(storeOf(BIZ), { preview_theme: vid, pt });
      expect(out?.preview).toBe(true);
      expect(out?.version).toBe(true);
      expect(out?.theme).toMatchObject({ id: vid, name: 'Old look', preset: draft.preset, role: 'draft', is_working: false });
      expect(out?.theme.data).toEqual(sanitizeThemeData(draft.data));
      // A theme preview carries no version flag.
      const themeOut = await loadEngineTheme(storeOf(BIZ), { preview_theme: draft.id, pt: signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor) });
      expect(themeOut?.version).toBeUndefined();
    });

    it('a version is never in editor mode, even with editor=1', async () => {
      await setFlag(BIZ, false);
      const pt = signVersionPreview(BIZ, vid, PREVIEW_TTL.version);
      const page = await loadEnginePage(storeOf(BIZ), { preview_theme: vid, pt, editor: '1' }, 'home');
      expect(page?.preview).toBe(true);
      expect(page?.theme.id).toBe(vid);
      expect(page?.editor).toBe(false);
      // The same request for a theme token is editor mode, so the flag is what turns it off.
      const themePt = signThemePreview(BIZ, draft.id, PREVIEW_TTL.editor);
      expect((await loadEnginePage(storeOf(BIZ), { preview_theme: draft.id, pt: themePt, editor: '1' }, 'home'))?.editor).toBe(true);
    });

    it('token kinds never cross: a version token with a theme id, and a theme token with a version id, do not resolve', async () => {
      await setFlag(BIZ, false);
      expect(await loadEngineTheme(storeOf(BIZ), { preview_theme: draft.id, pt: signVersionPreview(BIZ, draft.id, PREVIEW_TTL.version) })).toBeNull();
      expect(await loadEngineTheme(storeOf(BIZ), { preview_theme: vid, pt: signThemePreview(BIZ, vid, PREVIEW_TTL.editor) })).toBeNull();
      // A genuine version token for another version id of this business does not open this one.
      expect(await loadEngineTheme(storeOf(BIZ), { preview_theme: draft.id, pt: signVersionPreview(BIZ, vid, PREVIEW_TTL.version) })).toBeNull();
    });

    it('a version token signed for another business does not resolve, with either version id', async () => {
      await setFlag(BIZ, false);
      expect(await loadEngineTheme(storeOf(BIZ), { preview_theme: otherVid, pt: signVersionPreview(OTHER, otherVid, PREVIEW_TTL.version) })).toBeNull();
      expect(await loadEngineTheme(storeOf(BIZ), { preview_theme: vid, pt: signVersionPreview(OTHER, vid, PREVIEW_TTL.version) })).toBeNull();
      // Signed for this business but naming the other business's version: the lookup is scoped, so still nothing.
      expect(await loadEngineTheme(storeOf(BIZ), { preview_theme: otherVid, pt: signVersionPreview(BIZ, otherVid, PREVIEW_TTL.version) })).toBeNull();
      // An expired version token.
      const expired = signVersionPreview(BIZ, vid, PREVIEW_TTL.version, Date.now() - 3 * 3600_000);
      expect(await loadEngineTheme(storeOf(BIZ), { preview_theme: vid, pt: expired })).toBeNull();
    });

    it('an unlaunched store resolves for a version token and not for a tampered one', async () => {
      await setFlag(BIZ, false);
      expect(await resolveStoreBySubdomain(SUB)).toBeNull();
      const pt = signVersionPreview(BIZ, vid, PREVIEW_TTL.version);
      const store = await resolveOfflineStoreForPreview(SUB, vid.toUpperCase(), pt);
      expect(store?.business_id).toBe(BIZ);
      const out = await loadEngineTheme(store!, { preview_theme: vid, pt });
      expect(out?.version).toBe(true);
      expect(out?.theme.id).toBe(vid);

      const [body, sig] = pt.split('.');
      const flip = (s: string, i: number) => `${s.slice(0, i)}${s[i] === 'A' ? 'B' : 'A'}${s.slice(i + 1)}`;
      expect(await resolveOfflineStoreForPreview(SUB, vid, `${body}.${flip(sig, sig.length >> 1)}`)).toBeNull();
      expect(await resolveOfflineStoreForPreview(SUB, vid, signThemePreview(BIZ, vid, PREVIEW_TTL.editor))).toBeNull();
      expect(await resolveOfflineStoreForPreview(SUB, otherVid, signVersionPreview(OTHER, otherVid, PREVIEW_TTL.version))).toBeNull();
    });
  });
});
