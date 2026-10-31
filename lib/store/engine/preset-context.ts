import { queryOne } from '@/lib/db';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import type { PresetContext } from './presets';

export interface PresetContextRow {
  name?: string | null;
  tagline?: string | null;
  store_theme?: unknown;
  hero_url?: string | null;
}

/**
 * The preset context from a business row. Pure.
 * `accent` is the store's effective accent (D26): a named old preset uses its pack's accent, as the
 * old storefront does, whatever `store_theme.accent` holds.
 */
export function presetContextFromRow(row: PresetContextRow | null | undefined): PresetContext {
  const raw = row?.store_theme && typeof row.store_theme === 'object' ? (row.store_theme as Record<string, unknown>) : {};
  const logo = typeof raw.logo_url === 'string' ? raw.logo_url : '';
  return {
    businessName: row?.name ?? '',
    tagline: row?.tagline ?? '',
    accent: sanitizeStoreTheme(row?.store_theme).accent,
    logoUrl: logo || undefined,
    heroUrl: row?.hero_url || undefined,
  };
}

/** Store name, tagline, accent, logo and hero image used to fill a preset theme for this business. */
export async function presetContextFor(businessId: string): Promise<PresetContext> {
  const row = await queryOne<PresetContextRow>(
    `SELECT b.name,
            bs.store_tagline AS tagline,
            bs.store_theme,
            bs.store_hero_image_url AS hero_url
       FROM businesses b
       LEFT JOIN business_settings bs ON bs.business_id = b.id
      WHERE b.id = $1`,
    [businessId],
  );
  return presetContextFromRow(row);
}
