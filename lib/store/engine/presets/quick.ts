import type { ThemeData } from '../types';
import type { PresetContext } from './index';
import { block, presetSettings, section, template, welcomeSlide } from './shared';
import { STUDIO_USPS, studioFooter } from './studio';
import { defaultTemplate } from './templates';

/** Quick: the quick-delivery app home, in the order `toQuickLayout` gives the Studio layout. */
export function quickPreset(ctx: PresetContext): ThemeData {
  const headerSettings: Record<string, unknown> = {
    delivery_eta: 'in 30 minutes',
    search_placeholder: 'Search for products…',
  };
  if (ctx.logoUrl) headerSettings.logo_url = ctx.logoUrl;

  return {
    settings: { ...presetSettings(ctx, 'quick'), phone_kit: true },
    header_group: template([
      section('header', headerSettings, [
        block('menu_link', { label: 'All Products', link: '/catalog' }),
        block('menu_link', { label: 'Offers', link: '/catalog?disc=10', highlight: true }),
      ]),
    ]),
    footer_group: template([studioFooter()]),
    templates: {
      home: template([
        section('slideshow', { layout: 'full', height: 'small' }, [block('slide', welcomeSlide(ctx))]),
        section('category-grid', { heading: 'Shop by category', columns: 8 }),
        section('product-rail', { heading: 'Bestsellers', source: 'bestsellers', limit: 12 }),
        section('product-rail', { heading: 'Top deals', source: 'discounted', limit: 12 }),
        section('multicolumn', {}, STUDIO_USPS.map((u) => block('column', u))),
        section('featured-products', { heading: 'Handpicked for you', source: 'all', limit: 24, columns: 6 }),
      ]),
      product: defaultTemplate('product'),
      catalog: defaultTemplate('catalog'),
    },
  };
}
