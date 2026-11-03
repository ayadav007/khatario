import { presetTheme, type PresetContext } from '@/lib/store/engine/presets';
import { sanitizeThemeData, ID_RE } from '@/lib/store/engine/sanitize';
import { section, template } from '@/lib/store/engine/presets/shared';
import { heritagePreset } from '@/lib/store/engine/presets/heritage';
import { getSectionSchema } from '@/lib/store/engine/registry';
import { dropPreset } from '@/lib/store/engine/presets/drop';
import { bazaarPreset } from '@/lib/store/engine/presets/bazaar';
import { defaultSettings } from '@/lib/store/engine/shared';
import { CARD_LINE_IDS } from '@/lib/store/engine/product-card';
import type { Section, ThemeData, ThemePreset } from '@/lib/store/engine/types';

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

describe('heritage preset', () => {
  const CTX = ctx;
  const home = () => heritagePreset(CTX).templates.home;

  it('passes the sanitiser unchanged and uses only registered sections and blocks', () => {
    const long = { businessName: 'A & B <Couture>', tagline: `Silk & <zari> ${'x'.repeat(600)}` };
    for (const c of [CTX, { businessName: 'X', tagline: '' }, long]) {
      const p = presetTheme('heritage', c);
      expect(sanitizeThemeData(p)).toEqual(p);
    }
    const t = heritagePreset(CTX);
    const types = [
      ...Object.values(t.header_group.sections),
      ...Object.values(t.footer_group.sections),
      ...Object.values(t.templates).flatMap((tpl) => Object.values(tpl.sections)),
    ].map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(['collage', 'shop-the-look', 'image-gallery', 'featured-products', 'testimonials', 'logo-list', 'newsletter']));
    for (const tpl of Object.values(t.templates)) {
      for (const s of Object.values(tpl.sections)) {
        const schema = getSectionSchema(s.type);
        expect(schema).not.toBeNull();
        for (const b of Object.values(s.blocks)) expect(schema!.blocks?.some((bs) => bs.type === b.type)).toBe(true);
      }
    }
  });

  it('has valid unique ids, is deterministic on the home page and stays under 64 KB', () => {
    const p = presetTheme('heritage', CTX);
    const ids = [...p.header_group.order, ...p.templates.home.order, ...p.footer_group.order];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ID_RE);
    expect(stable(presetTheme('heritage', CTX))).toEqual(stable(presetTheme('heritage', CTX)));
    expect(JSON.stringify(p).length).toBeLessThan(65536);
  });

  it('has the section order and switches from the spec', () => {
    const h = home();
    expect(h.order.map((id) => h.sections[id].type)).toEqual([
      'collage', 'multicolumn', 'promo-cards', 'featured-products', 'image-with-text', 'shop-the-look', 'testimonials', 'logo-list', 'image-gallery', 'newsletter',
    ]);
    expect(h.sections[h.order[3]].settings).toMatchObject({ columns: 4, show_badges: true, show_tagline: true, show_swatches: true, heading: 'Signature pieces', source: 'featured', limit: 8 });
    expect(heritagePreset(CTX).templates.product.sections['main-product'].block_order.filter((id) => id.startsWith('collapsible-tab'))).toHaveLength(3);
  });

  it('builds the collage from the business name and tagline with three sample tiles', () => {
    const c = home().sections.collage;
    expect(c.settings).toMatchObject({ layout: 'text-left', feature_tile: 'first', heading: 'Welcome to Rose Mart', text: '<p>Fresh finds, fast delivery</p>', button_text: 'Explore the collection', link: '/catalog', button_2_text: 'Our story', link_2: '/pages/our-story' });
    expect(c.block_order.map((id) => c.blocks[id].settings.image)).toEqual([1, 2, 3].map((n) => `/store-presets/heritage/hero-${n}.svg`));
    const bare = heritagePreset({ businessName: 'X', tagline: '' }).templates.home.sections.collage;
    expect(String(bare.settings.text)).toMatch(/^<p>.+<\/p>$/);
  });

  it('ships an Our story page template, so the three Our story links never dead-end', () => {
    const t = heritagePreset(CTX);
    const page = t.templates['page.our-story'];
    expect(page.title).toBe('Our story');
    expect(page.order.map((id) => page.sections[id].type)).toEqual(['image-with-text', 'rich-text']);
    expect(JSON.stringify(page.sections['image-with-text'].blocks)).toContain('Tell shoppers where your pieces are made and who makes them.');
    expect(sanitizeThemeData(t).templates['page.our-story']).toEqual(page);
    const links = JSON.stringify(t).match(/\/pages\/[a-z-]+/g) ?? [];
    expect(links).toHaveLength(3);
    for (const l of links) expect(l).toBe('/pages/our-story');
  });

  it('points every sample image at a file that ships', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const t = heritagePreset(CTX);
    const urls = JSON.stringify(t).match(/\/store-presets\/heritage\/[a-z0-9-]+\.svg/g) ?? [];
    expect(new Set(urls).size).toBe(9);
    for (const u of new Set(urls)) {
      const file = path.join(process.cwd(), 'public', u);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeLessThan(4096);
    }
  });

  it('has the crimson announcement, five-link menu, dark footer and four-column catalog', () => {
    const p = presetTheme('heritage', CTX);
    const a = p.header_group.sections.announcement;
    expect(a.color_scheme).toBe('scheme-3');
    expect(a.settings.text).toBe('Fresh finds, fast delivery');
    expect(presetTheme('heritage', { businessName: 'Rose Mart', tagline: '' }).header_group.sections.announcement.settings.text).toBe('Welcome to Rose Mart');
    expect(p.settings.menus.find((m) => m.id === 'main')!.items.map(({ label, link }) => ({ label, link }))).toEqual([
      { label: 'New in', link: '/catalog' },
      { label: 'Sarees', link: '/catalog' },
      { label: 'Bridal', link: '/catalog' },
      { label: 'Jewellery', link: '/catalog' },
      { label: 'Our story', link: '/pages/our-story' },
    ]);
    const f = p.footer_group.sections.footer;
    expect(f.color_scheme).toBe('scheme-4');
    expect(f.settings).toMatchObject({ show_payment_icons: true, about: 'Fresh finds, fast delivery' });
    const cat = Object.values(p.templates.catalog.sections).find((s) => s.type === 'main-catalog')!;
    expect(cat.settings.columns_desktop).toBe(4);
  });

  it('invents no reviews, press names or customer photos', () => {
    const h = home();
    const quotes = Object.values(h.sections.testimonials.blocks);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].settings).toMatchObject({ text: 'Tell shoppers what a customer said about you.', name: 'A customer' });
    expect(quotes[0].settings.photo).toBeUndefined();
    expect(h.sections['logo-list'].settings.heading).toBe('Add your press mentions');
    const logos = Object.values(h.sections['logo-list'].blocks).map((b) => b.settings);
    expect(logos.map((l) => l.name)).toEqual(['Your press mention', 'Another publication', 'A magazine']);
    for (const l of logos) expect(l.image).toBeUndefined();
    // No service claim the merchant never made, in any context.
    const json = JSON.stringify([heritagePreset(CTX), heritagePreset({ businessName: 'X', tagline: '' })]);
    for (const claim of ['Complimentary shipping', '15,000', 'Insured delivery', 'insured until', 'Certified materials', 'described as they are', 'on request', 'Personal concierge', 'As featured in', 'Made by hand, for keeps', 'Every piece documented', 'Private previews', 'Be first to see new pieces']) {
      expect(json).not.toContain(claim);
    }
    const cols = Object.values(h.sections.multicolumn.blocks).map((b) => b.settings.title);
    expect(cols).toEqual(['Delivery', 'Materials', 'Made to measure', 'Personal service']);
  });
});

const allSections = (t: ThemeData): Section[] => [
  ...Object.values(t.header_group.sections),
  ...Object.values(t.footer_group.sections),
  ...Object.values(t.templates).flatMap((tpl) => Object.values(tpl.sections)),
];

/** A section's settings with its schema defaults filled in, as the storefront reads them. */
function resolved(s: Section): Record<string, unknown> {
  return { ...defaultSettings(getSectionSchema(s.type)!.settings), ...s.settings };
}

/** Every block of `type` in `s`, with its schema defaults filled in. */
function blocksOf(s: Section, type: string): Record<string, unknown>[] {
  const schema = getSectionSchema(s.type)!.blocks?.find((b) => b.type === type);
  return s.block_order
    .map((id) => s.blocks[id])
    .filter((b) => b.type === type)
    .map((b) => ({ ...defaultSettings(schema!.settings), ...b.settings }));
}

const sectionTypes = (tpl: ThemeData['templates'][string]) => tpl.order.map((id) => tpl.sections[id].type);

describe('drop preset', () => {
  const CTX = ctx;
  const bare = { businessName: 'X', tagline: '' };
  const home = () => dropPreset(CTX).templates.home;

  it('drop uses only registry sections and unique ids', () => {
    const long = { businessName: `A & B <Drops> ${'x'.repeat(200)}`, tagline: `Heavy & <loud> ${'x'.repeat(600)}` };
    for (const c of [CTX, bare, { businessName: '', tagline: '' }, long]) {
      const p = presetTheme('drop', c);
      expect(sanitizeThemeData(p)).toEqual(p);
    }
    for (const s of allSections(presetTheme('drop', CTX))) {
      const schema = getSectionSchema(s.type);
      expect(schema).not.toBeNull();
      for (const b of Object.values(s.blocks)) expect(schema!.blocks?.some((bs) => bs.type === b.type)).toBe(true);
    }
    const p = presetTheme('drop', CTX);
    const ids = [...p.header_group.order, ...p.templates.home.order, ...p.footer_group.order];
    expect(new Set(ids).size).toBe(ids.length);
    for (const tpl of [p.header_group, p.footer_group, ...Object.values(p.templates)]) {
      for (const id of tpl.order) expect(id).toMatch(ID_RE);
      expect(new Set(tpl.order).size).toBe(tpl.order.length);
      for (const s of Object.values(tpl.sections)) {
        for (const id of s.block_order) expect(id).toMatch(ID_RE);
        expect(new Set(s.block_order).size).toBe(s.block_order.length);
      }
    }
    expect(stable(presetTheme('drop', CTX))).toEqual(stable(presetTheme('drop', CTX)));
    expect(JSON.stringify(p).length).toBeLessThan(65536);
  });

  it('drop turns on its card and product settings', () => {
    const p = sanitizeThemeData(presetTheme('drop', CTX));
    const card = p.settings.product_card;
    expect(card).toMatchObject({ design: 'dark', image_shape: 'portrait', image_hover: 'second', badge_shape: 'corner', button_style: 'icon', oos_look: 'label', oos_place: 'end' });
    expect(card.lines).toEqual([
      { id: 'name', on: true },
      { id: 'price', on: true },
      { id: 'sizes', on: true },
      { id: 'buttons', on: true },
      { id: 'brand', on: false },
      { id: 'unit', on: false },
      { id: 'rating', on: false },
      { id: 'tagline', on: false },
      { id: 'packs', on: false },
      { id: 'swatches', on: false },
    ]);
    expect(card.lines.map((l) => l.id).sort()).toEqual([...CARD_LINE_IDS].sort());
    const product = p.templates.product;
    expect(sectionTypes(product)).toEqual(['main-product', 'related-products', 'product-reviews', 'recently-viewed']);
    const main = product.sections['main-product'];
    expect(main.settings).toMatchObject({ thumbs: 'grid', sticky_info: true, sticky_buy_bar: true });
    expect(main.block_order.map((id) => main.blocks[id].type)).toEqual([
      'title', 'price', 'variant_picker', 'buy_buttons', 'description', 'delivery_check', 'collapsible_tab', 'collapsible_tab', 'collapsible_tab',
    ]);
    expect(blocksOf(main, 'variant_picker')).toEqual([expect.objectContaining({ low_stock_at: 3 })]);
    expect(blocksOf(main, 'collapsible_tab').map((b) => b.heading)).toEqual(['Details', 'Fabric and care', 'Exchange and returns']);
    expect(product.sections['related-products'].settings.heading).toBe('Complete the fit');
    const hero = p.templates.home.sections['image-banner'];
    expect(hero.color_scheme).toBe('scheme-6');
    const heroBlocks = hero.block_order.map((id) => hero.blocks[id]);
    expect(heroBlocks.map((b) => b.type)).toEqual(['eyebrow', 'heading', 'countdown', 'button']);
    expect(heroBlocks.filter((b) => b.type === 'countdown')).toHaveLength(1);
    expect(blocksOf(hero, 'countdown')[0].ends_at).toBe('');
  });

  it('has the home order, schemes and copy from the spec', () => {
    const p = presetTheme('drop', CTX);
    const h = p.templates.home;
    expect(sectionTypes(h)).toEqual([
      'image-banner', 'marquee', 'featured-products', 'category-grid', 'video', 'promo-cards', 'shop-the-look', 'countdown', 'image-gallery', 'testimonials', 'multicolumn', 'newsletter',
    ]);
    const s = h.sections;
    const hero = s['image-banner'];
    expect(hero.settings).toMatchObject({ layout: 'image-text', image: '/store-presets/drop/hero-1.svg' });
    const heroBlocks = hero.block_order.map((id) => hero.blocks[id].settings);
    expect(heroBlocks[0]).toMatchObject({ text: 'New drop' });
    expect(heroBlocks[1]).toMatchObject({ text: 'Rose Mart', size: 'xxl' });
    expect(heroBlocks[3]).toMatchObject({ label: 'Shop the drop', link: '/catalog' });
    const bareHero = dropPreset({ businessName: '  ', tagline: '' }).templates.home.sections['image-banner'];
    expect(bareHero.blocks['heading-1'].settings.text).toBe('Summer drop');
    expect(s.marquee.color_scheme).toBe('scheme-1');
    expect(s.marquee.block_order.map((id) => s.marquee.blocks[id].settings.text)).toEqual(['New drop', 'Heavyweight cotton', 'Ships in 24 hours', '7-day exchange']);
    expect(s['featured-products'].settings).toMatchObject({ heading: 'Just dropped', columns: 4, show_badges: true });
    const grid = s['category-grid'];
    expect(grid.block_order.map((id) => grid.blocks[id].settings.image)).toEqual([1, 2, 3].map((n) => `/store-presets/drop/category-${n}.svg`));
    expect(s.video.color_scheme).toBe('scheme-2');
    expect(resolved(s.video)).toMatchObject({ heading: 'On the streets', video_url: '' });
    const promos = s['promo-cards'];
    expect(promos.settings).toMatchObject({ style: 'overlay', columns: 2 });
    expect(promos.block_order.map((id) => promos.blocks[id].settings)).toEqual([
      expect.objectContaining({ eyebrow: 'Combo', heading: 'Any 3 @ ₹999', image: '/store-presets/drop/promo-1.svg' }),
      expect.objectContaining({ eyebrow: 'Last call', heading: 'Up to 40% off', image: '/store-presets/drop/promo-2.svg' }),
    ]);
    expect(s['shop-the-look'].settings).toMatchObject({ heading: 'Shop the fit', image: '/store-presets/drop/look-1.svg' });
    expect(s.countdown.color_scheme).toBe('scheme-4');
    expect(resolved(s.countdown)).toMatchObject({ heading: 'Next drop', ends_at: '', link: '', button_label: 'Get drop alerts' });
    expect(s['image-gallery'].settings).toMatchObject({ layout: 'grid', columns: 4 });
    expect(s['image-gallery'].block_order).toHaveLength(4);
    expect(s.testimonials.settings.show_summary).toBe(true);
    expect(s.multicolumn.block_order.map((id) => s.multicolumn.blocks[id].settings.title)).toEqual(['Cash on delivery', '7-day exchange', 'Ships in 24 hours']);
    expect(s.newsletter.color_scheme).toBe('scheme-3');
    expect(s.newsletter.settings.heading).toBe('Join the crew');
    expect(p.header_group.order).toEqual(['announcement', 'header']);
    const a = p.header_group.sections.announcement;
    expect(a.color_scheme).toBe('scheme-4');
    expect(a.settings).toMatchObject({ scrolling: true, text: 'Free shipping over ₹699 · COD available · Any 3 tees @ ₹999' });
    const f = p.footer_group.sections.footer;
    expect(f.color_scheme).toBe('scheme-1');
    expect(f.settings.show_payment_icons).toBe(true);
    expect(sectionTypes(p.templates.catalog)).toEqual(['catalog-banner', 'main-catalog']);
    const [banner, catalogGrid] = p.templates.catalog.order.map((id) => p.templates.catalog.sections[id]);
    expect(banner.color_scheme).toBe('scheme-6');
    expect(catalogGrid.settings).toMatchObject({ columns_desktop: 4, columns_mobile: 2 });
  });

  it('the Main catalog has one promo tile, after the fifth product', () => {
    const p = presetTheme('drop', CTX);
    const grid = Object.values(p.templates.catalog.sections).find((s) => s.type === 'main-catalog')!;
    expect(grid.block_order).toHaveLength(1);
    const tile = grid.blocks[grid.block_order[0]];
    expect(tile.type).toBe('promo');
    expect(tile.settings).toEqual({
      image: '/store-presets/drop/promo-1.svg',
      heading: 'Any 3 tees @ ₹999',
      text: 'Mix any tees',
      link: '/catalog',
      position: 5,
    });
    const kept = sanitizeThemeData(p).templates.catalog.sections;
    const keptGrid = Object.values(kept).find((s) => s.type === 'main-catalog')!;
    expect(keptGrid.block_order).toHaveLength(1);
    expect(keptGrid.blocks[keptGrid.block_order[0]].settings).toMatchObject({ heading: 'Any 3 tees @ ₹999', position: 5 });
    // A demo store's own picture replaces the sample one.
    const demo = presetTheme('drop', { ...CTX, images: { 'promo-1': '/theme-demos/streetwear/promo-denim.webp' } });
    const demoGrid = Object.values(demo.templates.catalog.sections).find((x) => x.type === 'main-catalog')!;
    expect(demoGrid.blocks[demoGrid.block_order[0]].settings.image).toBe('/theme-demos/streetwear/promo-denim.webp');
  });

  it('ignores the store accent', () => {
    expect(presetTheme('drop', CTX).settings.color_schemes).toEqual(presetTheme('drop', bare).settings.color_schemes);
    expect(presetTheme('drop', CTX).settings.color_schemes[0].accent).toBe('#d4ff3a');
  });

  it('points every sample image at a small file that ships', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const urls = new Set(JSON.stringify(dropPreset(CTX)).match(/\/store-presets\/drop\/[a-z0-9-]+\.svg/g) ?? []);
    expect([...urls].sort()).toEqual(
      ['hero-1', 'promo-1', 'promo-2', 'look-1', 'gallery-1', 'gallery-2', 'gallery-3', 'gallery-4', 'category-1', 'category-2', 'category-3']
        .map((n) => `/store-presets/drop/${n}.svg`)
        .sort(),
    );
    for (const u of urls) {
      const file = path.join(process.cwd(), 'public', u);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeLessThan(4096);
    }
  });

  it('invents no reviews or press', () => {
    const quotes = Object.values(home().sections.testimonials.blocks);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].settings).toMatchObject({ text: 'Tell shoppers what a customer said about you.', name: 'A customer' });
    expect(quotes[0].settings.photo).toBeUndefined();
    expect(allSections(dropPreset(CTX)).map((s) => s.type)).not.toContain('logo-list');
  });
});

describe('existing presets keep the new pieces off', () => {
  const EXISTING: ThemePreset[] = ['studio', 'quick', 'grocery', 'khatario', 'blank', 'heritage'];

  it.each(EXISTING)('%s', (name) => {
    const p = sanitizeThemeData(presetTheme(name, ctx));
    expect(p.settings.product_card.lines.find((l) => l.id === 'sizes')).toEqual({ id: 'sizes', on: false });
    const sections = allSections(p);
    for (const s of sections.filter((x) => x.type === 'image-banner' || x.type === 'slideshow')) {
      expect(Object.values(s.blocks).some((b) => b.type === 'countdown')).toBe(false);
    }
    const mains = sections.filter((x) => x.type === 'main-product');
    expect(mains.length).toBeGreaterThan(0);
    for (const m of mains) {
      expect(Object.values(m.blocks).some((b) => b.type === 'delivery_check')).toBe(false);
      for (const v of blocksOf(m, 'variant_picker')) expect(v.low_stock_at).toBe(0);
      // `thumbs` was `side` (the default, never set by a preset) before the photo grid existed.
      expect(resolved(m)).toMatchObject({ sticky_buy_bar: false, thumbs: 'side' });
    }
  });
});

describe('existing presets keep the Bazaar pieces off', () => {
  const EXISTING: ThemePreset[] = ['studio', 'quick', 'grocery', 'khatario', 'blank', 'heritage', 'drop'];

  it.each(EXISTING)('%s', (name) => {
    const p = sanitizeThemeData(presetTheme(name, ctx));
    const card = p.settings.product_card;
    expect(card.lines.find((l) => l.id === 'packs')).toEqual({ id: 'packs', on: false });
    expect(card.unit_price).toBe(false);
    expect(card.discount_badge).toBe('percent');
    expect(p.settings).toMatchObject({
      cart_free_ship_bar: false,
      cart_suggestions: false,
      cart_suggestions_heading: 'Pair it with',
      cart_whatsapp_order: false,
    });
    const sections = allSections(p);
    const headers = sections.filter((x) => x.type === 'header');
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) expect(resolved(h).show_open_status).toBe(false);
    const mains = sections.filter((x) => x.type === 'main-product');
    expect(mains.length).toBeGreaterThan(0);
    for (const m of mains) for (const v of blocksOf(m, 'variant_picker')) expect(v.style).toBe('buttons');
    expect(sections.map((s) => s.type)).not.toContain('buy-again');
    expect(sections.map((s) => s.type)).not.toContain('store-info');
  });
});

describe('bazaar preset', () => {
  const bare = { businessName: 'X', tagline: '' };

  it('bazaar uses only registry sections and unique ids', () => {
    for (const s of allSections(presetTheme('bazaar', ctx))) {
      const schema = getSectionSchema(s.type);
      expect(schema).not.toBeNull();
      for (const b of Object.values(s.blocks)) expect(schema!.blocks?.some((bs) => bs.type === b.type)).toBe(true);
    }
    const p = presetTheme('bazaar', ctx);
    const ids = [...p.header_group.order, ...p.templates.home.order, ...p.footer_group.order];
    expect(new Set(ids).size).toBe(ids.length);
    for (const tpl of [p.header_group, p.footer_group, ...Object.values(p.templates)]) {
      for (const id of tpl.order) expect(id).toMatch(ID_RE);
      expect(new Set(tpl.order).size).toBe(tpl.order.length);
      for (const s of Object.values(tpl.sections)) {
        for (const id of s.block_order) expect(id).toMatch(ID_RE);
        expect(new Set(s.block_order).size).toBe(s.block_order.length);
      }
    }
    expect(stable(presetTheme('bazaar', ctx))).toEqual(stable(presetTheme('bazaar', ctx)));
    expect(JSON.stringify(p).length).toBeLessThan(65536);
  });

  it('sanitizeThemeData(bazaar) equals bazaar', () => {
    const long = { businessName: `Sharma & Sons <Kirana> ${'x'.repeat(200)}`, tagline: `Atta & <dal> ${'x'.repeat(600)}` };
    for (const c of [ctx, bare, { businessName: '', tagline: '' }, long]) {
      const p = presetTheme('bazaar', c);
      expect(sanitizeThemeData(p)).toEqual(p);
    }
  });

  it('bazaar ignores the store accent', () => {
    expect(presetTheme('bazaar', ctx).settings.color_schemes).toEqual(presetTheme('bazaar', bare).settings.color_schemes);
    expect(presetTheme('bazaar', ctx).settings.color_schemes[0].accent).toBe('#e8590c');
  });

  it('bazaar turns on its pieces', () => {
    const p = sanitizeThemeData(presetTheme('bazaar', ctx));
    const card = p.settings.product_card;
    expect(card).toMatchObject({
      design: 'grocery',
      image_shape: 'square',
      image_bg: '#fff6ea',
      radius: 18,
      border: 1,
      badge_shape: 'pill',
      discount_badge: 'rupees',
      unit_price: true,
      button_style: 'full',
      after_add: 'stepper',
      oos_look: 'faded',
      oos_place: 'end',
    });
    expect(card.lines).toEqual([
      { id: 'name', on: true },
      { id: 'packs', on: true },
      { id: 'price', on: true },
      { id: 'buttons', on: true },
      { id: 'brand', on: false },
      { id: 'unit', on: false },
      { id: 'rating', on: false },
      { id: 'tagline', on: false },
      { id: 'sizes', on: false },
      { id: 'swatches', on: false },
    ]);
    expect(card.lines.map((l) => l.id).sort()).toEqual([...CARD_LINE_IDS].sort());
    expect(p.settings).toMatchObject({
      cart_free_ship_bar: true,
      cart_suggestions: true,
      cart_suggestions_heading: 'You may also need',
      cart_whatsapp_order: true,
    });
    const header = p.header_group.sections.header;
    expect(header.color_scheme).toBe('scheme-3');
    expect(header.settings).toMatchObject({ show_open_status: true, show_category_chips: true, search_placeholder: 'Search atta, dal, milk, masala…' });
    const main = p.templates.product.sections[p.templates.product.order[0]];
    expect(main.type).toBe('main-product');
    expect(blocksOf(main, 'variant_picker')).toEqual([expect.objectContaining({ style: 'tiles', low_stock_at: 3 })]);
    expect(sectionTypes(p.templates.home)).toEqual(expect.arrayContaining(['buy-again', 'store-info']));
    const grid = Object.values(p.templates.catalog.sections).find((s) => s.type === 'main-catalog')!;
    expect(grid.settings.layout).toBe('rail');
  });

  it('has the pages from the spec', () => {
    const p = presetTheme('bazaar', ctx);
    expect(p.header_group.order).toEqual(['announcement', 'header']);
    const a = p.header_group.sections.announcement;
    expect(a.color_scheme).toBe('scheme-4');
    expect(a.settings.text).toBe('Free delivery above ₹299 · Cash, UPI or khata on delivery');
    expect(p.header_group.sections.header.settings.logo_url).toBe('https://example.com/logo.png');

    const h = p.templates.home;
    expect(sectionTypes(h)).toEqual([
      'category-grid', 'image-banner', 'buy-again', 'featured-products', 'promo-cards', 'category-shelves', 'multicolumn', 'store-info', 'newsletter',
    ]);
    const s = h.sections;
    const cats = s['category-grid'];
    expect(cats.settings).toMatchObject({ heading: 'Shop by category', style: 'tiles', columns: 8 });
    expect(cats.block_order.map((id) => cats.blocks[id].settings.image)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `/store-presets/bazaar/category-${n}.svg`));

    const hero = s['image-banner'];
    expect(hero.color_scheme).toBe('scheme-4');
    expect(hero.settings).toMatchObject({ layout: 'over', image: '/store-presets/bazaar/hero-1.svg' });
    const heroBlocks = hero.block_order.map((id) => hero.blocks[id]);
    expect(heroBlocks.map((b) => b.type)).toEqual(['eyebrow', 'heading', 'countdown', 'button']);
    expect(heroBlocks[0].settings).toMatchObject({ text: 'Maha Bachat Week' });
    expect(heroBlocks[1].settings).toMatchObject({ text: 'Up to 40% off on staples', size: 'xl' });
    expect(heroBlocks[2].settings.ends_at).toBe('');
    expect(heroBlocks[3].settings).toMatchObject({ label: 'Shop deals', link: '/catalog' });

    expect(s['featured-products'].settings).toMatchObject({ heading: "Today's deals", source: 'discounted', columns: 5, mobile_columns: '2' });
    const promos = s['promo-cards'];
    expect(promos.block_order.map((id) => promos.blocks[id].settings)).toEqual([
      expect.objectContaining({ heading: 'Fresh every morning', text: 'Sabzi from the mandi', image: '/store-presets/bazaar/promo-1.svg' }),
      expect.objectContaining({ heading: 'Monthly ration pack', text: 'Save on atta, rice and dal', image: '/store-presets/bazaar/promo-2.svg' }),
    ]);
    expect(s['category-shelves'].settings.max_categories).toBe(2);
    expect(s.multicolumn.color_scheme).toBe('scheme-2');
    expect(s.multicolumn.block_order.map((id) => s.multicolumn.blocks[id].settings.title)).toEqual([
      'Cash, UPI or khata on delivery', 'Fresh or we replace it', 'Free delivery above ₹299', 'Order on call or WhatsApp',
    ]);
    expect(s.newsletter.color_scheme).toBe('scheme-2');
    expect(s.newsletter.settings.heading).toBe('Get offers first');

    const grid = Object.values(p.templates.catalog.sections).find((x) => x.type === 'main-catalog')!;
    expect(grid.settings).toMatchObject({ layout: 'rail', columns_desktop: 4, columns_mobile: 2, show_filters: true, show_sort: true });
    expect(grid.block_order).toHaveLength(1);
    expect(grid.blocks[grid.block_order[0]]).toEqual({
      type: 'promo',
      settings: { image: '/store-presets/bazaar/catalog-promo.svg', heading: 'Monthly ration', text: 'Atta + rice + dal, save ₹250', link: '/catalog', position: 5 },
    });

    const product = p.templates.product;
    expect(sectionTypes(product)).toEqual(['main-product', 'related-products', 'recently-viewed']);
    const main = product.sections['main-product'];
    expect(main.settings).toMatchObject({ thumbs: 'bottom', sticky_info: true, sticky_buy_bar: true });
    expect(main.block_order.map((id) => main.blocks[id].type)).toEqual([
      'title', 'price', 'variant_picker', 'buy_buttons', 'delivery_check', 'description', 'collapsible_tab', 'collapsible_tab', 'collapsible_tab',
    ]);
    expect(blocksOf(main, 'collapsible_tab').map((b) => b.heading)).toEqual(['Product details', 'Storage and shelf life', 'Returns']);
    expect(product.sections['related-products'].settings.heading).toBe('You may also need');

    const f = p.footer_group.sections.footer;
    expect(f.color_scheme).toBe('scheme-4');
    expect(f.settings).toMatchObject({ show_payment_icons: true, about: 'Fresh finds, fast delivery' });
    expect(presetTheme('bazaar', bare).footer_group.sections.footer.settings.about).toBeUndefined();
  });

  it('a demo store swaps the sample pictures for its own', () => {
    const demo = presetTheme('bazaar', { ...ctx, images: { 'hero-1': '/theme-demos/kirana/hero.webp', 'catalog-promo': '/theme-demos/kirana/promo.webp' } });
    expect(demo.templates.home.sections['image-banner'].settings.image).toBe('/theme-demos/kirana/hero.webp');
    const grid = Object.values(demo.templates.catalog.sections).find((x) => x.type === 'main-catalog')!;
    expect(grid.blocks[grid.block_order[0]].settings.image).toBe('/theme-demos/kirana/promo.webp');
  });

  it('points every sample image at a small file that ships', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const urls = new Set(JSON.stringify(bazaarPreset(ctx)).match(/\/store-presets\/bazaar\/[a-z0-9-]+\.svg/g) ?? []);
    expect([...urls].sort()).toEqual(
      ['hero-1', 'promo-1', 'promo-2', 'catalog-promo', ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `category-${n}`)]
        .map((n) => `/store-presets/bazaar/${n}.svg`)
        .sort(),
    );
    for (const u of urls) {
      const file = path.join(process.cwd(), 'public', u);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeLessThan(4096);
    }
  });

  it('invents no reviews or press', () => {
    const types = allSections(bazaarPreset(ctx)).map((s) => s.type);
    expect(types).not.toContain('testimonials');
    expect(types).not.toContain('product-reviews');
    expect(types).not.toContain('logo-list');
  });
});
