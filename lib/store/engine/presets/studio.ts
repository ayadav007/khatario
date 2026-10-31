import type { ThemeData } from '../types';
import type { PresetContext } from './index';
import { block, presetSettings, section, template } from './shared';
import { defaultTemplate } from './templates';

// Copied from components/store/studio-theme/StudioSections.tsx DEFAULT_USPS.
const USPS = [
  { icon: 'truck', title: 'Fast delivery', text: 'Quick dispatch on every order' },
  { icon: 'cash', title: 'Cash on delivery', text: 'Pay when it reaches you' },
  { icon: 'return', title: 'Easy returns', text: 'Hassle-free replacements' },
  { icon: 'shield', title: 'Secure payments', text: 'UPI, cards and wallets' },
];

export function studioPreset(ctx: PresetContext): ThemeData {
  const name = ctx.businessName.trim();
  const tagline = ctx.tagline.trim();
  const slide: Record<string, unknown> = {
    heading: `Welcome to ${name}`.slice(0, 120).trim(),
    description: tagline.slice(0, 300).trim(),
    button_text: 'Shop now',
    link: '#catalog',
  };
  if (ctx.heroUrl) slide.image = ctx.heroUrl;

  const headerSettings: Record<string, unknown> = {};
  if (ctx.logoUrl) headerSettings.logo_url = ctx.logoUrl;

  return {
    settings: presetSettings(ctx, 'studio'),
    header_group: template([
      section('announcement', { text: tagline.slice(0, 200).trim() }),
      section('header', headerSettings, [
        block('menu_link', { label: 'All Products', link: '/catalog' }),
        block('menu_link', { label: 'Offers', link: '/#offers' }),
        block('menu_link', { label: 'Contact', link: '/contact' }),
      ]),
    ]),
    footer_group: template([
      section('footer', { badge: true }, [
        block('link_column', { heading: 'Help', links: 'Contact|/contact\nRefund policy|/refund\nTerms|/terms' }),
      ]),
    ]),
    templates: {
      home: template([
        section('slideshow', {}, [block('slide', slide)]),
        section('category-grid', {}),
        section('product-rail', { source: 'bestsellers', heading: 'Bestsellers' }),
        section('multicolumn', {}, USPS.map((u) => block('column', u))),
        section('featured-products', { source: 'all', heading: 'All products', limit: 24 }),
        section('testimonials', {}),
      ]),
      product: defaultTemplate('product'),
      catalog: defaultTemplate('catalog'),
    },
  };
}
