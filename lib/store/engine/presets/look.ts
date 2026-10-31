import type { ColorScheme, ThemePreset, ThemeSettings } from '../types';
import { DEFAULT_COLOR_SCHEMES } from '../color-schemes';
import { isHexColor } from '../settings';
import { PACK_CANVAS, STORE_THEME_PRESETS, chowkInkOn, chowkOnAccent, hexLuminance } from '@/lib/store/store-theme';
import type { PresetContext } from './index';

export interface PresetLook {
  canvas: string;
  accent: string;
  font_heading: string;
  font_body: string;
  button_radius: number;
  card_style: ThemeSettings['card_style'];
}

const STUDIO_LOOK: PresetLook = {
  canvas: PACK_CANVAS.studio,
  accent: STORE_THEME_PRESETS.studio.accent,
  font_heading: 'outfit',
  font_body: 'inter',
  button_radius: 10,
  card_style: 'bordered',
};

/** D26: each old pack's paper, accent, fonts, corners and cards. */
export const PRESET_LOOK: Record<ThemePreset, PresetLook> = {
  studio: STUDIO_LOOK,
  blank: STUDIO_LOOK,
  quick: { canvas: PACK_CANVAS.quick, accent: STORE_THEME_PRESETS.quick.accent, font_heading: 'inter', font_body: 'inter', button_radius: 14, card_style: 'shadow' },
  grocery: { canvas: PACK_CANVAS.grocery, accent: STORE_THEME_PRESETS.grocery.accent, font_heading: 'inter', font_body: 'inter', button_radius: 24, card_style: 'bordered' },
  khatario: { canvas: PACK_CANVAS.khatario, accent: STORE_THEME_PRESETS.khatario.accent, font_heading: 'inter', font_body: 'inter', button_radius: 12, card_style: 'plain' },
};

const RGB_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgb(hex: string): [number, number, number] {
  if (!RGB_RE.test(hex)) throw new Error(`mixHex expects #rgb or #rrggbb, got ${hex}`);
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `weightA` of `a` mixed with the rest of `b`, channel by channel, rounded half up. */
export function mixHex(a: string, b: string, weightA: number): string {
  const w = Math.min(1, Math.max(0, Number.isFinite(weightA) ? weightA : 0));
  const ca = rgb(a);
  const cb = rgb(b);
  return `#${ca
    .map((v, i) => Math.floor(v * w + cb[i] * (1 - w) + 0.5))
    .map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** WCAG contrast ratio of two #rgb / #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = rgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The brand accent, moved toward white (dark paper) or black (light paper) until it reads at 3:1 on `paper`. */
export function readableAccent(accent: string, paper: string): string {
  if (contrastRatio(accent, paper) >= 3) return accent;
  const toward = contrastRatio('#ffffff', paper) > contrastRatio('#000000', paper) ? '#ffffff' : '#000000';
  for (let w = 0.9; w > 0; w -= 0.1) {
    const c = mixHex(accent, toward, w);
    if (contrastRatio(c, paper) >= 3) return c;
  }
  return toward;
}

function validRgb(v: string | undefined): v is string {
  return typeof v === 'string' && RGB_RE.test(v) && isHexColor(v);
}

/** The six colour schemes of a preset (D26), built from its paper and the store's accent. */
export function schemesFor(preset: ThemePreset, accent: string | undefined, canvas?: string): ColorScheme[] {
  const look = PRESET_LOOK[preset] ?? STUDIO_LOOK;
  const a = validRgb(accent) ? accent : look.accent;
  const bg = validRgb(canvas) ? canvas : look.canvas;
  const text = chowkInkOn(bg);
  const onAccent = chowkOnAccent(a);
  // Same test as chowkInkOn: a canvas that takes light ink is dark.
  const dark = hexLuminance(bg) <= 0.42;
  const out = DEFAULT_COLOR_SCHEMES.map((s) => ({ ...s }));
  out[0] = {
    ...out[0],
    background: bg,
    text,
    accent: a,
    button: a,
    button_text: onAccent,
    border: mixHex(text, bg, 0.12),
    card: dark ? mixHex('#ffffff', bg, 0.06) : '#ffffff',
  };
  // Soft, Dark and Cream take the store's accent (made readable on their paper) instead of a generic blue, so a
  // section on one of them keeps the brand colour on its eyebrows, links and highlights.
  for (const i of [1, 2, 4]) {
    const accentOn = readableAccent(a, out[i].background);
    out[i] = { ...out[i], accent: accentOn };
    if (i !== 1) out[i] = { ...out[i], button: accentOn, button_text: chowkOnAccent(accentOn) };
  }
  out[3] = {
    ...out[3],
    background: a,
    text: onAccent,
    accent: onAccent,
    button: onAccent,
    button_text: a,
    border: mixHex(onAccent, a, 0.2),
    card: mixHex(onAccent, a, 0.08),
  };
  if (preset === 'grocery') {
    out[5] = {
      ...out[5],
      name: 'Deep green',
      background: mixHex(a, '#07140d', 0.3),
      text: '#ffffffe0',
      accent: '#fbbf24',
      button: '#fbbf24',
      button_text: '#07140d',
      border: mixHex('#ffffff', mixHex(a, '#07140d', 0.3), 0.12),
      card: mixHex('#ffffff', mixHex(a, '#07140d', 0.3), 0.06),
    };
  }
  return out;
}

export function presetSettings(ctx: PresetContext, preset: ThemePreset = 'studio'): ThemeSettings {
  const look = PRESET_LOOK[preset] ?? STUDIO_LOOK;
  return {
    color_schemes: schemesFor(preset, ctx.accent),
    font_heading: look.font_heading,
    font_body: look.font_body,
    button_radius: look.button_radius,
    card_style: look.card_style,
    phone_kit: true,
    logo_url: ctx.logoUrl ?? '',
    favicon_url: '',
    custom_css: '',
    social: { instagram: '', whatsapp: '', facebook: '', youtube: '' },
    menus: [],
  };
}
