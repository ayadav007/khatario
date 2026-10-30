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
import { createTheme } from '@/lib/store/engine/themes-repo';
import { signThemePreview, PREVIEW_TTL } from '@/lib/store/engine/preview-token';
import { loadEngineTheme } from '@/lib/store/engine/load-theme';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { resolveOfflineStoreForPreview } from '@/lib/store/preview-store';
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
    live = ok(await createTheme(BIZ, USER, { name: 'Main', preset: 'studio', ctx }));
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
});
