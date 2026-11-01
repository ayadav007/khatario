import { queryOne } from '@/lib/db';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { StoreItemsOutOfStock } from '@/lib/store/store-items-query';
import { loadEngineTheme } from './load-theme';
import type { ThemeData } from './types';

/** A raw `oos_place` value as the sanitiser keeps it: `end` or `hide`, anything else leaves products where they are. */
export function oosPlaceValue(raw: unknown): StoreItemsOutOfStock {
  return raw === 'end' || raw === 'hide' ? raw : 'stay';
}

/** The theme's out-of-stock place in lists; a theme without the setting (or none) leaves products where they are. */
export function themeOosPlace(data: Pick<ThemeData, 'settings'> | null | undefined): StoreItemsOutOfStock {
  return oosPlaceValue(data?.settings?.product_card?.oos_place);
}

/** Just the live theme's `product_card.oos_place`, for a store with the engine switched on (no row otherwise). */
const LIVE_OOS_PLACE_SQL = `SELECT st.data->'settings'->'product_card'->>'oos_place' AS oos_place
       FROM business_settings bs
       JOIN store_themes st ON st.business_id = bs.business_id AND st.role = 'live'
      WHERE bs.business_id = $1 AND bs.store_engine = true`;

/**
 * Where out-of-stock products go in a public product list: the store's engine theme decides, the live one
 * (or the previewed theme when the request carries a verified preview token). Without a preview only the one value
 * is read, not the whole theme. A store without the engine always answers `stay`, and so does any failure, so a
 * broken theme can never empty a list.
 */
export async function storeOosPlace(store: StoreBusinessContext, sp: URLSearchParams): Promise<StoreItemsOutOfStock> {
  if (store.is_demo) return 'stay';
  try {
    const previewTheme = sp.get('preview_theme');
    const pt = sp.get('pt');
    if (previewTheme && pt) {
      const engine = await loadEngineTheme(store, { preview_theme: previewTheme, pt });
      return engine ? themeOosPlace(engine.theme.data) : 'stay';
    }
    const row = await queryOne<{ oos_place: string | null }>(LIVE_OOS_PLACE_SQL, [store.business_id]);
    return oosPlaceValue(row?.oos_place);
  } catch {
    return 'stay';
  }
}
