import type { ThemeData } from '../types';
import type { PresetContext } from './index';
import { block, onScheme, presetSettings, section, template } from './shared';
import { studioFooter } from './studio';
import { defaultTemplate } from './templates';

/** Heritage Couture's sample pictures: Khatario-made SVGs (no text) that the owner replaces with their own. */
const IMG = '/store-presets/heritage';
const img = (name: string) => `${IMG}/${name}.svg`;

const NEUTRAL_LINE = 'Discover festive and bridal pieces, chosen with care.';
const DEFAULT_ANNOUNCEMENT = 'Complimentary shipping on orders over ₹15,000';

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MAIN_MENU: { label: string; link: string }[] = [
  { label: 'New in', link: '/catalog' },
  { label: 'Sarees', link: '/catalog' },
  { label: 'Bridal', link: '/catalog' },
  { label: 'Jewellery', link: '/catalog' },
  { label: 'Our story', link: '/pages/about' },
];

const PROMISES = [
  { icon: 'truck', title: 'Insured delivery', text: 'Every parcel is insured until it reaches you' },
  { icon: 'shield', title: 'Certified materials', text: 'Fabrics and metals described as they are' },
  { icon: 'return', title: 'Made to measure', text: 'Alterations and fittings on request' },
  { icon: 'badge', title: 'Personal concierge', text: 'Help choosing, from first look to gift wrap' },
];

const PROMO_CARDS = [
  { eyebrow: 'New season', heading: 'Sarees', image: 'gallery-1' },
  { eyebrow: 'The wedding edit', heading: 'Bridal', image: 'gallery-2' },
  { eyebrow: 'Fine pieces', heading: 'Jewellery', image: 'gallery-3' },
  { eyebrow: 'For every occasion', heading: 'Gifting', image: 'gallery-4' },
];

/**
 * Heritage Couture: an ivory, crimson and gold boutique for fashion, couture and jewellery. Built only from
 * engine sections, with placeholder copy (no invented reviews, press names or customer photos) and nine sample
 * images under public/store-presets/heritage.
 */
export function heritagePreset(ctx: PresetContext): ThemeData {
  const name = ctx.businessName.trim();
  const tagline = ctx.tagline.trim();

  const headerSettings: Record<string, unknown> = {};
  if (ctx.logoUrl) headerSettings.logo_url = ctx.logoUrl;

  const footer = studioFooter();
  footer.settings = { ...footer.settings, show_payment_icons: true };
  if (tagline) footer.settings.about = tagline.slice(0, 500).trim();

  const catalog = defaultTemplate('catalog');
  for (const s of Object.values(catalog.sections)) {
    if (s.type === 'main-catalog') s.settings = { ...s.settings, columns_desktop: 4 };
  }

  return {
    settings: presetSettings(ctx, 'heritage'),
    header_group: template([
      onScheme(section('announcement', { text: tagline.slice(0, 200).trim() || DEFAULT_ANNOUNCEMENT }), 'scheme-3'),
      section('header', headerSettings, MAIN_MENU.map((m) => block('menu_link', m))),
    ]),
    footer_group: template([onScheme(footer, 'scheme-4')]),
    templates: {
      home: template([
        section(
          'collage',
          {
            layout: 'text-left',
            feature_tile: 'first',
            eyebrow: 'Festive & bridal edit',
            heading: (name ? `Welcome to ${name}` : 'Welcome').slice(0, 120).trim(),
            text: `<p>${escapeHtml(tagline.slice(0, 300).trim() || NEUTRAL_LINE)}</p>`,
            button_text: 'Explore the collection',
            link: '/catalog',
            button_2_text: 'Our story',
            link_2: '/pages/about',
          },
          [1, 2, 3].map((n) => block('image_tile', { image: img(`hero-${n}`) })),
        ),
        section('multicolumn', {}, PROMISES.map((p) => block('column', p))),
        section(
          'promo-cards',
          { style: 'overlay', columns: 4 },
          PROMO_CARDS.map((c) => block('card', { eyebrow: c.eyebrow, heading: c.heading, button_text: 'Shop now', link: '/catalog', image: img(c.image) })),
        ),
        section('featured-products', {
          heading: 'Signature pieces',
          source: 'featured',
          limit: 8,
          columns: 4,
          show_badges: true,
          show_tagline: true,
          show_swatches: true,
        }),
        section('image-with-text', { image: img('story'), image_side: 'left' }, [
          block('eyebrow', { text: 'Our craft' }),
          block('heading', { text: 'Made by hand, for keeps' }),
          block('text', { content: '<p>Tell shoppers how your pieces are made, who makes them and why they last.</p>' }),
          block('quote', { text: 'A line from your founder', attribution: 'Founder' }),
          block('checklist_item', { title: 'Considered materials', text: 'Say what each piece is made of.' }),
          block('checklist_item', { title: 'Finished with care', text: 'Describe how it is checked before it ships.' }),
          block('checklist_item', { title: 'Made to be worn', text: 'Share how to keep it looking its best.' }),
          block('button', { label: 'Read our story', link: '/pages/about' }),
          block('highlight_card', { eyebrow: 'Our promise', title: 'Every piece documented', text: 'Add the promise you make with every order.' }),
        ]),
        section('shop-the-look', { image: img('look'), show_list: true, eyebrow: 'The edit', heading: 'Shop the look' }),
        section('testimonials', { show_summary: false }, [
          block('quote', { text: 'Tell shoppers what a customer said about you.', name: 'A customer' }),
        ]),
        section('logo-list', { heading: 'As featured in' }, [
          block('logo', { name: 'Your press mention', caption: '' }),
          block('logo', { name: 'Another publication', caption: '' }),
          block('logo', { name: 'A magazine', caption: '' }),
        ]),
        section(
          'image-gallery',
          { layout: 'grid', columns: 4 },
          [1, 2, 3, 4].map((n) => block('image', { image: img(`gallery-${n}`), subcaption: '@yourstore' })),
        ),
        section('newsletter', { heading: 'Private previews', text: 'Be first to see new pieces and festive edits.' }),
      ]),
      product: template([
        section('main-product', {}, [
          block('title', { show_tagline: true }),
          block('price', {}),
          block('variant_picker', {}),
          block('buy_buttons', {}),
          block('description', {}),
          block('collapsible_tab', { heading: 'Craft and provenance', content: '<p>Tell shoppers where and how this piece is made.</p>' }),
          block('collapsible_tab', { heading: 'Care', content: '<p>Add care instructions for your fabrics and metals.</p>' }),
          block('collapsible_tab', { heading: 'Delivery and returns', content: '<p>Describe your delivery times and return policy.</p>' }),
        ]),
        section('product-reviews', {}),
        section('related-products', {}),
        section('recently-viewed', {}),
      ]),
      catalog,
    },
  };
}
