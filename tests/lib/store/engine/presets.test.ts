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

const ALL = ['studio', 'blank', 'quick', 'grocery', 'khatario'] as const;

describe.each(ALL)('%s preset', (name) => {
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

  it('has ids unique across header, home and footer', () => {
    const p = presetTheme(name, ctx);
    const ids = [...p.header_group.order, ...p.templates.home.order, ...p.footer_group.order];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a default product and catalog template', () => {
    const p = presetTheme(name, ctx);
    expect(p.templates.product.order.length).toBeGreaterThan(0);
    expect(p.templates.catalog.order.length).toBeGreaterThan(0);
  });

  it('is under 64 KB serialised', () => {
    expect(JSON.stringify(presetTheme(name, ctx)).length).toBeLessThan(65536);
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

const homeTypes = (p: ReturnType<typeof presetTheme>) => p.templates.home.order.map((id) => p.templates.home.sections[id].type);

describe('quick preset', () => {
  const p = presetTheme('quick', ctx);

  it('turns the phone kit on', () => {
    expect(p.settings.phone_kit).toBe(true);
  });

  it('has the Quick home order', () => {
    expect(p.templates.home.order).toEqual(['slideshow', 'category-grid', 'product-rail', 'product-rail-2', 'multicolumn', 'featured-products']);
    expect(homeTypes(p)).toEqual(['slideshow', 'category-grid', 'product-rail', 'product-rail', 'multicolumn', 'featured-products']);
    const s = p.templates.home.sections;
    expect(s.slideshow.settings).toMatchObject({ layout: 'full', height: 'small' });
    expect(s.slideshow.block_order).toHaveLength(1);
    expect(s['category-grid'].settings).toMatchObject({ columns: 8, heading: 'Shop by category' });
    expect(s['product-rail'].settings).toMatchObject({ heading: 'Bestsellers', source: 'bestsellers', limit: 12 });
    expect(s['product-rail-2'].settings).toMatchObject({ heading: 'Top deals', source: 'discounted', limit: 12 });
    expect(s.multicolumn.block_order).toHaveLength(4);
    expect(s['featured-products'].settings).toMatchObject({ heading: 'Handpicked for you', source: 'all', limit: 24, columns: 6 });
  });

  it('has a header with the delivery ETA and a highlighted Offers link, and no announcement', () => {
    expect(p.header_group.order).toEqual(['header']);
    const h = p.header_group.sections.header;
    expect(h.settings).toMatchObject({ delivery_eta: 'in 30 minutes', search_placeholder: 'Search for products…' });
    expect(h.settings.menu).toBe('main');
    expect(p.settings.menus.find((m) => m.id === 'main')!.items.map(({ label, link, highlight }) => ({ label, link, highlight }))).toEqual([
      { label: 'All Products', link: '/catalog', highlight: undefined },
      { label: 'Offers', link: '/catalog?disc=10', highlight: true },
    ]);
  });

  it('uses the Studio footer', () => {
    expect(p.footer_group).toEqual(presetTheme('studio', ctx).footer_group);
  });
});

describe('grocery preset', () => {
  const p = presetTheme('grocery', ctx);

  it('has a scrolling deep-green announcement and category chips', () => {
    expect(p.header_group.order).toEqual(['announcement', 'header']);
    const a = p.header_group.sections.announcement;
    expect(a.settings).toMatchObject({ scrolling: true, text: 'Fresh finds, fast delivery' });
    expect(a.color_scheme).toBe('scheme-6');
    expect(p.header_group.sections.header.settings).toMatchObject({
      show_category_chips: true,
      search_placeholder: 'Search for products, brands and categories…',
    });
  });

  it('falls back to default copy without a tagline', () => {
    const q = presetTheme('grocery', { businessName: 'X', tagline: '' });
    expect(q.header_group.sections.announcement.settings.text).toBe('Fresh groceries delivered to your door');
    const slide = q.templates.home.sections.slideshow;
    expect(slide.blocks[slide.block_order[0]].settings.heading).toBe('Fresh groceries & daily essentials');
  });

  it('has the Grocery home order', () => {
    expect(homeTypes(p)).toEqual(['slideshow', 'category-grid', 'product-rail', 'promo-cards', 'featured-products']);
    const s = p.templates.home.sections;
    expect(s.slideshow.settings).toMatchObject({ layout: 'image-text', height: 'large', speed: 7 });
    expect(s.slideshow.blocks[s.slideshow.block_order[0]].settings).toMatchObject({
      heading: 'Fresh finds, fast delivery',
      description: 'Fresh produce and everyday essentials, delivered to your doorstep.',
      button_text: 'Shop groceries',
      link: '#catalog',
    });
    expect(s['category-grid'].settings).toMatchObject({ style: 'emoji', columns: 6, heading: 'Shop by category', eyebrow: '' });
    expect(s['product-rail'].settings).toMatchObject({ heading: "Today's deals", source: 'discounted', limit: 8 });
    expect(s['promo-cards'].settings).toMatchObject({ style: 'split' });
    const cards = s['promo-cards'];
    expect(cards.block_order.map((id) => cards.blocks[id].settings.link)).toEqual(['/catalog?disc=10', '#catalog']);
    expect(s['featured-products'].settings).toMatchObject({ heading: 'All products', source: 'all', limit: 24, columns: 5 });
  });

  it('puts the footer on scheme 6', () => {
    expect(p.footer_group.order).toEqual(['footer']);
    expect(p.footer_group.sections.footer.color_scheme).toBe('scheme-6');
  });
});

describe('khatario preset', () => {
  const p = presetTheme('khatario', ctx);

  it('puts the announcement and header on scheme 4', () => {
    expect(p.header_group.order).toEqual(['announcement', 'header']);
    expect(p.header_group.sections.announcement.color_scheme).toBe('scheme-4');
    expect(p.header_group.sections.announcement.settings.text).toBe('Fresh finds, fast delivery');
    expect(p.header_group.sections.header.color_scheme).toBe('scheme-4');
    expect(p.header_group.sections.header.settings.search_placeholder).toBe('Search for items…');
  });

  it('has the Khatario home order, with the tagline line after the hero', () => {
    expect(homeTypes(p)).toEqual(['slideshow', 'rich-text', 'category-grid', 'product-rail', 'featured-products']);
    expect(p.templates.home.sections['rich-text']).toMatchObject({ label: 'Tagline' });
    const tagline = p.templates.home.sections['rich-text'];
    expect(tagline.block_order).toEqual(['text-1']);
    expect(tagline.blocks['text-1']).toEqual({ type: 'text', settings: { content: '<p>Fresh finds, fast delivery</p>' } });
    expect(homeTypes(presetTheme('khatario', { ...ctx, tagline: '  ' }))).toEqual([
      'slideshow',
      'category-grid',
      'product-rail',
      'featured-products',
    ]);
    const s = p.templates.home.sections;
    expect(s.slideshow.settings).toMatchObject({ layout: 'full', height: 'medium' });
    expect(s.slideshow.blocks[s.slideshow.block_order[0]].settings).toMatchObject({ button_text: 'Order now', link: '#catalog' });
    expect(s['category-grid'].settings).toMatchObject({ style: 'tiles', heading: '' });
    expect(s['product-rail'].settings).toMatchObject({ heading: 'Popular products', source: 'all', limit: 6 });
    expect(s['featured-products'].settings).toMatchObject({ heading: 'All products', source: 'all', limit: 24, columns: 4 });
  });
});
