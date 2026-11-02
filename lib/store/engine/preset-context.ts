import { queryOne } from '@/lib/db';
import type { PresetContext } from './presets';

export interface PresetContextRow {
  name?: string | null;
  tagline?: string | null;
  store_theme?: unknown;
  hero_url?: string | null;
}

/**
 * The preset context from a business row. Pure.
 * It carries no accent: an added theme starts in its own colours, never the store's accent. Only a migrated store
 * keeps its colour (the migration and its Studio fallback in `insertMigratedLiveLocked` pass it themselves).
 */
export function presetContextFromRow(row: PresetContextRow | null | undefined): PresetContext {
  const raw = row?.store_theme && typeof row.store_theme === 'object' ? (row.store_theme as Record<string, unknown>) : {};
  const logo = typeof raw.logo_url === 'string' ? raw.logo_url : '';
  return {
    businessName: row?.name ?? '',
    tagline: row?.tagline ?? '',
    logoUrl: logo || undefined,
    heroUrl: row?.hero_url || undefined,
  };
}

/** Store name, tagline, logo and hero image used to fill a preset theme for this business. */
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
