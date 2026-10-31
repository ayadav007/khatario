import { getSectionSchema } from '@/lib/store/engine/registry';
import { presetTheme } from '@/lib/store/engine/presets';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';

describe('product grid category rail', () => {
  it('asks for categories only in the rail layout, and a failed lookup does not break the grid', () => {
    const schema = getSectionSchema('main-catalog');
    expect(schema?.data?.({ layout: 'rail' })).toEqual({ categories: true, categoriesOptional: true });
    expect(schema?.data?.({ layout: 'grid' })).toEqual({});
    expect(schema?.data?.({})).toEqual({});
  });

  it('is the Quick catalog page by default and survives sanitising', () => {
    const theme = sanitizeThemeData(presetTheme('quick', { businessName: 'Q', tagline: 'T' }));
    const catalog = theme.templates.catalog;
    expect(catalog.order).toHaveLength(1);
    const section = catalog.sections[catalog.order[0]];
    expect(section.type).toBe('main-catalog');
    expect(section.settings.layout).toBe('rail');
  });

  it('keeps the other presets on the plain grid', () => {
    const catalog = presetTheme('studio', { businessName: 'S', tagline: 'T' }).templates.catalog;
    const grid = Object.values(catalog.sections).find((s) => s.type === 'main-catalog');
    expect(grid?.settings.layout).toBeUndefined();
  });
});
