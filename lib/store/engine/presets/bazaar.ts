import type { ThemeData } from '../types';
import type { PresetContext } from './index';
import { block, onScheme, presetSettings, section, template } from './shared';
import { studioFooter } from './studio';
import { defaultTemplate } from './templates';
import { CARD_DESIGNS, CARD_LINE_IDS, cloneProductCard, type ProductCardSettings } from '../product-card';

/** Bazaar Bright's sample pictures: Khatario-made SVGs (flat shapes, no text) that the owner replaces with their own. */
const IMG = '/store-presets/bazaar';
const img = (name: string) => `${IMG}/${name}.svg`;

// Scheme ids (presets/look.ts PRESET_SCHEMES.bazaar).
const CREAM = 'scheme-2';
const SAFFRON = 'scheme-3';
const NAVY = 'scheme-4';

const MAIN_MENU: { label: string; link: string }[] = [
  { label: 'All products', link: '/catalog' },
  { label: 'Offers', link: '/catalog?disc=10' },
  { label: 'Contact', link: '/contact' },
];

// The titles are the spec's trust row; each line under it tells the merchant what to write, so the preset promises
// nothing on their behalf.
const TRUST_COLUMNS = [
  { icon: 'cash', title: 'Cash, UPI or khata on delivery', text: 'Say which ways shoppers can pay' },
  { icon: 'leaf', title: 'Fresh or we replace it', text: 'Say what you do when something is not fresh' },
  { icon: 'truck', title: 'Free delivery above ₹299', text: 'Say where you deliver and the minimum order' },
  { icon: 'phone', title: 'Order on call or WhatsApp', text: 'Say how shoppers can order by phone' },
];

const PRODUCT_TABS = [
  { heading: 'Product details', content: '<p>Tell shoppers what is in the pack, its brand and where it comes from.</p>' },
  { heading: 'Storage and shelf life', content: '<p>Say how to store it and how long it keeps.</p>' },
  { heading: 'Returns', content: '<p>Describe your return and replacement policy.</p>' },
];

/**
 * Pack-first grocery cards: the Grocery app design restyled (rounder, cream photo well, full-width Add button), with
 * pack chips, the price per kg or litre and savings in rupees; sold-out items fade and move to the end.
 */
function bazaarCard(): ProductCardSettings {
  const on = ['name', 'packs', 'price', 'buttons'] as const;
  const off = CARD_LINE_IDS.filter((id) => !(on as readonly string[]).includes(id));
  return {
    ...cloneProductCard(CARD_DESIGNS.grocery),
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
    lines: [...on.map((id) => ({ id, on: true })), ...off.map((id) => ({ id, on: false }))],
  };
}

/**
 * Bazaar Bright: a saffron and navy supermarket for kirana shops, with pack sizes on every card, Buy again, store
 * hours and ordering on WhatsApp from the cart. Built only from engine sections, with placeholder copy (no invented
 * reviews or service promises beyond the editable lines below) and twelve sample pictures under
 * public/store-presets/bazaar. The hero countdown ships without an end time, so it stays hidden until the owner sets one.
 */
export function bazaarPreset(ctx: PresetContext): ThemeData {
  const tagline = ctx.tagline.trim();
  // A demo store swaps the sample pictures for its own photos.
  const pic = (n: string) => ctx.images?.[n] ?? img(n);

  const settings = presetSettings(ctx, 'bazaar');
  settings.product_card = bazaarCard();
  settings.cart_free_ship_bar = true;
  settings.cart_suggestions = true;
  settings.cart_suggestions_heading = 'You may also need';
  settings.cart_whatsapp_order = true;

  const headerSettings: Record<string, unknown> = {
    show_open_status: true,
    search_placeholder: 'Search atta, dal, milk, masala…',
    show_category_chips: true,
  };
  if (ctx.logoUrl) headerSettings.logo_url = ctx.logoUrl;

  const footer = studioFooter();
  footer.settings = { ...footer.settings, show_payment_icons: true };
  if (tagline) footer.settings.about = tagline.slice(0, 500).trim();

  const catalog = defaultTemplate('catalog');
  for (const s of Object.values(catalog.sections)) {
    if (s.type === 'main-catalog') {
      s.settings = { ...s.settings, layout: 'rail', columns_desktop: 4, columns_mobile: 2, show_filters: true, show_sort: true };
      // One Marigold promo tile in the grid, after the fifth product.
      const promo = block('promo', { image: pic('catalog-promo'), heading: 'Monthly ration', text: 'Atta + rice + dal, save ₹250', link: '/catalog', position: 5 });
      s.blocks = { 'promo-1': promo };
      s.block_order = ['promo-1'];
    }
  }

  return {
    settings,
    header_group: template([
      onScheme(section('announcement', { text: 'Free delivery above ₹299 · Cash, UPI or khata on delivery' }), NAVY),
      onScheme(section('header', headerSettings, MAIN_MENU.map((m) => block('menu_link', m))), SAFFRON),
    ]),
    footer_group: template([onScheme(footer, NAVY)]),
    templates: {
      home: template([
        section(
          'category-grid',
          { heading: 'Shop by category', columns: 8, style: 'tiles' },
          [1, 2, 3, 4, 5, 6, 7, 8].map((n) => block('category_image', { image: pic(`category-${n}`) })),
        ),
        onScheme(
          section('image-banner', { layout: 'over', image: pic('hero-1') }, [
            block('eyebrow', { text: 'Maha Bachat Week' }),
            block('heading', { text: 'Up to 40% off on staples', size: 'xl' }),
            block('countdown', { ends_at: '' }),
            block('button', { label: 'Shop deals', link: '/catalog' }),
          ]),
          NAVY,
        ),
        section('buy-again', {}),
        section('featured-products', { heading: "Today's deals", source: 'discounted', limit: 10, columns: 5, mobile_columns: '2', show_badges: true }),
        section('promo-cards', { style: 'split', columns: 2 }, [
          block('card', { heading: 'Fresh every morning', text: 'Sabzi from the mandi', button_text: 'Shop now', link: '/catalog', image: pic('promo-1') }),
          block('card', { heading: 'Monthly ration pack', text: 'Save on atta, rice and dal', button_text: 'Shop now', link: '/catalog', image: pic('promo-2') }),
        ]),
        section('category-shelves', { max_categories: 2 }),
        onScheme(section('multicolumn', {}, TRUST_COLUMNS.map((c) => block('column', c))), CREAM),
        section('store-info', {}),
        onScheme(section('newsletter', { heading: 'Get offers first', text: 'Say what shoppers get when they sign up.' }), CREAM),
      ]),
      product: template([
        section('main-product', { thumbs: 'bottom', sticky_info: true, sticky_buy_bar: true }, [
          block('title', {}),
          block('price', { show_you_save: true }),
          block('variant_picker', { style: 'tiles', low_stock_at: 3 }),
          block('buy_buttons', {}),
          block('delivery_check', {}),
          block('description', {}),
          ...PRODUCT_TABS.map((t) => block('collapsible_tab', t)),
        ]),
        section('related-products', { heading: 'You may also need' }),
        section('recently-viewed', {}),
      ]),
      catalog,
    },
  };
}
