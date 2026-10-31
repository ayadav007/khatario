import type { ThemeData } from '../types';
import type { PresetContext } from './index';
import { block, onScheme, presetSettings, section, template } from './shared';
import { studioFooter } from './studio';
import { defaultTemplate } from './templates';

/** Premium Grocery: marquee, category chips, hero card, emoji aisles, deals, promo cards and the full grid. */
export function groceryPreset(ctx: PresetContext): ThemeData {
  const name = ctx.businessName.trim();
  const tagline = ctx.tagline.trim();

  const headerSettings: Record<string, unknown> = {
    show_category_chips: true,
    search_placeholder: 'Search for products, brands and categories…',
  };
  if (ctx.logoUrl) headerSettings.logo_url = ctx.logoUrl;

  const slide: Record<string, unknown> = {
    heading: (tagline || 'Fresh groceries & daily essentials').slice(0, 120).trim(),
    description: 'Fresh produce and everyday essentials, delivered to your doorstep.',
    button_text: 'Shop groceries',
    link: '#catalog',
  };
  if (ctx.heroUrl) slide.image = ctx.heroUrl;

  // The old Grocery home's two default promo cards (StoreGroceryHome, no overlay bands).
  const cards = [
    block('card', {
      eyebrow: "Today's offers",
      heading: 'Everyday essentials, honest prices',
      text: 'Handpicked deals from our shelves, updated regularly.',
      button_text: 'Shop offers',
      link: '/catalog?disc=10',
    }),
    block('card', {
      eyebrow: name.slice(0, 40).trim(),
      heading: (tagline || 'Your weekly shop in a few taps').slice(0, 120).trim(),
      text: 'Add to cart, check out, and we will get your order ready.',
      button_text: 'Start shopping',
      link: '#catalog',
    }),
  ];

  return {
    settings: presetSettings(ctx, 'grocery'),
    header_group: template([
      onScheme(section('announcement', { text: (tagline || 'Fresh groceries delivered to your door').slice(0, 200).trim(), scrolling: true }), 'scheme-6'),
      section('header', headerSettings, [
        block('menu_link', { label: 'All Products', link: '/catalog' }),
        block('menu_link', { label: 'Offers', link: '/catalog?disc=10' }),
        block('menu_link', { label: 'Contact', link: '/contact' }),
      ]),
    ]),
    footer_group: template([onScheme(studioFooter(), 'scheme-6')]),
    templates: {
      home: template([
        section('slideshow', { layout: 'image-text', height: 'large', speed: 7 }, [block('slide', slide)]),
        section('category-grid', { heading: 'Shop by category', eyebrow: '', style: 'emoji', columns: 6 }),
        section('product-rail', { heading: "Today's deals", source: 'discounted', limit: 8 }),
        section('promo-cards', { style: 'split' }, cards),
        section('featured-products', { heading: 'All products', source: 'all', limit: 24, columns: 5 }),
      ]),
      product: defaultTemplate('product'),
      catalog: defaultTemplate('catalog'),
    },
  };
}
