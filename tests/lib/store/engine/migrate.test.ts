import { migrateStoreTheme, type MigrationResult } from '@/lib/store/engine/migrate';
import { migrateStudioSections } from '@/lib/store/engine/migrate-studio';
import { sanitizeThemeData, themeTooLarge, ID_RE } from '@/lib/store/engine/sanitize';
import { PACK_CANVAS_MODE, sanitizeStoreTheme } from '@/lib/store/store-theme';
import type { StudioSection } from '@/lib/store/studio-sections';
import type { Section, Template } from '@/lib/store/engine/types';
import {
  ALL_FIXTURES,
  CAT_FRUITS,
  CAT_VEG,
  ctx,
  customDark,
  hostile,
  namedGrocery,
  quickDerived,
  retiredNoir,
  studioDerived,
  studioSaved,
} from './fixtures/store-themes';

const types = (t: Template) => t.order.map((id) => t.sections[id].type);
const home = (r: MigrationResult) => r.data.templates.home;
const first = (t: Template, type: string): Section => {
  const id = t.order.find((i) => t.sections[i].type === type);
  if (!id) throw new Error(`no ${type}`);
  return t.sections[id];
};
const blocks = (s: Section, type: string) => s.block_order.map((id) => s.blocks[id]).filter((b) => b.type === type);

describe.each(Object.entries(ALL_FIXTURES))('%s fixture invariants', (_name, raw) => {
  it('sanitises to itself, fits, is pure and has unique valid ids', () => {
    const r = migrateStoreTheme(raw, ctx);
    expect(sanitizeThemeData(r.data)).toEqual(r.data);
    expect(themeTooLarge(r.data)).toBe(false);
    expect(migrateStoreTheme(raw, ctx)).toEqual(r);
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
  });
});

describe('studioDerived', () => {
  const r = migrateStoreTheme(studioDerived, ctx);

  it('is the Studio preset', () => {
    expect(r.preset).toBe('studio');
    expect(r.name).toBe('Studio');
  });

  it('keeps the order the old storefront renders', () => {
    expect(types(home(r))).toEqual(['slideshow', 'category-grid', 'featured-products', 'image-banner', 'testimonials']);
  });

  it('shows every slide on both devices, as the old Studio hero did (it never read the slide viewport)', () => {
    const slides = blocks(first(home(r), 'slideshow'), 'slide');
    expect(slides).toHaveLength(2);
    expect(slides[0].settings.device).toBe('both');
    // hero_slides[1] is `viewport: 'mobile'` in the fixture; the old Studio hero still showed it on desktop.
    expect(slides[1].settings.device).toBe('both');
    expect(slides[0].settings.link).toBe('#catalog');
  });

  it('copies the testimonials', () => {
    const quotes = blocks(first(home(r), 'testimonials'), 'quote').map((b) => ({ name: b.settings.name, text: b.settings.text }));
    expect(quotes).toEqual(studioDerived.testimonials.map((t) => ({ name: t.name, text: t.text })));
    expect(blocks(first(home(r), 'testimonials'), 'quote').every((b) => b.settings.rating === 5)).toBe(true);
  });

  it('turns category images into blocks for known categories only', () => {
    const grid = first(home(r), 'category-grid');
    expect(grid.settings.style).toBe('tiles');
    expect(blocks(grid, 'category_image').map((b) => b.settings)).toEqual([{ category: CAT_FRUITS, image: 'https://cdn.example.com/fruits.jpg' }]);
  });

  it('leaves product and catalog templates empty', () => {
    expect(r.data.templates.product).toEqual({ order: [], sections: {} });
    expect(r.data.templates.catalog).toEqual({ order: [], sections: {} });
  });

  it('builds settings from the pack look', () => {
    const s = r.data.settings;
    expect(s.color_schemes[0].background).toBe('#fbf8f3');
    expect(s.color_schemes[0].accent).toBe('#b94717');
    expect(s.font_heading).toBe('outfit');
    expect(s.font_body).toBe('inter');
    expect(s.logo_url).toBe('https://cdn.example.com/logo.png');
    expect(s.custom_css).toBe('');
  });
});

describe('studioSaved', () => {
  const r = migrateStoreTheme(studioSaved, ctx);
  const h = home(r);

  it('maps every home section in order', () => {
    expect(types(h)).toEqual(['slideshow', 'category-grid', 'product-rail', 'image-banner', 'rich-text', 'marquee']);
  });

  it('keeps the hidden banner as disabled', () => {
    expect(first(h, 'image-banner').disabled).toBe(true);
    expect(first(h, 'slideshow').disabled).toBeUndefined();
  });

  it('keeps the section class, CSS and spacing', () => {
    const rail = first(h, 'product-rail');
    expect(rail.css_class).toBe('fruit-row');
    expect(rail.custom_css).toBe('.x{color:red}');
    expect(rail.settings.spacing_top).toBe(20);
  });

  it('turns the carousel row into a category product rail', () => {
    const rail = first(h, 'product-rail');
    expect(rail.settings.source).toBe('category');
    expect(rail.settings.category).toBe(CAT_FRUITS);
    expect(rail.settings.limit).toBe(10);
  });

  it('converts nav labels into links', () => {
    const header = r.data.header_group.sections.header;
    const links = blocks(header, 'menu_link').map((b) => [b.settings.label, b.settings.link, b.settings.highlight]);
    expect(links).toEqual([
      ['All Products', '/catalog', false],
      ['Fruits', `/catalog/${CAT_FRUITS}`, false],
      ['Vegetables', `/catalog/${CAT_VEG}`, false],
      ['Offers', '/catalog?disc=10', true],
      ['Contact', '/contact', false],
    ]);
    expect(header.settings.show_cart_count).toBe(false);
    expect(header.settings.delivery_eta).toBe('Fresh daily');
  });

  it('maps the hero, categories, rich text and marquee', () => {
    const show = first(h, 'slideshow');
    expect(show.settings).toMatchObject({ layout: 'full', height: 'large', autoplay: true, speed: 10 });
    expect(blocks(show, 'slide').map((b) => b.settings.heading)).toEqual(['Hello', 'Two']);
    expect(first(h, 'category-grid').settings).toMatchObject({ heading: 'Aisles', columns: 8 });
    const rich = first(h, 'rich-text');
    expect(rich.settings.heading).toBe('About us');
    expect(rich.settings.content).toContain('&lt;b&gt;dal&lt;/b&gt;');
    expect(rich.settings.content).not.toContain('<b>');
    const mq = first(h, 'marquee');
    expect(mq.settings.speed).toBe(18);
    expect(blocks(mq, 'item').map((b) => b.settings.text)).toEqual(['Free delivery', 'COD', 'Fresh daily']);
  });

  it('maps the announcement and footer', () => {
    const ann = r.data.header_group.sections.announcement;
    expect(ann.settings).toMatchObject({ text: 'Free delivery today', link: '/catalog', text_align: 'left' });
    const footer = r.data.footer_group.sections.footer;
    expect(footer.settings.about).toBe('Since 1990');
    const col = blocks(footer, 'link_column');
    expect(col).toHaveLength(1);
    expect(col[0].settings.heading).toBe('Links');
    expect(col[0].settings.links).toBe(`Shop|/\nAbout|/about\nFruits|/catalog/${CAT_FRUITS}\nOffers|/catalog?disc=10`);
  });

  it('copies social links', () => {
    expect(r.data.settings.social.instagram).toBe('https://instagram.com/rosemart');
    expect(r.data.settings.social.whatsapp).toBe('https://wa.me/919876543210');
  });
});

describe('quickDerived', () => {
  const r = migrateStoreTheme(quickDerived, ctx);

  it('is the Quick preset with the phone kit on', () => {
    expect(r.preset).toBe('quick');
    expect(r.name).toBe('Quick');
    expect(r.data.settings.phone_kit).toBe(true);
  });

  it('has the Quick home', () => {
    expect(types(home(r))).toEqual(['slideshow', 'category-grid', 'product-rail', 'product-rail', 'multicolumn', 'featured-products']);
    expect(home(r).order.slice(2, 4)).toEqual(['product-rail', 'product-rail-2']);
    expect(blocks(first(home(r), 'multicolumn'), 'column')).toHaveLength(4);
    expect(first(home(r), 'featured-products').settings).toMatchObject({ source: 'all', limit: 24, columns: 6 });
  });

  it("uses Quick's 12px rhythm for sections whose spacing was never set (the old Quick store's own padding)", () => {
    for (const id of home(r).order) {
      expect(home(r).sections[id].settings).toMatchObject({ spacing_top: 12, spacing_bottom: 12 });
    }
    const studio = migrateStoreTheme(studioDerived, ctx);
    expect(first(home(studio), 'slideshow').settings.spacing_top).not.toBe(12);
  });

  it('keeps the phone kit on even when the old theme switched it off', () => {
    expect(migrateStoreTheme({ ...quickDerived, phone_kit: false }, ctx).data.settings.phone_kit).toBe(true);
    expect(migrateStoreTheme({ ...studioDerived, phone_kit: false }, ctx).data.settings.phone_kit).toBe(false);
  });
});

describe('customDark', () => {
  const r = migrateStoreTheme(customDark, ctx);

  it('carries the dark paper and the custom accent', () => {
    const s1 = r.data.settings.color_schemes[0];
    expect(s1.background).toBe(PACK_CANVAS_MODE.studio.dark);
    expect(s1.text).toBe('#f4efe6');
    expect(s1.accent).toBe('#7c3aed');
  });

  it('uses the chosen font for heading and body', () => {
    expect(r.data.settings.font_heading).toBe('playfair');
    expect(r.data.settings.font_body).toBe('playfair');
  });
});

describe('retiredNoir', () => {
  it('lands on Studio with a dark page', () => {
    const r = migrateStoreTheme(retiredNoir, ctx);
    expect(r.preset).toBe('studio');
    expect(r.data.settings.color_schemes[0].background).toBe(PACK_CANVAS_MODE.studio.dark);
  });
});

describe('hostile', () => {
  const r = migrateStoreTheme(hostile, ctx);

  it('drops unsafe images with warnings', () => {
    expect(r.data.settings.logo_url).toBe('');
    expect(r.warnings.some((w) => /logo/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /hero image/.test(w))).toBe(true);
    expect(blocks(first(home(r), 'slideshow'), 'slide')[0].settings.image).toBe('');
  });

  it('drops the javascript announcement link', () => {
    const ann = r.data.header_group.sections.announcement;
    expect(ann).toBeDefined();
    expect(ann.settings.link ?? '').toBe('');
  });

  it('keeps what the old store showed (24 saved sections) and says what it never showed', () => {
    expect(sanitizeStoreTheme(hostile).studio_sections).toHaveLength(24);
    expect(home(r).order).toHaveLength(22);
    expect(r.warnings.some((w) => /6 saved Studio sections/.test(w))).toBe(true);
  });

  it('keeps a typed https nav link as the old store did, and drops an http one with a warning', () => {
    const links = blocks(r.data.header_group.sections.header, 'menu_link').map((b) => b.settings.link);
    expect(links).toEqual([`/catalog/${CAT_FRUITS}`, 'https://evil.com/x']);
    expect(r.warnings.some((w) => /plain\.example/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /evil\.com/.test(w))).toBe(false);
  });

  it('copies the store CSS with a warning', () => {
    expect(r.data.settings.custom_css).toHaveLength(8000);
    expect(r.warnings.some((w) => /CSS/.test(w) && /old layout/.test(w))).toBe(true);
  });

  it('escapes rich text', () => {
    const rich = first(home(r), 'rich-text');
    expect(rich.settings.content).not.toContain('<script');
  });
});

describe('migrateStudioSections', () => {
  it('caps the home at 25 sections and names the overflow', () => {
    const t = sanitizeStoreTheme({ preset: 'studio' });
    const sections: StudioSection[] = Array.from({ length: 30 }, (_, i) => ({
      id: `Text-${i}`,
      type: 'richtext',
      name: `Text ${i}`,
      enabled: true,
      settings: { title: `T${i}`, text: 'x' },
    }));
    const m = migrateStudioSections(sections, t, ctx);
    expect(m.home.order).toHaveLength(25);
    expect(m.home.order[0]).toBe('rich-text');
    expect(m.home.order[24]).toBe('rich-text-25');
    expect(m.warnings.some((w) => /5 sections/.test(w))).toBe(true);
    // No header or footer section: the derived ones are used.
    expect(m.header.order).toContain('header');
    expect(m.footer.order).toEqual(['footer']);
  });

  it('turns an auto announcement with no automatic text into a disabled section', () => {
    const t = sanitizeStoreTheme({ preset: 'studio' });
    const m = migrateStudioSections(
      [{ id: 'a', type: 'announcement', name: 'A', enabled: true, settings: { announceMode: 'auto', autoText: '' } }],
      t,
      ctx,
    );
    expect(m.header.sections.announcement.disabled).toBe(true);
  });

  it('clips a long tagline into the delivery estimate with a warning', () => {
    const t = sanitizeStoreTheme({ preset: 'studio' });
    const m = migrateStudioSections(
      [{ id: 'h', type: 'header', name: 'H', enabled: true, settings: { tagline: 'x'.repeat(60) } }],
      t,
      ctx,
    );
    expect(m.header.sections.header.settings.delivery_eta).toBe('x'.repeat(40));
    expect(m.warnings.some((w) => /tagline/.test(w))).toBe(true);
  });

  it('hides the menu when the nav is off', () => {
    const t = sanitizeStoreTheme({ preset: 'studio' });
    const m = migrateStudioSections(
      [{ id: 'h', type: 'header', name: 'H', enabled: true, settings: { showNav: false, navLinks: 'Fruits' } }],
      t,
      ctx,
    );
    expect(m.header.sections.header.block_order).toEqual([]);
  });
});

describe('announcement colours', () => {
  it('custom colours become the Announcement scheme 5', () => {
    const r = migrateStoreTheme({ preset: 'studio', announcement: 'Sale', announcement_bg: '#112233', announcement_fg: '#ffeedd' }, ctx);
    const s5 = r.data.settings.color_schemes[4];
    expect(s5.name).toBe('Announcement');
    expect(s5.background).toBe('#112233');
    expect(s5.text).toBe('#ffeedd');
    expect(r.data.header_group.sections.announcement.color_scheme).toBe('scheme-5');
  });

  it('without custom colours the announcement has no scheme', () => {
    const r = migrateStoreTheme({ preset: 'studio', announcement: 'Sale' }, ctx);
    expect(r.data.header_group.sections.announcement.color_scheme).toBeUndefined();
    expect(r.data.settings.color_schemes[4].name).not.toBe('Announcement');
  });
});

describe('named preset', () => {
  it('uses the effective accent, not the stored one', () => {
    const r = migrateStoreTheme(namedGrocery, ctx);
    expect(r.preset).toBe('grocery');
    expect(r.name).toBe('Premium Grocery');
    expect(r.data.settings.color_schemes[0].accent).toBe('#176b45');
  });

  it('grocery and khatario get a mapped home', () => {
    for (const raw of [namedGrocery, { preset: 'khatario' }]) {
      const r = migrateStoreTheme(raw, ctx);
      expect(r.data.templates.home.order.length).toBeGreaterThan(0);
      expect(r.warnings).not.toContain('pack home not migrated yet');
    }
  });
});

describe('Quick header warning (D54, M4 11)', () => {
  const QUICK_HEADER = "Quick's delivery line, location picker and menu chips are not in the new header yet";

  it('a Quick store is told its header is not carried over yet', () => {
    expect(migrateStoreTheme(quickDerived, ctx).warnings).toContain(QUICK_HEADER);
  });

  it('a Studio store is not', () => {
    expect(migrateStoreTheme(studioSaved, ctx).warnings).not.toContain(QUICK_HEADER);
    expect(migrateStoreTheme(studioDerived, ctx).warnings).not.toContain(QUICK_HEADER);
  });
});
