import { queryOne } from '@/lib/db';
import type { PresetContext } from './presets';

/** Store name, tagline, accent, logo and hero image used to fill a preset theme for this business. */
export async function presetContextFor(businessId: string): Promise<PresetContext> {
  const row = await queryOne<{
    name: string | null;
    tagline: string | null;
    accent: string | null;
    logo_url: string | null;
    hero_url: string | null;
  }>(
    `SELECT b.name,
            bs.store_tagline AS tagline,
            bs.store_theme->>'accent' AS accent,
            bs.store_theme->>'logo_url' AS logo_url,
            bs.store_hero_image_url AS hero_url
       FROM businesses b
       LEFT JOIN business_settings bs ON bs.business_id = b.id
      WHERE b.id = $1`,
    [businessId],
  );
  return {
    businessName: row?.name ?? '',
    tagline: row?.tagline ?? '',
    accent: row?.accent || undefined,
    logoUrl: row?.logo_url || undefined,
    heroUrl: row?.hero_url || undefined,
  };
}
