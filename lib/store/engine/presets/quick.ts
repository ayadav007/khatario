import type { ThemeData } from '../types';
import type { PresetContext } from './index';
import { block, presetSettings, section, template, welcomeSlide } from './shared';
import { STUDIO_USPS, studioFooter } from './studio';
import { defaultTemplate } from './templates';
import { QUICK_SECTION_SPACING } from '../migrate-studio';

/** Quick's tight section rhythm (the old Quick store's padding). */
const tight = { spacing_top: QUICK_SECTION_SPACING, spacing_bottom: QUICK_SECTION_SPACING };

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
        section('slideshow', { layout: 'full', height: 'small', ...tight }, [block('slide', welcomeSlide(ctx))]),
        section('category-grid', { heading: 'Shop by category', columns: 8, ...tight }),
        section('product-rail', { heading: 'Bestsellers', source: 'bestsellers', limit: 12, ...tight }),
        section('product-rail', { heading: 'Top deals', source: 'discounted', limit: 12, ...tight }),
        section('multicolumn', { ...tight }, STUDIO_USPS.map((u) => block('column', u))),
        section('featured-products', { heading: 'Handpicked for you', source: 'all', limit: 24, columns: 6, ...tight }),
      ]),
      product: defaultTemplate('product'),
      // The old Quick store's category view: categories down the left, products beside them (its own heading).
      catalog: template([section('main-catalog', { layout: 'rail' })]),
    },
  };
}
