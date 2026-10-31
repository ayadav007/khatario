import { migrateStoreTheme, type MigrationResult } from '@/lib/store/engine/migrate';
import { migratePackHome } from '@/lib/store/engine/migrate-packs';
import { presetTheme } from '@/lib/store/engine/presets';
import { sanitizeThemeData, themeTooLarge, ID_RE } from '@/lib/store/engine/sanitize';
import { applyStorePreset, sanitizeStoreTheme } from '@/lib/store/store-theme';
import type { Section, Template } from '@/lib/store/engine/types';
import {
  CAT_FRUITS,
  PACK_FIXTURES,
  ctx,
  groceryAll,
  groceryDefault,
  khatarioAll,
  khatarioBare,
  khatarioDefault,
} from './fixtures/store-themes';

const types = (t: Template) => t.order.map((id) => t.sections[id].type);
const home = (r: MigrationResult) => r.data.templates.home;
const sections = (t: Template) => t.order.map((id) => t.sections[id]);
const ofType = (t: Template, type: string): Section[] => sections(t).filter((s) => s.type === type);
const first = (t: Template, type: string): Section => {
  const s = ofType(t, type)[0];
  if (!s) throw new Error(`no ${type}`);
  return s;
};
const blocks = (s: Section, type: string) => s.block_order.map((id) => s.blocks[id]).filter((b) => b.type === type);
const noTagline = { ...ctx, tagline: '' };
/** The top items of the migrated theme's `main` menu (the old header links). */
const mainItems = (r: MigrationResult) => r.data.settings.menus.find((m) => m.id === 'main')?.items ?? [];

describe.each(Object.entries(PACK_FIXTURES))('%s fixture invariants', (_name, raw) => {
  it.each([
    ['with a tagline', ctx],
    ['without a tagline', noTagline],
  ])('sanitises to itself, fits, is pure and has unique valid ids (%s)', (_label, c) => {
    const r = migrateStoreTheme(raw, c);
    expect(sanitizeThemeData(r.data)).toEqual(r.data);
    expect(themeTooLarge(r.data)).toBe(false);
    expect(migrateStoreTheme(raw, c)).toEqual(r);
    const groups = [r.data.header_group, r.data.footer_group];
    const groupIds = groups.flatMap((g) => g.order);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    for (const t of [...groups, ...Object.values(r.data.templates)]) {
      for (const id of t.order) {
        expect(id).toMatch(ID_RE);
        if (!groups.includes(t)) expect(groupIds).not.toContain(id);
        for (const b of t.sections[id].block_order) expect(b).toMatch(ID_RE);
      }
      expect(new Set(t.order).size).toBe(t.order.length);
      expect(t.order.length).toBeLessThanOrEqual(25);
    }
    expect(r.warnings).not.toContain('pack home not migrated yet');
  });
});

describe('groceryAll', () => {
  const r = migrateStoreTheme(groceryAll, ctx);

  it('is the Premium Grocery preset', () => {
    expect(r.preset).toBe('grocery');
    expect(r.name).toBe('Premium Grocery');
  });

  it('keeps the order the old Grocery home shows', () => {
    expect(types(home(r))).toEqual([
      'slideshow',
      'category-grid',
      'product-rail',
      'promo-cards',
      'featured-products',
      'product-rail',
      'product-rail',
      'category-shelves',
      'featured-products',
      'testimonials',
      'rich-text',
    ]);
  });

  it('maps hero, deals, featured and all products with the old headings', () => {
    const h = home(r);
    expect(first(h, 'slideshow').settings).toMatchObject({ layout: 'image-text', height: 'large', speed: 7 });
    expect(ofType(h, 'product-rail')[0].settings).toMatchObject({ heading: "Today's deals", source: 'discounted', limit: 8 });
    const [featured, all] = ofType(h, 'featured-products');
    expect(featured.settings).toMatchObject({ heading: 'Featured picks', eyebrow: 'Chosen by the store', source: 'featured', limit: 6, columns: 3 });
    expect(all.settings).toMatchObject({ heading: 'All products', source: 'all', limit: 24, columns: 5 });
    expect(first(h, 'category-shelves').settings).toMatchObject({ max_categories: 12, per_shelf: 8 });
    expect(first(h, 'testimonials').settings.heading).toBe('Loved by our customers');
    expect(blocks(first(h, 'testimonials'), 'quote')).toHaveLength(3);
    const story = first(h, 'rich-text');
    expect(story.blocks['heading-1'].settings.text).toBe('Our story');
    expect(story.blocks['text-1'].settings.content).toBe('<p>Three generations of grocers.</p><p>Still on Main Road.</p>');
  });

  it('turns the hero into one fallback slide when there are no slides', () => {
    const slides = blocks(first(home(r), 'slideshow'), 'slide');
    expect(slides).toHaveLength(1);
    expect(slides[0].settings).toMatchObject({
      image: ctx.heroUrl,
      heading: ctx.tagline,
      description: 'Fresh produce and everyday essentials, delivered to your doorstep.',
      button_text: 'Shop groceries',
      link: '#catalog',
    });
  });

  it('shows the two overlay bands as split promo cards', () => {
    const promo = first(home(r), 'promo-cards');
    expect(promo.settings.style).toBe('split');
    expect(blocks(promo, 'card').map((b) => b.settings)).toEqual([
      { eyebrow: 'Special offer', heading: 'Mango season', text: '', button_text: 'Grab mangoes', image: 'https://cdn.example.com/band1.jpg', link: '#catalog' },
      { eyebrow: 'Featured', heading: 'Dairy fresh', text: '', button_text: 'Shop now', image: 'https://cdn.example.com/band2.jpg', link: '#catalog' },
    ]);
  });

  it('makes one rail per shelf, the switched-off shelf disabled', () => {
    const [, hot, under] = ofType(home(r), 'product-rail');
    expect(hot.settings).toMatchObject({ heading: 'Hot deals', source: 'discounted' });
    expect(hot.disabled).toBeUndefined();
    expect(under.settings).toMatchObject({ heading: 'Under ₹99', source: 'price_max', price_max: 99 });
    expect(under.disabled).toBe(true);
  });

  it('has one category image block, on the emoji grid', () => {
    const grid = first(home(r), 'category-grid');
    expect(grid.settings).toMatchObject({ style: 'emoji', columns: 6, heading: 'Shop by category' });
    expect(blocks(grid, 'category_image').map((b) => b.settings)).toEqual([{ category: CAT_FRUITS, image: 'https://cdn.example.com/fruits.jpg' }]);
  });

  it('uses the "Announcement" scheme 5 with the fixture colours on a scrolling bar', () => {
    const ann = r.data.header_group.sections.announcement;
    expect(ann.settings).toMatchObject({ text: groceryAll.announcement, scrolling: true });
    expect(ann.disabled).toBeUndefined();
    expect(ann.color_scheme).toBe('scheme-5');
    const s5 = r.data.settings.color_schemes[4];
    expect(s5).toMatchObject({ id: 'scheme-5', name: 'Announcement', background: '#112233', text: '#ffeeaa' });
  });

  it('header shows category chips and All Products plus Offers; footer uses scheme 6', () => {
    const header = r.data.header_group.sections.header;
    expect(header.settings.show_category_chips).toBe(true);
    expect(header.settings.menu).toBe('main');
    expect(mainItems(r).map((i) => [i.label, i.link])).toEqual([
      ['All Products', '/catalog'],
      ['Offers', '/catalog?disc=10'],
    ]);
    expect(header.color_scheme).toBeUndefined();
    expect(r.data.footer_group.sections.footer.color_scheme).toBe('scheme-6');
  });

  it('warns once that the hero stats line is not shown', () => {
    expect(r.warnings.filter((w) => w === 'Grocery hero stats line is not shown')).toHaveLength(1);
  });
});

describe('groceryDefault', () => {
  const r = migrateStoreTheme(groceryDefault, ctx);

  it('reproduces the Grocery preset home order', () => {
    const preset = presetTheme('grocery', { businessName: ctx.businessName, tagline: ctx.tagline, heroUrl: ctx.heroUrl });
    expect(types(home(r))).toEqual(['slideshow', 'category-grid', 'product-rail', 'promo-cards', 'featured-products']);
    expect(types(home(r))).toEqual(types(preset.templates.home));
  });

  it('uses the very cards of the Grocery preset (one shared copy)', () => {
    const preset = presetTheme('grocery', { businessName: ctx.businessName, tagline: ctx.tagline, heroUrl: ctx.heroUrl });
    const cardsOf = (t: Template) => blocks(first(t, 'promo-cards'), 'card').map((b) => b.settings);
    expect(cardsOf(home(r))).toEqual(cardsOf(preset.templates.home));
  });

  it('shows the two default Grocery cards when there are no bands', () => {
    const cards = blocks(first(home(r), 'promo-cards'), 'card').map((b) => b.settings);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ eyebrow: "Today's offers", heading: 'Everyday essentials, honest prices', link: '/catalog?disc=10' });
    expect(cards[1]).toMatchObject({ eyebrow: ctx.businessName, heading: ctx.tagline, link: '#catalog' });
  });

  it('scrolls the tagline in the scheme 6 announcement; no custom colours', () => {
    const ann = r.data.header_group.sections.announcement;
    expect(ann.settings).toMatchObject({ text: ctx.tagline, scrolling: true });
    expect(ann.color_scheme).toBe('scheme-6');
    expect(r.data.settings.color_schemes[4].name).not.toBe('Announcement');
    const header = r.data.header_group.sections.header;
    expect(header.settings.show_category_chips).toBe(true);
  });

  it('switches the announcement off when there is no text', () => {
    const quiet = migrateStoreTheme({ ...groceryDefault, announcement_auto: false }, ctx);
    expect(quiet.data.header_group.sections.announcement.disabled).toBe(true);
  });

  it('keeps testimonials that are switched off as a disabled section', () => {
    const raw = {
      ...groceryDefault,
      testimonials: [
        { name: 'Asha', text: 'Lovely.', photo_url: '' },
        { name: 'Ravi', text: 'Quick.', photo_url: '' },
      ],
    };
    expect(sanitizeStoreTheme(raw).homepage_sections.find((s) => s.id === 'testimonials')?.enabled).toBe(false);
    const t = first(home(migrateStoreTheme(raw, ctx)), 'testimonials');
    expect(t.disabled).toBe(true);
    expect(blocks(t, 'quote')).toHaveLength(2);
  });

  it('leaves out switched-off toggles with no content and drops Offers from the menu when offers is off', () => {
    const raw = {
      ...groceryDefault,
      homepage_sections: [
        { id: 'offers', enabled: false },
        { id: 'categories', enabled: false },
      ],
    };
    const m = migrateStoreTheme(raw, ctx);
    expect(types(home(m))).toEqual(['slideshow', 'featured-products']);
    const header = m.data.header_group.sections.header;
    expect(header.settings.show_category_chips).toBe(false);
    expect(header.settings.menu).toBe('main');
    expect(mainItems(m).map((i) => i.label)).toEqual(['All Products']);
  });
});

describe('khatarioDefault', () => {
  it('reproduces the Khatario preset home order (store without a tagline)', () => {
    const r = migrateStoreTheme(khatarioDefault, noTagline);
    const preset = presetTheme('khatario', { businessName: ctx.businessName, tagline: '', heroUrl: ctx.heroUrl });
    expect(types(home(r))).toEqual(['slideshow', 'category-grid', 'product-rail', 'featured-products']);
    expect(types(home(r))).toEqual(types(preset.templates.home));
  });

  it('reproduces the Khatario preset home, tagline line included (store with a tagline)', () => {
    const r = migrateStoreTheme(khatarioDefault, ctx);
    const preset = presetTheme('khatario', { businessName: ctx.businessName, tagline: ctx.tagline, heroUrl: ctx.heroUrl });
    expect(types(home(r))).toEqual(types(preset.templates.home));
    expect(first(home(r), 'rich-text')).toEqual(first(preset.templates.home, 'rich-text'));
  });

  it('adds the tagline line after the hero when the store has one', () => {
    const r = migrateStoreTheme(khatarioDefault, ctx);
    expect(types(home(r))).toEqual(['slideshow', 'rich-text', 'category-grid', 'product-rail', 'featured-products']);
    const line = first(home(r), 'rich-text');
    expect(line.label).toBe('Tagline');
    expect(line.settings).toMatchObject({ align: 'left', spacing_top: 12, spacing_bottom: 0 });
    expect(line.block_order).toEqual(['text-1']);
    expect(line.blocks['text-1'].settings.content).toBe(`<p>${ctx.tagline}</p>`);
  });

  it('uses a Shop-from fallback slide and the full-width medium slideshow', () => {
    const r = migrateStoreTheme(khatarioDefault, noTagline);
    const show = first(home(r), 'slideshow');
    expect(show.settings).toMatchObject({ layout: 'full', height: 'medium' });
    expect(blocks(show, 'slide')[0].settings).toMatchObject({
      heading: `Shop from ${ctx.businessName}`,
      description: 'Fresh products from your local store. Add to cart in one tap.',
      button_text: 'Order now',
      link: '#catalog',
    });
  });

  it('paints announcement and header with scheme 4; the empty announcement is off', () => {
    const r = migrateStoreTheme(khatarioDefault, ctx);
    const ann = r.data.header_group.sections.announcement;
    expect(ann.color_scheme).toBe('scheme-4');
    expect(ann.disabled).toBe(true);
    expect(r.data.header_group.sections.header.color_scheme).toBe('scheme-4');
    expect(r.data.footer_group.sections.footer.color_scheme).toBeUndefined();
  });
});

describe('khatarioAll', () => {
  const r = migrateStoreTheme(khatarioAll, ctx);

  it('keeps the order the old Khatario home shows', () => {
    expect(types(home(r))).toEqual([
      'slideshow',
      'rich-text',
      'category-grid',
      'promo-cards',
      'product-rail',
      'promo-cards',
      'featured-products',
      'product-rail',
      'category-shelves',
      'testimonials',
      'rich-text',
      'featured-products',
    ]);
  });

  it('carries every hero slide with its device', () => {
    const slides = blocks(first(home(r), 'slideshow'), 'slide');
    expect(slides.map((s) => [s.settings.heading, s.settings.device])).toEqual([
      ['Big sale', 'both'],
      ['Snacks', 'both'],
      ['Drinks', 'desktop'],
    ]);
  });

  it('shows the overlay bands as overlay promo cards', () => {
    const [bands] = ofType(home(r), 'promo-cards');
    expect(bands.settings.style).toBe('overlay');
    expect(blocks(bands, 'card').map((b) => [b.settings.heading, b.settings.image])).toEqual([['Weekend offers', 'https://cdn.example.com/kb.jpg']]);
  });

  it('the second promo-cards holds slides 2-3', () => {
    const promo = ofType(home(r), 'promo-cards')[1];
    expect(promo.label).toBe('Promo slides');
    expect(promo.settings.style).toBe('overlay');
    expect(blocks(promo, 'card').map((b) => [b.settings.heading, b.settings.image])).toEqual([
      ['Snacks', 'https://cdn.example.com/k2.jpg'],
      ['Drinks', 'https://cdn.example.com/k3.jpg'],
    ]);
  });

  it('uses the Khatario headings', () => {
    const h = home(r);
    expect(ofType(h, 'product-rail')[0].settings).toMatchObject({ heading: 'Popular products', source: 'all', limit: 6 });
    expect(ofType(h, 'featured-products')[0].settings).toMatchObject({ heading: 'Featured', source: 'featured', limit: 6, columns: 2 });
    expect(first(h, 'testimonials').settings.heading).toBe('Customer testimonials');
    expect(ofType(h, 'rich-text')[1].blocks['heading-1'].settings.text).toBe('Our story');
  });

  it("header's color_scheme is scheme-4", () => {
    expect(r.data.header_group.sections.header.color_scheme).toBe('scheme-4');
  });

  it('the "All products" grid is last', () => {
    const h = home(r);
    const last = h.sections[h.order[h.order.length - 1]];
    expect(last.type).toBe('featured-products');
    expect(last.settings).toMatchObject({ heading: 'All products', source: 'all', limit: 24, columns: 4 });
  });
});

describe('khatarioBare', () => {
  it('starts with the category grid and has no tagline section', () => {
    const r = migrateStoreTheme(khatarioBare, noTagline);
    expect(types(home(r))[0]).toBe('category-grid');
    expect(ofType(home(r), 'rich-text')).toHaveLength(0);
    expect(ofType(home(r), 'slideshow')).toHaveLength(0);
  });
});

describe('migratePackHome directly', () => {
  it('keeps a switched-off hero with slides as a disabled slideshow', () => {
    const t = sanitizeStoreTheme({ ...khatarioAll, homepage_sections: [{ id: 'hero', enabled: false }] });
    const { home: h } = migratePackHome(t, ctx);
    const show = first(h, 'slideshow');
    expect(show.disabled).toBe(true);
    // The promo slides came from the hero, so they go with it.
    expect(ofType(h, 'promo-cards').filter((s) => s.label === 'Promo slides')).toHaveLength(0);
  });

  it('drops http band images with a warning', () => {
    const t = sanitizeStoreTheme({
      ...applyStorePreset('grocery'),
      overlay_bands: [{ image_url: 'http://insecure.example.com/b.jpg', caption: 'Old', cta: '' }],
    });
    const { home: h, warnings } = migratePackHome(t, ctx);
    expect(blocks(first(h, 'promo-cards'), 'card')[0].settings.image).toBe('');
    expect(warnings.some((w) => /promo image/.test(w))).toBe(true);
  });
});
