import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { StoreItemsOutOfStock } from '@/lib/store/store-items-query';
import { loadEngineTheme } from './load-theme';
import type { ThemeData } from './types';

/** The theme's out-of-stock place in lists; a theme without the setting (or none) leaves products where they are. */
export function themeOosPlace(data: Pick<ThemeData, 'settings'> | null | undefined): StoreItemsOutOfStock {
  const place = data?.settings?.product_card?.oos_place;
  return place === 'end' || place === 'hide' ? place : 'stay';
}

/**
 * Where out-of-stock products go in a public product list: the store's engine theme decides, the live one
 * (or the previewed theme when the request carries a verified preview token). A store without the engine
 * always answers `stay`, and so does any failure, so a broken theme can never empty a list.
 */
export async function storeOosPlace(store: StoreBusinessContext, sp: URLSearchParams): Promise<StoreItemsOutOfStock> {
  if (store.is_demo) return 'stay';
  try {
    const engine = await loadEngineTheme(store, {
      preview_theme: sp.get('preview_theme'),
      pt: sp.get('pt'),
    });
    return engine ? themeOosPlace(engine.theme.data) : 'stay';
  } catch {
    return 'stay';
  }
}
