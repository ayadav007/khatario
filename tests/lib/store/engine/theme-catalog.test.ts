import { THEME_CATALOG, THEME_CATEGORIES, catalogTheme, catalogThemeByPreset } from '@/lib/store/engine/theme-catalog';
import { PRESET_CHOICES } from '@/lib/store/engine/library';

describe('THEME_CATALOG', () => {
  it('lists every preset exactly once, with unique slugs and known categories', () => {
    expect(THEME_CATALOG.map((t) => t.preset).sort()).toEqual(['blank', 'grocery', 'heritage', 'khatario', 'quick', 'studio']);
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

  it('only Heritage Couture is premium', () => {
    expect(THEME_CATALOG.filter((t) => t.premium).map((t) => t.preset)).toEqual(['heritage']);
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
