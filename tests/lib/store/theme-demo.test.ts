import { isThemeDemoSubdomain, themeDemoStore } from '@/lib/store/theme-demo';

describe('theme demo hosts', () => {
  it('recognises reserved preview slugs', () => {
    expect(isThemeDemoSubdomain('theme-noir')).toBe(true);
    expect(isThemeDemoSubdomain('theme-aether')).toBe(true);
    expect(isThemeDemoSubdomain('myshop')).toBe(false);
  });

  it('builds a demo store without checkout', () => {
    const store = themeDemoStore('theme-khatario');
    expect(store?.is_demo).toBe(true);
    expect(store?.store_allow_cod).toBe(false);
  });

  it('gives Aether a cinematic hero from the pack preset', () => {
    const store = themeDemoStore('theme-aether');
    const theme = store?.store_theme as { hero_slides?: Array<{ image_url?: string; title?: string }>; pack?: string };
    expect(theme?.pack).toBe('aether');
    expect(theme?.hero_slides?.[0]?.image_url).toMatch(/^https:\/\//);
    expect(theme?.hero_slides?.[0]?.title).toBe('The art of less.');
  });
});
