import type { Block, Section, Template, ThemeSettings } from '../types';
import { sanitizeColorSchemes } from '../color-schemes';
import type { PresetContext } from './index';

export function presetSettings(ctx: PresetContext): ThemeSettings {
  return {
    color_schemes: sanitizeColorSchemes(undefined, ctx.accent),
    font_heading: 'outfit',
    font_body: 'inter',
    button_radius: 10,
    card_style: 'bordered',
    phone_kit: true,
    logo_url: ctx.logoUrl ?? '',
    favicon_url: '',
    custom_css: '',
    social: { instagram: '', whatsapp: '', facebook: '', youtube: '' },
  };
}

export function block(type: string, settings: Record<string, unknown>): Block {
  return { type, settings };
}

/** Block ids are `<blocktype>-<n>` (underscores become dashes), so they are deterministic. */
export function section(type: string, settings: Record<string, unknown>, blocks: Block[] = []): Section {
  const out: Section = { type, settings, blocks: {}, block_order: [] };
  const counts: Record<string, number> = {};
  for (const b of blocks) {
    counts[b.type] = (counts[b.type] ?? 0) + 1;
    const id = `${b.type.replace(/_/g, '-')}-${counts[b.type]}`;
    out.blocks[id] = b;
    out.block_order.push(id);
  }
  return out;
}

/** Section id is the section type. */
export function template(sections: Section[]): Template {
  return {
    order: sections.map((s) => s.type),
    sections: Object.fromEntries(sections.map((s) => [s.type, s])),
  };
}
