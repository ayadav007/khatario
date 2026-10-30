import { SECTION_SCHEMAS, getSectionSchema, sectionsForTemplate } from '@/lib/store/engine/registry';
import { sanitizeSettingValue } from '@/lib/store/engine/settings';
import type { SettingSchema } from '@/lib/store/engine/schema-types';

function allSettingLists(): Array<{ where: string; settings: SettingSchema[] }> {
  const out: Array<{ where: string; settings: SettingSchema[] }> = [];
  for (const s of Object.values(SECTION_SCHEMAS)) {
    out.push({ where: s.type, settings: s.settings });
    for (const b of s.blocks ?? []) out.push({ where: `${s.type}/${b.type}`, settings: b.settings });
  }
  return out;
}

describe('section registry', () => {
  it('registers 15 section types keyed by their own type', () => {
    expect(Object.keys(SECTION_SCHEMAS)).toHaveLength(15);
    for (const [key, schema] of Object.entries(SECTION_SCHEMAS)) expect(schema.type).toBe(key);
  });

  it('has no duplicate setting ids within a schema or block', () => {
    for (const { where, settings } of allSettingLists()) {
      const ids = settings.map((s) => s.id);
      expect({ where, dupes: ids.filter((id, i) => ids.indexOf(id) !== i) }).toEqual({ where, dupes: [] });
    }
  });

  it('every default passes sanitizeSettingValue unchanged', () => {
    for (const { where, settings } of allSettingLists()) {
      for (const s of settings) {
        if (s.default === undefined) continue;
        expect({ where, id: s.id, value: sanitizeSettingValue(s, s.default) }).toEqual({ where, id: s.id, value: s.default });
      }
    }
  });

  it('gives non-group sections the common settings and group sections none', () => {
    const ids = (t: string) => getSectionSchema(t)!.settings.map((s) => s.id);
    expect(ids('slideshow')).toEqual(expect.arrayContaining(['spacing_top', 'spacing_bottom', 'full_width']));
    expect(ids('header')).not.toContain('spacing_top');
    expect(ids('announcement')).not.toContain('full_width');
  });

  it('lists sections per template', () => {
    expect(sectionsForTemplate('header').map((s) => s.type)).toEqual(['announcement', 'header']);
    expect(sectionsForTemplate('footer').map((s) => s.type)).toEqual(['footer']);
    const home = sectionsForTemplate('home').map((s) => s.type);
    expect(home).toContain('slideshow');
    expect(home).not.toContain('header');
  });

  it('returns null for unknown types, including prototype keys', () => {
    expect(getSectionSchema('nope')).toBeNull();
    expect(getSectionSchema('constructor')).toBeNull();
  });

  it('every schema has a preset', () => {
    for (const s of Object.values(SECTION_SCHEMAS)) expect(s.presets.length).toBeGreaterThan(0);
  });

  it('featured-products data returns only the keys that are set', () => {
    const data = getSectionSchema('featured-products')!.data!;
    expect(data({ source: 'bestsellers', limit: 8 })).toEqual({ products: { source: 'bestsellers', limit: 8 } });
    expect(data({})).toEqual({ products: { source: 'all', limit: 8 } });
    expect(data({ source: 'price_max', price_max: 500, limit: 4 })).toEqual({
      products: { source: 'price_max', priceMax: 500, limit: 4 },
    });
    expect(getSectionSchema('category-grid')!.data!({})).toEqual({ categories: true });
  });
});
