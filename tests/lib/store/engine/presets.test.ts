import { presetTheme, type PresetContext } from '@/lib/store/engine/presets';
import { sanitizeThemeData, ID_RE } from '@/lib/store/engine/sanitize';

// The product template's section ids are fresh per call (newId), so determinism is checked on its section types.
function stable(p: ReturnType<typeof presetTheme>) {
  const t = p.templates.product;
  return { ...p, templates: { ...p.templates, product: t.order.map((id) => t.sections[id]) } };
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

describe('blank home', () => {
  it('is empty', () => {
    expect(presetTheme('blank', ctx).templates.home.order).toEqual([]);
  });
});

it('quick, grocery and khatario fall back to studio', () => {
  for (const k of ['quick', 'grocery', 'khatario'] as const) expect(stable(presetTheme(k, ctx))).toEqual(stable(presetTheme('studio', ctx)));
});
