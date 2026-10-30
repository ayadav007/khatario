import { storeThemeEffects } from '@/components/store/theme-effects-logic';

const oldTheme = {
  font_family: 'playfair',
  custom_css: '.x{color:red}',
  favicon_url: 'https://cdn.example.com/fav.png',
};

describe('storeThemeEffects', () => {
  it('applies the old store theme font, custom CSS and favicon on old storefront pages', () => {
    const out = storeThemeEffects(oldTheme, false);
    expect(out.fontCss).toMatch(/^body,\.store-root\{font-family:/);
    expect(out.customCss).toBe('.x{color:red}');
    expect(out.faviconUrl).toBe('https://cdn.example.com/fav.png');
  });

  it('returns no CSS and no favicon when the engine renders the page', () => {
    expect(storeThemeEffects(oldTheme, true)).toEqual({ fontCss: null, customCss: null, faviconUrl: null });
  });

  it('returns no custom CSS or favicon when the old theme has none', () => {
    const out = storeThemeEffects(null, false);
    expect(out.fontCss).not.toBeNull();
    expect(out.customCss).toBeNull();
    expect(out.faviconUrl).toBeNull();
  });
});
