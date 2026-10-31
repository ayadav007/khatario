import type { Section, ThemeData } from '../types';
import { engineSection, textToParagraphs } from '../migrate-studio';
import type { PresetContext } from './index';
import { block, onScheme, presetSettings, section, template, welcomeSlide } from './shared';
import { studioFooter } from './studio';
import { defaultTemplate } from './templates';

/**
 * The tagline line the old Khatario home shows after the hero (StoreCatalogView), or null without a tagline.
 * Shared by this preset and the migration (migrate-packs.ts).
 */
export function khatarioTaglineSection(tagline: string): Section | null {
  const text = tagline.trim();
  if (!text) return null;
  return {
    ...engineSection('rich-text', { align: 'left', spacing_top: 12, spacing_bottom: 0 }, [{ type: 'text', settings: { content: textToParagraphs(text) } }]),
    label: 'Tagline',
  };
}

/** Khatario: accent announcement and header, a full-width carousel, category pills, popular products and the grid. */
export function khatarioPreset(ctx: PresetContext): ThemeData {
  const headerSettings: Record<string, unknown> = { search_placeholder: 'Search for items…' };
  if (ctx.logoUrl) headerSettings.logo_url = ctx.logoUrl;
  const tagline = khatarioTaglineSection(ctx.tagline);

  return {
    settings: presetSettings(ctx, 'khatario'),
    header_group: template([
      onScheme(section('announcement', { text: ctx.tagline.trim().slice(0, 200).trim() }), 'scheme-4'),
      onScheme(
        section('header', headerSettings, [
          block('menu_link', { label: 'All Products', link: '/catalog' }),
          block('menu_link', { label: 'Offers', link: '/catalog?disc=10' }),
          block('menu_link', { label: 'Contact', link: '/contact' }),
        ]),
        'scheme-4',
      ),
    ]),
    footer_group: template([studioFooter()]),
    templates: {
      home: template([
        section('slideshow', { layout: 'full', height: 'medium' }, [block('slide', welcomeSlide(ctx, 'Order now'))]),
        ...(tagline ? [tagline] : []),
        section('category-grid', { heading: '', style: 'tiles' }),
        section('product-rail', { heading: 'Popular products', source: 'all', limit: 6 }),
        section('featured-products', { heading: 'All products', source: 'all', limit: 24, columns: 4 }),
      ]),
      product: defaultTemplate('product'),
      catalog: defaultTemplate('catalog'),
    },
  };
}
