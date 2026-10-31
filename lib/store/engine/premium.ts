// The per-store premium themes switch. This file is the only place that knows how it is stored.
import { queryOne } from '@/lib/db';

/** True when the store may create premium presets; a store without a settings row is off. */
export async function premiumThemesEnabled(businessId: string): Promise<boolean> {
  const row = await queryOne<{ store_premium_themes: boolean | null }>(
    `SELECT store_premium_themes FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return row?.store_premium_themes === true;
}
