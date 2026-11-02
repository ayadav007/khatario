// Client-safe: no server imports. The engine shell's root classes (D27), the phone kit rule (D29) and the root's
// theme variables.
import { storeFontStack, type StoreFontFamily } from '@/lib/store/store-theme';
import { schemeCssVars, studioSchemeVars } from './color-schemes';
import type { ThemePreset, ThemeSettings } from './types';

const PRESETS: readonly ThemePreset[] = ['studio', 'quick', 'grocery', 'khatario', 'blank', 'heritage', 'drop'];

// Each non-default style setting is one root class; the rules live in components/store/engine/style-rules.ts.
const STYLE_CLASSES: { [K in 'label_style' | 'frame_style' | 'texture']: Readonly<Record<string, string>> } = {
  label_style: { caps: 'eng-labels-caps' },
  frame_style: { accent: 'eng-frame-accent' },
  texture: { dots: 'eng-texture-dots', linen: 'eng-texture-linen', grid: 'eng-texture-grid' },
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** True when the colour is a hex colour with luminance < 0.4 (the old `storePackClass` test); anything else is light. */
export function isDarkHex(hex: string): boolean {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return false;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

/**
 * `st-root store-studio st-cq eng-root eng-preset-<preset>`, plus `store-quick` on Quick (quick-theme.css
 * restyles the Studio markup under it), `is-dark` when scheme 1's background is dark, `phone-kit` and
 * `eng-editor`, and one class per non-default style setting (`eng-labels-caps`, `eng-frame-accent`,
 * `eng-texture-<texture>`; unknown values add nothing), and `eng-heading-anton` when the heading font is Anton. The phone kit is always on in the Quick preset.
 */
export function engineRootClass(input: {
  preset: ThemePreset;
  phoneKit: boolean;
  editor: boolean;
  schemeBackground: string | undefined;
  style: Pick<ThemeSettings, 'label_style' | 'frame_style' | 'texture'>;
  /** The theme's heading font id; `anton` (one weight only) adds `eng-heading-anton`, which stops browser-made bold. */
  headingFont?: string;
}): { className: string; kit: boolean; quick: boolean } {
  const preset: ThemePreset = PRESETS.includes(input.preset) ? input.preset : 'studio';
  const quick = preset === 'quick';
  const kit = quick || input.phoneKit === true;
  const list = ['st-root', 'store-studio', 'st-cq', 'eng-root', `eng-preset-${preset}`];
  if (quick) list.push('store-quick');
  if (input.schemeBackground && isDarkHex(input.schemeBackground)) list.push('is-dark');
  if (kit) list.push('phone-kit');
  if (input.editor) list.push('eng-editor');
  if (input.headingFont === 'anton') list.push('eng-heading-anton');
  for (const key of Object.keys(STYLE_CLASSES) as (keyof typeof STYLE_CLASSES)[]) {
    const cls = Object.prototype.hasOwnProperty.call(STYLE_CLASSES[key], input.style?.[key]) ? STYLE_CLASSES[key][input.style[key]] : undefined;
    if (cls) list.push(cls);
  }
  return { className: list.join(' '), kit, quick };
}

function fontStack(id: string): string {
  return storeFontStack(id as StoreFontFamily);
}

/** Theme-level CSS variables on the engine root: scheme 1, Studio names, fonts and button radius. */
export function engineRootStyle(settings: ThemeSettings): Record<string, string | number | undefined> {
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
