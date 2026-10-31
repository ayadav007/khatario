import type { StoreCategoryStyle, StoreFontFamily } from '@/lib/store/store-theme';
import { storeFontStack } from '@/lib/store/store-theme';
import { groceryCategoryEmoji } from '@/lib/store/grocery';
import { studioVars } from '@/lib/store/studio-layout';
import { schemeCssVars } from './color-schemes';
import { toStudioBox } from './studio-adapter';
import type { ColorScheme, Section, ThemeSettings } from './types';

// Server-side only: color-schemes and studio-adapter import the HTML sanitisers. Client code uses ./links.

type Style = Record<string, string | number | undefined>;

function fontStack(id: string): string {
  return storeFontStack(id as StoreFontFamily);
}

/** The Studio CSS names (`--paper`, `--text`, …) for a scheme, so Studio markup follows it. */
function studioSchemeVars(scheme: ColorScheme, withPrimary: boolean): Style {
  const vars = { ...(studioVars(scheme.accent, scheme.background) as Style) };
  vars['--text'] = scheme.text;
  vars['--st-card'] = scheme.card;
  if (!withPrimary) {
    delete vars['--primary'];
    delete vars['--on-primary'];
  }
  return vars;
}

/** Theme-level CSS variables on the engine root: scheme 1, Studio names, fonts and button radius. */
export function engineRootStyle(settings: ThemeSettings): Style {
  const scheme = settings.color_schemes[0];
  const body = fontStack(settings.font_body);
  return {
    ...(scheme ? studioSchemeVars(scheme, true) : {}),
    ...(scheme ? schemeCssVars(scheme, true) : {}),
    '--font-heading': fontStack(settings.font_heading),
    '--font-body': body,
    '--btn-radius': `${settings.button_radius}px`,
    fontFamily: body,
    backgroundColor: scheme?.background,
  };
}

/** The section wrapper's classes: `eng-sec`, plus `eng-sec--full` when the merchant chose full width. */
export function sectionFrameClass(settings: Record<string, unknown>): string {
  return settings.full_width === true ? 'eng-sec eng-sec--full' : 'eng-sec';
}

/**
 * A section's own style: its colour scheme as `--c-*` variables (scheme 1 when unset or unknown),
 * repainted with the scheme when one was chosen (background, text, cards and the scheme's accent as
 * `--primary`), plus its top/bottom spacing.
 */
export function sectionFrameStyle(settings: ThemeSettings, section: Section): Style {
  const schemes = settings.color_schemes;
  const index = section.color_scheme ? schemes.findIndex((s) => s.id === section.color_scheme) : -1;
  const custom = section.custom_colors && Object.keys(section.custom_colors).length ? section.custom_colors : null;
  // Custom colours sit over the section's scheme (scheme 1 on Default) and paint it like a chosen scheme.
  const base = schemes[index >= 0 ? index : 0];
  const scheme = base && custom ? { ...base, ...custom } : base;
  const painted = index >= 0 || !!custom;
  const style: Style = scheme ? { ...schemeCssVars(scheme, index <= 0 && !custom) } : {};
  if (scheme && painted) {
    Object.assign(style, studioSchemeVars(scheme, true));
    // A chosen scheme paints the whole section: the surfaces Studio tints from a fixed beige (hero panel, banner,
    // category tiles) come from the scheme too. On Default the preset keeps its own panels.
    style['--st-soft'] = `color-mix(in srgb, ${scheme.text} 4%, ${scheme.background})`;
    style['--st-tile'] = `color-mix(in srgb, ${scheme.text} 7%, ${scheme.background})`;
    style['--st-banner'] = `color-mix(in srgb, ${scheme.accent} 14%, ${scheme.background})`;
    style.background = scheme.background;
    style.color = scheme.text;
  }
  const box = toStudioBox(section);
  if (box.spacingTop !== undefined) style.paddingTop = box.spacingTop;
  if (box.spacingBottom !== undefined) style.paddingBottom = box.spacingBottom;
  return style;
}

/** The picked categories in their picked order, or all of them when none are picked. */
export function pickCategories<T extends { id: string }>(all: T[], picked: unknown): T[] {
  if (!Array.isArray(picked) || picked.length === 0) return all;
  const byId = new Map(all.map((c) => [c.id, c]));
  const out: T[] = [];
  for (const id of picked) {
    const c = typeof id === 'string' ? byId.get(id) : undefined;
    if (c) out.push(c);
  }
  return out;
}

/**
 * Engine category-grid style to the Studio tile style. Emoji tiles are icon tiles whose mark is the emoji, even
 * when categories have photos; the other styles show photos when there are any.
 */
export function engineCategoryStyle(style: unknown, hasImages: boolean): StoreCategoryStyle {
  if (style === 'emoji') return 'icon';
  if (hasImages) return 'photo';
  return style === 'cards' ? 'icon' : 'letter';
}

/** Wrapper class for the circles and cards looks (EngineShell styles them); tiles and emoji need none. */
export function categoryGridClass(style: unknown): string | undefined {
  return style === 'circles' || style === 'cards' ? `eng-cats--${style}` : undefined;
}

/**
 * Category id to tile photo: each category's own `image_url`, overridden by the section's enabled
 * `category_image` blocks (in block order). Blocks for categories not in the list are ignored.
 */
export function categoryImageMap(
  section: Section,
  categories: Array<{ id: string; image_url?: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Set<string>();
  for (const c of categories) {
    known.add(c.id);
    if (c.image_url) out[c.id] = c.image_url;
  }
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled || block.type !== 'category_image') continue;
    const category = block.settings?.category;
    const image = block.settings?.image;
    if (typeof category !== 'string' || !known.has(category)) continue;
    if (typeof image === 'string' && image) out[category] = image;
  }
  return out;
}

/** Category id to the short text in its tile mark: an emoji per category for the `emoji` style, else none. */
export function categoryMarks(categories: Array<{ id: string; name: string }>, style: unknown): Record<string, string> {
  if (style !== 'emoji') return {};
  const out: Record<string, string> = {};
  for (const c of categories) out[c.id] = groceryCategoryEmoji(c.name);
  return out;
}

/** Grid class for a product section's `mobile_columns` setting ('2' or '3'); none for the theme default. */
export function phoneColumnsClass(value: unknown): string | undefined {
  return value === '2' || value === '3' ? `mcols-${value}` : undefined;
}
