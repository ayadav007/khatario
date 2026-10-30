import type { StoreCategoryStyle, StoreFontFamily } from '@/lib/store/store-theme';
import { storeFontStack } from '@/lib/store/store-theme';
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
 * repainted with the scheme when one was chosen, plus its top/bottom spacing.
 * `--primary` stays scheme 1's accent unless the section uses scheme 1.
 */
export function sectionFrameStyle(settings: ThemeSettings, section: Section): Style {
  const schemes = settings.color_schemes;
  const index = section.color_scheme ? schemes.findIndex((s) => s.id === section.color_scheme) : -1;
  const scheme = schemes[index >= 0 ? index : 0];
  const style: Style = scheme ? { ...schemeCssVars(scheme, index <= 0) } : {};
  if (scheme && index >= 0) {
    Object.assign(style, studioSchemeVars(scheme, index === 0));
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

/** Engine category-grid style to the Studio tile style. */
export function engineCategoryStyle(style: unknown, hasImages: boolean): StoreCategoryStyle {
  if (hasImages) return 'photo';
  return style === 'cards' ? 'icon' : 'letter';
}
