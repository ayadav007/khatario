import { presetTheme, type PresetContext } from '@/lib/store/engine/presets';
import { sanitizeThemeData, ID_RE } from '@/lib/store/engine/sanitize';
import { section, template } from '@/lib/store/engine/presets/shared';

// The product and catalog templates' section ids are fresh per call (newId), so determinism is checked on their sections in order.
function stable(p: ReturnType<typeof presetTheme>) {
  const list = (key: string) => p.templates[key].order.map((id) => p.templates[key].sections[id]);
  return { ...p, templates: { ...p.templates, product: list('product'), catalog: list('catalog') } };
}

const ctx: PresetContext = {
  businessName: 'Rose Mart',
  tagline: 'Fresh finds, fast delivery',
  accent: '#e11d48',
  logoUrl: 'https://example.com/logo.png',
  heroUrl: 'https://example.com/hero.jpg',
};

describe.each(['studio', 'blank'] as const)('%s preset', (name) => {
  it('survives sanitising unchanged', () => {
    for (const c of [ctx, { businessName: 'X', tagline: '' }]) {
      const p = presetTheme(name, c);
      expect(sanitizeThemeData(p)).toEqual(p);
    }
  });

  it('has valid unique ids', () => {
    const p = presetTheme(name, ctx);
    for (const t of [p.header_group, p.footer_group, ...Object.values(p.templates)]) {
      for (const id of t.order) expect(id).toMatch(ID_RE);
      expect(new Set(t.order).size).toBe(t.order.length);
      for (const s of Object.values(t.sections)) {
        for (const id of s.block_order) expect(id).toMatch(ID_RE);
        expect(new Set(s.block_order).size).toBe(s.block_order.length);
      }
    }
  });

  it('is deterministic', () => {
    expect(stable(presetTheme(name, ctx))).toEqual(stable(presetTheme(name, ctx)));
  });

  it('applies the accent to scheme 1', () => {
    expect(presetTheme(name, ctx).settings.color_schemes[0].accent).toBe('#e11d48');
  });
});

describe('studio home', () => {
  it('has the expected section order and content', () => {
    const p = presetTheme('studio', ctx);
    const types = p.templates.home.order.map((id) => p.templates.home.sections[id].type);
    expect(types).toEqual(['slideshow', 'category-grid', 'product-rail', 'multicolumn', 'featured-products', 'testimonials']);
    expect(p.templates.home.sections.slideshow.blocks['slide-1'].settings.heading).toBe('Welcome to Rose Mart');
    expect(p.templates.home.sections.multicolumn.block_order).toHaveLength(4);
    expect(p.header_group.order).toEqual(['announcement', 'header']);
  });
});

describe('studio look', () => {
  it('paints scheme 1 with Studio paper', () => {
    expect(presetTheme('studio', ctx).settings.color_schemes[0].background).toBe('#fbf8f3');
    expect(presetTheme('blank', ctx).settings.color_schemes[0].background).toBe('#fbf8f3');
  });
});

describe('template ids (D30)', () => {
  it('suffixes a repeated section type', () => {
    expect(template([section('product-rail', {}), section('product-rail', {})]).order).toEqual(['product-rail', 'product-rail-2']);
  });

  it('keeps every section under its id', () => {
    const t = template([section('product-rail', { heading: 'A' }), section('rich-text', {}), section('product-rail', { heading: 'B' })]);
    expect(t.order).toEqual(['product-rail', 'rich-text', 'product-rail-2']);
    expect(t.sections['product-rail-2'].settings.heading).toBe('B');
  });
});

describe('blank home', () => {
  it('is empty', () => {
    expect(presetTheme('blank', ctx).templates.home.order).toEqual([]);
  });
});

it('quick, grocery and khatario fall back to studio', () => {
  for (const k of ['quick', 'grocery', 'khatario'] as const) expect(stable(presetTheme(k, ctx))).toEqual(stable(presetTheme('studio', ctx)));
});
