import { queryOne } from '@/lib/db';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { filterDemoCatalog } from '@/lib/store/theme-demo';
import { migrateStoreTheme } from './migrate';
import { sanitizeThemeData } from './sanitize';
import { getLiveTheme } from './themes-repo';
import { resolvePreviewTarget } from './preview-target';
import type { ThemeRow } from './types';

function clean(row: ThemeRow): ThemeRow {
  return { ...row, data: sanitizeThemeData(row.data) };
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
): Promise<{ theme: ThemeRow; preview: boolean; demo?: true; version?: true } | null> {
  // Demo stores touch no database: `?engine=1` shows their migrated theme as a preview, anything else the old store.
  // Real stores ignore `engine`.
  if (store.is_demo) {
    return params.engine === '1' ? { theme: demoEngineTheme(store), preview: true, demo: true } : null;
  }

  // A genuine token for this business naming exactly this theme or version (D47); a version is read-only.
  const previewed = await resolvePreviewTarget(store.business_id, params.preview_theme, params.pt);
  if (previewed) return { theme: clean(previewed.theme), preview: true, ...(previewed.version ? { version: true as const } : {}) };

  const flag = await queryOne<{ store_engine: boolean | null }>(
    `SELECT store_engine FROM business_settings WHERE business_id = $1`,
    [store.business_id],
  );
  if (!flag?.store_engine) return null;

  const live = await getLiveTheme(store.business_id);
  return live ? { theme: clean(live), preview: false } : null;
}
