// Server-only (imports the engine sanitiser through migrate-studio). Grocery and Khatario home mapping (D28):
// mirrors `StoreGroceryHome` and the Khatario branch of `StoreCatalogView`, in the order they render. Pure.
import { sectionEnabled, type StoreHomepageSectionId, type StoreTheme } from '@/lib/store/store-theme';
import { template } from './presets/shared';
import { groceryDefaultCards } from './presets/grocery';
import { khatarioTaglineSection } from './presets/khatario';
import { engineSection, keepImage, textToParagraphs, Warnings } from './migrate-studio';
import type { Section, Template } from './types';
import type { MigrationContext } from './migrate';

type Raw = Record<string, unknown>;
type BlockIn = { type: string; settings: Raw };

const FALLBACK_DESCRIPTION = 'Fresh products from your local store. Add to cart in one tap.';
const STATS_WARNING = 'Grocery hero stats line is not shown';

/** Marks a section the old store hid (its toggle was off) but which holds merchant content. */
function off(s: Section, enabled: boolean): Section {
  return enabled ? s : { ...s, disabled: true };
}

/** Hero slides as `slide` blocks: the merchant's slides, else the one slide the old store built from the store. */
function heroBlocks(t: StoreTheme, ctx: MigrationContext, grocery: boolean, w: Warnings): BlockIn[] {
  if (t.hero_slides.length > 0) {
    return t.hero_slides.map((s) => ({
      type: 'slide',
      settings: {
        image: keepImage(s.image_url, 'hero image', w),
        heading: s.title,
        description: s.subtitle,
        button_text: t.hero_cta,
        link: '#catalog',
        device: s.viewport,
      },
    }));
  }
  const name = ctx.businessName.trim();
  return [
    {
      type: 'slide',
      settings: {
        image: keepImage(ctx.heroUrl, 'hero image', w),
        heading: ctx.tagline.trim() || (grocery ? 'Fresh groceries & daily essentials' : `Shop from ${name}`),
        description: t.hero_subtitle || FALLBACK_DESCRIPTION,
        button_text: t.hero_cta,
        link: '#catalog',
      },
    },
  ];
}

/** The hero slideshow, or a disabled one when the hero is off but the merchant has slides; else null. */
function hero(t: StoreTheme, ctx: MigrationContext, grocery: boolean, w: Warnings): Section | null {
  const on = sectionEnabled(t, 'hero');
  if (!on && t.hero_slides.length === 0) return null;
  const settings: Raw = grocery
    ? { layout: 'image-text', height: 'large', speed: 7 }
    : { layout: 'full', height: 'medium', speed: 9 };
  const slides = heroBlocks(t, ctx, grocery, w);
  if (grocery && on) {
    w.add(STATS_WARNING);
    if (slides.some((s) => !s.settings.image)) w.add('The Grocery hero basket illustration is not shown on slides without a photo.');
  }
  return off(engineSection('slideshow', settings, slides), on);
}

function categoryImageBlocks(t: StoreTheme, ctx: MigrationContext, w: Warnings): BlockIn[] {
  const out: BlockIn[] = [];
  for (const c of ctx.categories) {
    const url = t.category_images[c.id];
    if (!url) continue;
    const image = keepImage(url, 'category image', w);
    if (image) out.push({ type: 'category_image', settings: { category: c.id, image } });
  }
  return out;
}

function categories(t: StoreTheme, ctx: MigrationContext, grocery: boolean, w: Warnings): Section | null {
  const on = sectionEnabled(t, 'categories');
  const images = categoryImageBlocks(t, ctx, w);
  if (!on && images.length === 0) return null;
  const settings: Raw = grocery
    ? {
        heading: 'Shop by category',
        eyebrow: '',
        style: t.category_style === 'photo' && images.length > 0 ? 'tiles' : 'emoji',
        columns: 6,
      }
    : { heading: '', eyebrow: '', style: 'tiles' };
  return off(engineSection('category-grid', settings, images), on);
}

function promoCards(cards: BlockIn[], style: 'split' | 'overlay', enabled: boolean, label?: string): Section {
  const s = off(engineSection('promo-cards', { style, columns: 2 }, cards), enabled);
  return label ? { ...s, label } : s;
}

function groceryPromo(t: StoreTheme, ctx: MigrationContext, w: Warnings): Section | null {
  const on = sectionEnabled(t, 'overlay');
  const bands = t.overlay_bands.slice(0, 2);
  if (!on && bands.length === 0) return null;
  const cards: BlockIn[] = bands.length
    ? bands.map((b, i) => ({
        type: 'card',
        settings: {
          eyebrow: i === 0 ? 'Special offer' : 'Featured',
          heading: b.caption,
          text: '',
          button_text: b.cta || 'Shop now',
          image: keepImage(b.image_url, 'promo image', w),
          link: '#catalog',
        },
      }))
    : groceryDefaultCards(ctx.businessName, ctx.tagline);
  return promoCards(cards, 'split', on);
}

/** Khatario's overlay bands: the caption over the photo, no button. */
function khatarioBands(t: StoreTheme, w: Warnings): Section | null {
  if (t.overlay_bands.length === 0) return null;
  const cards = t.overlay_bands.map((b) => ({
    type: 'card',
    settings: { eyebrow: '', heading: b.caption, text: '', button_text: '', image: keepImage(b.image_url, 'promo image', w), link: '#catalog' },
  }));
  return promoCards(cards, 'overlay', sectionEnabled(t, 'overlay'));
}

/** Khatario's promo tiles: hero slides after the first that have a photo, at most two. Only while the hero shows. */
function khatarioPromoSlides(t: StoreTheme, w: Warnings): Section | null {
  if (!sectionEnabled(t, 'hero')) return null;
  const slides = t.hero_slides.filter((s, i) => i > 0 && s.image_url).slice(0, 2);
  if (slides.length === 0) return null;
  const cards = slides.map((s) => ({
    type: 'card',
    settings: { eyebrow: '', heading: s.title, text: '', button_text: '', image: keepImage(s.image_url, 'promo image', w), link: '#catalog' },
  }));
  return promoCards(cards, 'overlay', true, 'Promo slides');
}

function products(type: 'product-rail' | 'featured-products', settings: Raw): Section {
  return engineSection(type, settings);
}

function productShelves(t: StoreTheme): Section[] {
  const on = sectionEnabled(t, 'product_shelves');
  return t.product_shelves.map((shelf) => {
    const settings: Raw = { heading: shelf.title, source: shelf.kind, limit: 12 };
    if (shelf.kind === 'price_max') settings.price_max = shelf.price_max;
    return off(products('product-rail', settings), on && shelf.enabled);
  });
}

function testimonials(t: StoreTheme, heading: string, w: Warnings): Section | null {
  if (t.testimonials.length === 0) return null;
  const quotes = t.testimonials.map((q) => {
    if (q.text.length > 400) w.add('Testimonials longer than 400 characters were shortened.');
    return { type: 'quote', settings: { text: q.text, name: q.name, photo: keepImage(q.photo_url, 'testimonial photo', w), rating: 5 } as Raw };
  });
  return off(engineSection('testimonials', { heading }, quotes), sectionEnabled(t, 'testimonials'));
}

/** "Our story": the brand story, else the store's about text (as the old store showed it). Off: kept only with a story. */
function brandStory(t: StoreTheme, ctx: MigrationContext): Section | null {
  const on = sectionEnabled(t, 'brand_story');
  const text = on ? t.brand_story.trim() || ctx.aboutMd.trim() : t.brand_story.trim();
  if (!text) return null;
  return off(
    engineSection('rich-text', { align: 'left' }, [
      { type: 'heading', settings: { text: 'Our story' } },
      { type: 'text', settings: { content: textToParagraphs(text) } },
    ]),
    on,
  );
}

function groceryHome(t: StoreTheme, ctx: MigrationContext, w: Warnings): Array<Section | null> {
  const on = (id: StoreHomepageSectionId) => sectionEnabled(t, id);
  return [
    hero(t, ctx, true, w),
    categories(t, ctx, true, w),
    on('offers') ? products('product-rail', { heading: "Today's deals", source: 'discounted', limit: 8 }) : null,
    groceryPromo(t, ctx, w),
    on('featured')
      ? products('featured-products', { heading: 'Featured picks', eyebrow: 'Chosen by the store', source: 'featured', limit: 6, columns: 3 })
      : null,
    ...productShelves(t),
    on('category_shelves') ? engineSection('category-shelves', { max_categories: 12, per_shelf: 8 }) : null,
    products('featured-products', { heading: 'All products', source: 'all', limit: 24, columns: 5 }),
    testimonials(t, 'Loved by our customers', w),
    brandStory(t, ctx),
  ];
}

function khatarioHome(t: StoreTheme, ctx: MigrationContext, w: Warnings): Array<Section | null> {
  const on = (id: StoreHomepageSectionId) => sectionEnabled(t, id);
  w.add('Khatario popular products now also list products without a photo.');
  return [
    hero(t, ctx, false, w),
    khatarioTaglineSection(ctx.tagline),
    categories(t, ctx, false, w),
    khatarioBands(t, w),
    products('product-rail', { heading: 'Popular products', source: 'all', limit: 6 }),
    khatarioPromoSlides(t, w),
    on('featured') ? products('featured-products', { heading: 'Featured', source: 'featured', limit: 6, columns: 2 }) : null,
    ...productShelves(t),
    on('category_shelves') ? engineSection('category-shelves', { max_categories: 12, per_shelf: 8 }) : null,
    testimonials(t, 'Customer testimonials', w),
    brandStory(t, ctx),
    products('featured-products', { heading: 'All products', source: 'all', limit: 24, columns: 4 }),
  ];
}

/**
 * The Grocery or Khatario home as engine sections (D28), with D30 ids. A toggle that is off is left out unless it
 * holds merchant content (slides, category photos, bands, shelves, testimonials, a brand story); then it is kept
 * as a disabled section, as for derived Studio layouts.
 */
export function migratePackHome(t: StoreTheme, ctx: MigrationContext): { home: Template; warnings: string[] } {
  const w = new Warnings();
  const list = t.pack === 'grocery' ? groceryHome(t, ctx, w) : khatarioHome(t, ctx, w);
  return { home: template(list.filter((s): s is Section => s !== null)), warnings: w.all() };
}
