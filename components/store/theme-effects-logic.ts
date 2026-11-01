import { sanitizeStoreTheme, storeFontStack } from '@/lib/store/store-theme';

export interface StoreThemeEffectsOutput {
  /** Body font rule from the old store theme. */
  fontCss: string | null;
  customCss: string | null;
  faviconUrl: string | null;
}

/**
 * What the old `store_theme` applies to the page: body font, custom CSS and favicon.
 * Nothing while an engine theme renders the page (D11): the engine brings its own.
 */
export function storeThemeEffects(rawTheme: unknown, engineActive: boolean): StoreThemeEffectsOutput {
  if (engineActive) return { fontCss: null, customCss: null, faviconUrl: null };
  const theme = sanitizeStoreTheme(rawTheme);
  return {
    fontCss: `body,.store-root{font-family:${storeFontStack(theme.font_family)}}`,
    customCss: theme.custom_css || null,
    faviconUrl: theme.favicon_url || null,
  };
}
