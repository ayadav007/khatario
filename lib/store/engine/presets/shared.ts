import type { Block, Section, Template } from '../types';
import type { PresetContext } from './index';

export { presetSettings } from './look';

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

/** A section painted with one of the theme's colour schemes. */
export function onScheme(s: Section, scheme: string): Section {
  return { ...s, color_scheme: scheme };
}

/** The hero slide presets start from: a welcome line, the tagline, the hero image and a link to the catalog grid. */
export function welcomeSlide(ctx: PresetContext, buttonText = 'Shop now'): Record<string, unknown> {
  const slide: Record<string, unknown> = {
    heading: `Welcome to ${ctx.businessName.trim()}`.slice(0, 120).trim(),
    description: ctx.tagline.trim().slice(0, 300).trim(),
    button_text: buttonText,
    link: '#catalog',
  };
  if (ctx.heroUrl) slide.image = ctx.heroUrl;
  return slide;
}

/**
 * D30: a section's id is its type; a repeated type gets `-2`, `-3` and so on, so ids stay unique and
 * deterministic (two `product-rail`s become `product-rail` and `product-rail-2`).
 */
export function template(sections: Section[]): Template {
  const counts: Record<string, number> = {};
  const out: Template = { order: [], sections: {} };
  for (const s of sections) {
    counts[s.type] = (counts[s.type] ?? 0) + 1;
    const id = counts[s.type] === 1 ? s.type : `${s.type}-${counts[s.type]}`;
    out.order.push(id);
    out.sections[id] = s;
  }
  return out;
}
