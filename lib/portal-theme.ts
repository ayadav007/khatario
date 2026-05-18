/**
 * Organization portal appearance (web shell). Stored in business_settings.portal_theme.
 * Keep parsing isomorphic — DOM application lives in PortalThemeSync.
 */

export const PORTAL_FONT_PRESETS = ['inter', 'system', 'dm_sans', 'source_sans'] as const;
export type PortalFontPreset = (typeof PORTAL_FONT_PRESETS)[number];

export interface PortalTheme {
  primary_hex: string;
  /** Secondary brand tone (buttons/sections using `accent-*`). */
  accent_hex: string;
  font_preset: PortalFontPreset;
}

/** Product defaults: primary teal + accent teal (matches pre-theme Tailwind). */
export const DEFAULT_PORTAL_THEME: PortalTheme = {
  primary_hex: '#0d9488',
  accent_hex: '#00796b',
  font_preset: 'inter',
};

export const DEFAULT_PRIMARY_VARS: Record<string, string> = {
  '--color-primary-50': '#ecfdf5',
  '--color-primary-100': '#ccfbf1',
  '--color-primary-200': '#99f6e4',
  '--color-primary-300': '#5eead4',
  '--color-primary-400': '#2dd4bf',
  '--color-primary-500': '#0d9488',
  '--color-primary-600': '#115e59',
  '--color-primary-700': '#0f4f4a',
  '--color-primary-800': '#0f3d39',
  '--color-primary-900': '#052e2b',
};

export const DEFAULT_ACCENT_VARS: Record<string, string> = {
  '--color-accent-50': '#E0F2F1',
  '--color-accent-100': '#B2DFDB',
  '--color-accent-200': '#80CBC4',
  '--color-accent-300': '#4DB6AC',
  '--color-accent-400': '#26A69A',
  '--color-accent-500': '#00897B',
  '--color-accent-600': '#00796B',
  '--color-accent-700': '#00695C',
  '--color-accent-800': '#004D40',
  '--color-accent-900': '#003D32',
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function mixRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number
): { r: number; g: number; b: number } {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Build 50..900 scale as CSS custom properties --color-{role}-* */
function brandHexToCssVars(
  role: 'primary' | 'accent',
  hex: string,
  fallbacks: Record<string, string>
): Record<string, string> {
  const base = hexToRgb(hex);
  if (!base) return { ...fallbacks };

  const W = { r: 255, g: 255, b: 255 };
  const K = { r: 0, g: 0, b: 0 };
  const prefix = `--color-${role}`;

  const pairs: [number, number][] = [
    [50, 0.93],
    [100, 0.85],
    [200, 0.68],
    [300, 0.48],
    [400, 0.26],
    [500, 0],
    [600, -0.14],
    [700, -0.28],
    [800, -0.42],
    [900, -0.55],
  ];

  const out: Record<string, string> = {};
  for (const [shade, t] of pairs) {
    const key = `${prefix}-${shade}`;
    if (t === 0) {
      out[key] = rgbToHex(base.r, base.g, base.b);
    } else if (t < 0) {
      const m = mixRgb(base, K, Math.abs(t));
      out[key] = rgbToHex(m.r, m.g, m.b);
    } else if (t >= 1) {
      out[key] = rgbToHex(W.r, W.g, W.b);
    } else {
      const m = mixRgb(W, base, t);
      out[key] = rgbToHex(m.r, m.g, m.b);
    }
  }
  return out;
}

export function primaryHexToCssVars(hex: string): Record<string, string> {
  return brandHexToCssVars('primary', hex, DEFAULT_PRIMARY_VARS);
}

export function accentHexToCssVars(hex: string): Record<string, string> {
  return brandHexToCssVars('accent', hex, DEFAULT_ACCENT_VARS);
}

const FONT_STACKS: Record<PortalFontPreset, string> = {
  inter: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  system:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  dm_sans: 'var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif',
  source_sans: 'var(--font-source-sans), ui-sans-serif, system-ui, sans-serif',
};

export function portalThemeToCssVars(theme: PortalTheme): Record<string, string> {
  return {
    ...primaryHexToCssVars(theme.primary_hex),
    ...accentHexToCssVars(theme.accent_hex),
    '--portal-font-sans': FONT_STACKS[theme.font_preset] ?? FONT_STACKS.inter,
  };
}

/** Accept #RGB or #RRGGBB (case-insensitive). Returns #rrggbb or null. */
export function parseHexColorInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let body = s.startsWith('#') ? s.slice(1) : s;
  if (/^[0-9a-f]{3}$/i.test(body)) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(body)) return null;
  return `#${body.toLowerCase()}`;
}

export function normalizePortalThemeJson(raw: unknown): PortalTheme | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const primary = typeof o.primary_hex === 'string' ? parseHexColorInput(o.primary_hex) : null;
  if (!primary) return null;
  const presetRaw = typeof o.font_preset === 'string' ? o.font_preset.trim() : '';
  const preset = PORTAL_FONT_PRESETS.includes(presetRaw as PortalFontPreset)
    ? (presetRaw as PortalFontPreset)
    : 'inter';
  let accent = typeof o.accent_hex === 'string' ? parseHexColorInput(o.accent_hex) : null;
  if (!accent) accent = DEFAULT_PORTAL_THEME.accent_hex;
  return { primary_hex: primary, accent_hex: accent, font_preset: preset };
}

/** Merge stored JSON with defaults for API/session responses. */
export function mergePortalTheme(stored: unknown): PortalTheme {
  const parsed = normalizePortalThemeJson(stored);
  if (!parsed) return { ...DEFAULT_PORTAL_THEME };
  return { ...parsed };
}

export function applyPortalThemeToElement(el: HTMLElement, theme: PortalTheme | null): void {
  const effective = theme ?? DEFAULT_PORTAL_THEME;
  const vars = portalThemeToCssVars(effective);
  for (const [k, v] of Object.entries(vars)) {
    el.style.setProperty(k, v);
  }
}

export function clearPortalThemeFromElement(el: HTMLElement): void {
  for (const key of Object.keys(DEFAULT_PRIMARY_VARS)) {
    el.style.removeProperty(key);
  }
  for (const key of Object.keys(DEFAULT_ACCENT_VARS)) {
    el.style.removeProperty(key);
  }
  el.style.removeProperty('--portal-font-sans');
}
