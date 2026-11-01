// The per-store premium themes switch. This file is the only place that knows how it is stored.
import { queryOne } from '@/lib/db';

/**
 * Premium presets are free for every store until a pricing model is decided (owner, 2026-11-01). Set this to
 * false to gate them by the `store_premium_themes` column again; nothing else changes.
 */
export const PREMIUM_THEMES_FREE = true;

/** The stored switch: true when the store's settings row has `store_premium_themes` on; no row is off. */
export async function premiumFlagOn(businessId: string): Promise<boolean> {
  const row = await queryOne<{ store_premium_themes: boolean | null }>(
    `SELECT store_premium_themes FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return row?.store_premium_themes === true;
}

/** True when the store may create premium presets: always while they are free, else the stored switch. */
export async function premiumThemesEnabled(businessId: string): Promise<boolean> {
  if (PREMIUM_THEMES_FREE) return true;
  return premiumFlagOn(businessId);
}
