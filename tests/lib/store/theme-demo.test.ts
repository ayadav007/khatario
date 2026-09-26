import { isThemeDemoSubdomain, themeDemoStore } from '@/lib/store/theme-demo';

describe('theme demo hosts', () => {
  it('recognises reserved preview slugs', () => {
    expect(isThemeDemoSubdomain('theme-noir')).toBe(true);
    expect(isThemeDemoSubdomain('myshop')).toBe(false);
  });

  it('builds a demo store without checkout', () => {
    const store = themeDemoStore('theme-khatario');
    expect(store?.is_demo).toBe(true);
    expect(store?.store_allow_cod).toBe(false);
  });
});
