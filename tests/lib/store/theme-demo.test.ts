import { isThemeDemoSubdomain, themeDemoStore } from '@/lib/store/theme-demo';

describe('theme demo hosts', () => {
  it('recognises the three theme preview slugs only', () => {
    expect(isThemeDemoSubdomain('theme-studio')).toBe(true);
    expect(isThemeDemoSubdomain('theme-grocery')).toBe(true);
    expect(isThemeDemoSubdomain('theme-khatario')).toBe(true);
    expect(isThemeDemoSubdomain('theme-aether')).toBe(false);
    expect(isThemeDemoSubdomain('myshop')).toBe(false);
  });

  it('builds a demo store without checkout', () => {
    const store = themeDemoStore('theme-khatario');
    expect(store?.is_demo).toBe(true);
    expect(store?.store_allow_cod).toBe(false);
  });

  it('serves the Studio pack on the Studio demo', () => {
    const theme = themeDemoStore('theme-studio')?.store_theme as { pack?: string };
    expect(theme?.pack).toBe('studio');
  });
});
