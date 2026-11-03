import { THEME_CATALOG, THEME_CATEGORIES, catalogTheme, catalogThemeByPreset } from '@/lib/store/engine/theme-catalog';
import { PRESET_CHOICES } from '@/lib/store/engine/library';

describe('THEME_CATALOG', () => {
  it('lists every preset exactly once, with unique slugs and known categories', () => {
    expect(THEME_CATALOG.map((t) => t.preset).sort()).toEqual(['bazaar', 'blank', 'drop', 'grocery', 'heritage', 'khatario', 'quick', 'studio']);
    expect(new Set(THEME_CATALOG.map((t) => t.slug)).size).toBe(THEME_CATALOG.length);
    for (const t of THEME_CATALOG) {
      expect(t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(t.categories.length).toBeGreaterThan(0);
      t.categories.forEach((c) => expect(THEME_CATEGORIES.map((x) => x.id)).toContain(c));
      t.palette.forEach((h) => expect(h).toMatch(/^#[0-9a-f]{6}$/i));
      expect(t.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.summary.length).toBeGreaterThan(0);
      expect(t.about.length).toBeGreaterThan(0);
      expect(t.features.length).toBeGreaterThanOrEqual(4);
      expect(t.features.length).toBeLessThanOrEqual(6);
    }
  });

  it('every theme but Blank has a demo store on demo-<slug>; one theme is featured', () => {
    for (const t of THEME_CATALOG) {
      if (t.preset === 'blank') expect(t.demo).toBeNull();
      else expect(t.demo?.subdomain).toBe(`demo-${t.slug}`);
    }
    expect(THEME_CATALOG.filter((t) => t.featured).map((t) => t.slug)).toEqual(['heritage-couture']);
  });

  it('only Heritage Couture, Drop Culture and Bazaar Bright are premium', () => {
    expect(THEME_CATALOG.filter((t) => t.premium).map((t) => t.preset)).toEqual(['heritage', 'drop', 'bazaar']);
  });

  it('lists Drop Culture as premium with its demo store', () => {
    const t = catalogTheme('drop-culture')!;
    expect(t).toMatchObject({
      preset: 'drop',
      name: 'Drop Culture',
      premium: true,
      categories: ['fashion'],
      palette: ['#0d0d0d', '#d4ff3a', '#f2f0ea'],
      canvas: '#0d0d0d',
      accent: '#d4ff3a',
      added: '2026-11-02',
      summary: 'Ink black and acid lime with loud caps headings, for streetwear and drop brands',
      demo: { subdomain: 'demo-drop-culture', brand: 'VOLTX', tagline: 'Drops every Friday', catalog: 'streetwear' },
    });
    expect(t.features).toEqual([
      'Drop countdown in the hero',
      'Size chips on product cards',
      '"Only N left" per size',
      'Sticky Add to bag on phones',
      'Delivery check by pincode',
      'Photos in a grid',
    ]);
    expect(catalogThemeByPreset('drop')).toBe(t);
  });

  it('lists Bazaar Bright as premium with its demo store', () => {
    const t = catalogTheme('bazaar-bright')!;
    expect(t).toMatchObject({
      preset: 'bazaar',
      name: 'Bazaar Bright',
      premium: true,
      categories: ['grocery'],
      palette: ['#e8590c', '#14213d', '#ffc300'],
      canvas: '#ffffff',
      accent: '#e8590c',
      added: '2026-11-03',
      summary: 'Saffron and navy supermarket with pack sizes on every card, buy again and store hours, for kirana shops',
      demo: { subdomain: 'demo-bazaar-bright', brand: 'Sharma General Store', tagline: 'Your neighbourhood kirana, now online', catalog: 'kirana' },
    });
    expect(t.features).toEqual([
      'Pack sizes and price per kg on cards',
      'Buy again for regular customers',
      'Open now / closed badge and store hours',
      'Order on WhatsApp from the cart',
      'Free-delivery bar in the cart',
      'Categories down the left',
    ]);
    expect(catalogThemeByPreset('bazaar')).toBe(t);
  });

  it('finds a theme by slug or preset', () => {
    expect(catalogTheme('heritage-couture')?.name).toBe('Heritage Couture');
    expect(catalogTheme('Heritage-Couture')).toBeNull();
    expect(catalogTheme('nope')).toBeNull();
    expect(catalogThemeByPreset('grocery').slug).toBe('premium-grocery');
  });

  it('PRESET_CHOICES come from the list', () => {
    expect(PRESET_CHOICES.map((c) => [c.preset, c.label, !!c.premium])).toEqual(THEME_CATALOG.map((t) => [t.preset, t.name, t.premium]));
    expect(PRESET_CHOICES.map((c) => c.description)).toEqual(THEME_CATALOG.map((t) => t.summary));
  });
});
