import type { ThemeData } from '../types';
import type { PresetContext } from './index';
import { block, onScheme, presetSettings, section, template } from './shared';
import { studioFooter } from './studio';
import { defaultTemplate } from './templates';
import { CARD_LINE_IDS, PRODUCT_CARD_DEFAULTS, cloneProductCard, type ProductCardSettings } from '../product-card';

/** Drop Culture's sample pictures: Khatario-made SVGs (flat shapes, no text) that the owner replaces with their own. */
const IMG = '/store-presets/drop';
const img = (name: string) => `${IMG}/${name}.svg`;

// Scheme ids (presets/look.ts PRESET_SCHEMES.drop).
const INK = 'scheme-1';
const CONCRETE = 'scheme-2';
const BONE = 'scheme-3';
const VOLT = 'scheme-4';
const SMOKE = 'scheme-6';

const MAIN_MENU: { label: string; link: string }[] = [
  { label: 'New drop', link: '/catalog' },
  { label: 'Shop all', link: '/catalog' },
  { label: 'Contact', link: '/contact' },
];

// Placeholder copy: each line tells the merchant what to write, so the preset promises nothing on their behalf.
const TRUST_COLUMNS = [
  { icon: 'cash', title: 'Cash on delivery', text: 'Say whether you take cash on delivery' },
  { icon: 'return', title: '7-day exchange', text: 'Say how exchanges work' },
  { icon: 'truck', title: 'Ships in 24 hours', text: 'Say how fast you ship' },
];

/** Size-first dark cards: name, price and sizes on a portrait photo with an add icon; sold-out items move to the end. */
function dropCard(): ProductCardSettings {
  const on = ['name', 'price', 'sizes', 'buttons'] as const;
  const off = CARD_LINE_IDS.filter((id) => !(on as readonly string[]).includes(id));
  return {
    ...cloneProductCard(PRODUCT_CARD_DEFAULTS),
    design: 'dark',
    image_shape: 'portrait',
    image_hover: 'second',
    badge_shape: 'corner',
    button_style: 'icon',
    oos_look: 'label',
    oos_place: 'end',
    lines: [...on.map((id) => ({ id, on: true })), ...off.map((id) => ({ id, on: false }))],
  };
}

/** `#wear<brand>` for the gallery heading: the business name in lower-case letters and digits, or none. */
function wearTag(name: string): string {
  const tag = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
  return tag ? `#wear${tag}` : '';
}

/**
 * Drop Culture: a near-black streetwear store with a volt accent, built for limited drops. Built only from engine
 * sections, with placeholder copy (no invented reviews, press names or service claims beyond the editable lines below)
 * and eleven sample pictures under public/store-presets/drop. Both countdowns ship without an end time, so they stay
 * hidden until the owner sets one, and the Video section renders nothing until it has a link.
 */
export function dropPreset(ctx: PresetContext): ThemeData {
  const name = ctx.businessName.trim();
  const tagline = ctx.tagline.trim();
  // A demo store swaps the sample pictures for its own photos.
  const pic = (n: string) => ctx.images?.[n] ?? img(n);

  const settings = presetSettings(ctx, 'drop');
  settings.product_card = dropCard();

  const headerSettings: Record<string, unknown> = { logo_position: 'center' };
  if (ctx.logoUrl) headerSettings.logo_url = ctx.logoUrl;

  const footer = studioFooter();
  footer.settings = { ...footer.settings, show_payment_icons: true };
  if (tagline) footer.settings.about = tagline.slice(0, 500).trim();

  const catalog = defaultTemplate('catalog');
  for (const s of Object.values(catalog.sections)) {
    if (s.type === 'catalog-banner') s.color_scheme = SMOKE;
    if (s.type === 'main-catalog') s.settings = { ...s.settings, columns_desktop: 4, columns_mobile: 2 };
  }

  const gallery: Record<string, unknown> = { layout: 'grid', columns: 4 };
  const tag = wearTag(name);
  if (tag) gallery.heading = tag;

  return {
    settings,
    header_group: template([
      onScheme(section('announcement', { text: 'Free shipping over ₹699 · COD available · Any 3 tees @ ₹999', scrolling: true }), VOLT),
      section('header', headerSettings, MAIN_MENU.map((m) => block('menu_link', m))),
    ]),
    footer_group: template([onScheme(footer, INK)]),
    templates: {
      home: template([
        onScheme(
          section('image-banner', { layout: 'image-text', image: pic('hero-1') }, [
            block('eyebrow', { text: 'New drop' }),
            block('heading', { text: (name || 'Summer drop').slice(0, 120).trim(), size: 'xxl' }),
            block('countdown', { label: 'Drop ends in', ends_at: '', style: 'boxes' }),
            block('button', { label: 'Shop the drop', link: '/catalog' }),
          ]),
          SMOKE,
        ),
        onScheme(
          section('marquee', {}, ['New drop', 'Heavyweight cotton', 'Ships in 24 hours', '7-day exchange'].map((text) => block('item', { text }))),
          INK,
        ),
        section('featured-products', { heading: 'Just dropped', source: 'new', limit: 8, columns: 4, show_badges: true }),
        section(
          'category-grid',
          { heading: 'Shop by category', columns: 3, style: 'tiles' },
          [1, 2, 3].map((n) => block('category_image', { image: pic(`category-${n}`) })),
        ),
        onScheme(section('video', { heading: 'On the streets', video_url: '' }), CONCRETE),
        // Promo cards carry no colour scheme of their own, so the Volt and Alarm colours are the cards' pictures, shown full-card (overlay).
        section('promo-cards', { style: 'overlay', columns: 2 }, [
          block('card', { eyebrow: 'Combo', heading: 'Any 3 @ ₹999', button_text: 'Shop now', link: '/catalog', image: pic('promo-1') }),
          block('card', { eyebrow: 'Last call', heading: 'Up to 40% off', button_text: 'Shop now', link: '/catalog', image: pic('promo-2') }),
        ]),
        section('shop-the-look', { heading: 'Shop the fit', image: pic('look-1'), image_side: 'left', show_list: true }),
        onScheme(section('countdown', { heading: 'Next drop', ends_at: '', link: '', button_label: 'Get drop alerts' }), VOLT),
        section('image-gallery', gallery, [1, 2, 3, 4].map((n) => block('image', { image: pic(`gallery-${n}`) }))),
        section('testimonials', { show_summary: true }, [
          block('quote', { text: 'Tell shoppers what a customer said about you.', name: 'A customer' }),
        ]),
        section('multicolumn', {}, TRUST_COLUMNS.map((c) => block('column', c))),
        onScheme(section('newsletter', { heading: 'Join the crew', text: 'Say what shoppers get when they sign up.' }), BONE),
      ]),
      product: template([
        section('main-product', { thumbs: 'grid', sticky_info: true, sticky_buy_bar: true }, [
          block('title', {}),
          block('price', {}),
          block('variant_picker', { low_stock_at: 3 }),
          block('buy_buttons', {}),
          block('description', {}),
          block('delivery_check', {}),
          block('collapsible_tab', { heading: 'Details', content: '<p>Tell shoppers about the fit, the cut and the feel of this piece.</p>' }),
          block('collapsible_tab', { heading: 'Fabric and care', content: '<p>Add the fabric and how to wash and dry it.</p>' }),
          block('collapsible_tab', { heading: 'Exchange and returns', content: '<p>Describe your exchange and return policy.</p>' }),
        ]),
        section('related-products', { heading: 'Complete the fit' }),
        section('product-reviews', {}),
        section('recently-viewed', {}),
      ]),
      catalog,
    },
  };
}
