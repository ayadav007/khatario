import type { ThemeData } from '../types';
import type { PresetContext } from './index';
import { block, presetSettings, section, template } from './shared';
import { defaultTemplate } from './templates';

export function blankPreset(ctx: PresetContext): ThemeData {
  const headerSettings: Record<string, unknown> = {};
  if (ctx.logoUrl) headerSettings.logo_url = ctx.logoUrl;
  return {
    settings: presetSettings(ctx),
    header_group: template([section('header', headerSettings, [block('menu_link', { label: 'All Products', link: '/catalog' })])]),
    footer_group: template([section('footer', { badge: true })]),
    templates: {
      home: template([]),
      product: defaultTemplate('product'),
      catalog: defaultTemplate('catalog'),
    },
  };
}
