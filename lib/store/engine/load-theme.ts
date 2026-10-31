import { queryOne } from '@/lib/db';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { filterDemoCatalog } from '@/lib/store/theme-demo';
import { migrateStoreTheme } from './migrate';
import { sanitizeThemeData } from './sanitize';
import { getLiveTheme, getTheme } from './themes-repo';
import { verifyThemePreview } from './preview-token';
import type { ThemeRow } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(row: ThemeRow): ThemeRow {
  return { ...row, data: sanitizeThemeData(row.data) };
}

/** A preview needs a genuine token for this business, for exactly the requested theme, which must still exist. */
async function previewTheme(store: StoreBusinessContext, previewId: string | null | undefined, token: string | null | undefined) {
  if (!previewId || !token || !UUID.test(previewId)) return null;
  let verified: string | null = null;
  try {
    verified = verifyThemePreview(token, store.business_id);
  } catch {
    return null; // no signing secret configured: treat as no valid preview
  }
  if (!verified || verified.toLowerCase() !== previewId.toLowerCase()) return null;
  return getTheme(store.business_id, previewId);
}

/** The fixed id of a demo store's migrated theme; it is never stored. */
export const DEMO_ENGINE_THEME_ID = '00000000-0000-4000-8000-0000000000e1';

/**
 * D35: a theme demo store's old design, migrated to an engine theme in memory. Pure and fixed (no db, no clock),
 * so the parity report gets the same old/new pair for every pack on any host.
 */
export function demoEngineTheme(store: StoreBusinessContext): ThemeRow {
  const categories = filterDemoCatalog({ pack: store.store_theme?.pack, page: 1, limit: 1 }).categories.map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const migrated = migrateStoreTheme(store.store_theme, {
    businessName: store.name,
    tagline: store.store_tagline ?? '',
    aboutMd: store.store_about_md ?? '',
    heroUrl: store.store_hero_image_url ?? '',
    logoUrl: store.logo_url ?? '',
    categories,
  });
  return clean({
    id: DEMO_ENGINE_THEME_ID,
    business_id: store.business_id,
    name: migrated.name,
    role: 'live',
    preset: migrated.preset,
    data: migrated.data,
    updated_at: '1970-01-01T00:00:00.000Z',
    is_working: false,
  });
}

export async function loadEngineTheme(
  store: StoreBusinessContext,
  params: { preview_theme?: string | null; pt?: string | null; engine?: string | null },
): Promise<{ theme: ThemeRow; preview: boolean; demo?: true } | null> {
  // Demo stores touch no database: `?engine=1` shows their migrated theme as a preview, anything else the old store.
  // Real stores ignore `engine`.
  if (store.is_demo) {
    return params.engine === '1' ? { theme: demoEngineTheme(store), preview: true, demo: true } : null;
  }

  const previewed = await previewTheme(store, params.preview_theme, params.pt);
  if (previewed) return { theme: clean(previewed), preview: true };

  const flag = await queryOne<{ store_engine: boolean | null }>(
    `SELECT store_engine FROM business_settings WHERE business_id = $1`,
    [store.business_id],
  );
  if (!flag?.store_engine) return null;

  const live = await getLiveTheme(store.business_id);
  return live ? { theme: clean(live), preview: false } : null;
}
