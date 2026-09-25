export type StoreCategoryStyle = 'letter' | 'icon' | 'photo';
export type StoreThemePreset = 'green' | 'saffron' | 'blue' | 'chowk' | 'atelier' | 'custom';
export type StoreThemePack = 'classic' | 'chowk' | 'atelier';

export interface StoreHeroSlide {
  image_url: string;
  title: string;
  subtitle: string;
}

export interface StoreTheme {
  accent: string;
  background: string;
  preset: StoreThemePreset;
  pack: StoreThemePack;
  logo_url: string;
  show_hero: boolean;
  show_offers: boolean;
  show_trust: boolean;
  category_style: StoreCategoryStyle;
  mobile_columns: 2 | 3;
  search_placeholder: string;
  hero_cta: string;
  hero_subtitle: string;
  hero_slides: StoreHeroSlide[];
  category_images: Record<string, string>;
}

/** Theme-owned ink. Merchant accent never replaces this. */
export const CHOWK_INK = '#1c1917';

export const STORE_THEME_PRESETS: Record<
  Exclude<StoreThemePreset, 'custom'>,
  { accent: string; background: string; label: string; pack: StoreThemePack }
> = {
  green: { accent: '#16a34a', background: '#f9fafb', label: 'Green', pack: 'classic' },
  saffron: { accent: '#ea580c', background: '#fff7ed', label: 'Saffron', pack: 'classic' },
  blue: { accent: '#2563eb', background: '#f8fafc', label: 'Blue', pack: 'classic' },
  chowk: { accent: '#e07030', background: '#f7f1e8', label: 'Chowk', pack: 'chowk' },
  atelier: { accent: '#171412', background: '#f6f3ef', label: 'Atelier', pack: 'atelier' },
};

export const DEFAULT_STORE_THEME: StoreTheme = {
  accent: STORE_THEME_PRESETS.green.accent,
  background: STORE_THEME_PRESETS.green.background,
  preset: 'green',
  pack: 'classic',
  logo_url: '',
  show_hero: true,
  show_offers: true,
  show_trust: true,
  category_style: 'letter',
  mobile_columns: 2,
  search_placeholder: '',
  hero_cta: 'Shop now',
  hero_subtitle: '',
  hero_slides: [],
  category_images: {},
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PRESETS: StoreThemePreset[] = ['green', 'saffron', 'blue', 'chowk', 'atelier', 'custom'];
const PACKS: StoreThemePack[] = ['classic', 'chowk', 'atelier'];
const STYLES: StoreCategoryStyle[] = ['letter', 'icon', 'photo'];
const ID_KEY = /^[a-zA-Z0-9_-]{1,64}$/;

function clip(s: unknown, max: number): string {
  return String(s ?? '').trim().slice(0, max);
}

export function clipStoreMediaUrl(value: unknown): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (v.startsWith('data:image/')) return v.slice(0, 1_800_000);
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v.slice(0, 2000);
  return '';
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  const v = String(value ?? '').trim();
  if (!HEX.test(v)) return fallback;
  return v.length === 4
    ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase()
    : v.toLowerCase();
}

export function sanitizeHeroSlides(raw: unknown): StoreHeroSlide[] {
  if (!Array.isArray(raw)) return [];
  const slides: StoreHeroSlide[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const image_url = clipStoreMediaUrl(row.image_url);
    const title = clip(row.title, 80);
    const subtitle = clip(row.subtitle, 160);
    if (!image_url && !title && !subtitle) continue;
    slides.push({ image_url, title, subtitle });
  }
  return slides;
}

export function resolveHeroSlides(
  theme: StoreTheme,
  fallback: { image_url?: string | null; title?: string | null; subtitle?: string | null },
): StoreHeroSlide[] {
  if (theme.hero_slides.length > 0) return theme.hero_slides;
  const image_url = clipStoreMediaUrl(fallback.image_url);
  const title = clip(fallback.title, 80);
  const subtitle = clip(fallback.subtitle ?? theme.hero_subtitle, 160);
  if (!image_url && !title && !subtitle) return [];
  return [{ image_url, title, subtitle }];
}

function sanitizeCategoryImages(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!ID_KEY.test(key) || Object.keys(out).length >= 40) continue;
    const url = clipStoreMediaUrl(val);
    if (url) out[key] = url;
  }
  return out;
}

function resolvePack(preset: StoreThemePreset, rawPack: unknown): StoreThemePack {
  if (preset === 'chowk') return 'chowk';
  if (preset === 'atelier') return 'atelier';
  if (preset === 'custom') {
    return PACKS.includes(rawPack as StoreThemePack) ? (rawPack as StoreThemePack) : 'classic';
  }
  return 'classic';
}

export function isChowkPack(theme: StoreTheme): boolean {
  return theme.pack === 'chowk';
}

export function isAtelierPack(theme: StoreTheme): boolean {
  return theme.pack === 'atelier';
}

export function hexLuminance(hex: string): number {
  const raw = hex.replace('#', '');
  const n =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (n.length !== 6) return 1;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink that stays readable on a merchant-chosen paper colour. */
export function chowkInkOn(background: string): string {
  return hexLuminance(background) > 0.42 ? CHOWK_INK : '#f4efe6';
}

export function chowkOnAccent(accent: string): string {
  return hexLuminance(accent) > 0.55 ? CHOWK_INK : '#f4efe6';
}

export function sanitizeStoreTheme(raw: unknown): StoreTheme {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const preset = PRESETS.includes(src.preset as StoreThemePreset)
    ? (src.preset as StoreThemePreset)
    : 'custom';
  const presetColors =
    preset !== 'custom' ? STORE_THEME_PRESETS[preset] : null;
  const accent = normalizeHexColor(
    src.accent,
    presetColors?.accent ?? DEFAULT_STORE_THEME.accent,
  );
  const background = normalizeHexColor(
    src.background,
    presetColors?.background ?? DEFAULT_STORE_THEME.background,
  );
  const cols = Number(src.mobile_columns);
  const category_style = STYLES.includes(src.category_style as StoreCategoryStyle)
    ? (src.category_style as StoreCategoryStyle)
    : DEFAULT_STORE_THEME.category_style;

  return {
    accent: presetColors && preset !== 'custom' ? presetColors.accent : accent,
    background:
      presetColors && preset !== 'custom' ? presetColors.background : background,
    preset,
    pack: resolvePack(preset, src.pack),
    logo_url: clipStoreMediaUrl(src.logo_url),
    show_hero: src.show_hero !== false,
    show_offers: src.show_offers !== false,
    show_trust: src.show_trust !== false,
    category_style,
    mobile_columns: cols === 3 ? 3 : 2,
    search_placeholder: clip(src.search_placeholder, 80),
    hero_cta: clip(src.hero_cta, 32) || DEFAULT_STORE_THEME.hero_cta,
    hero_subtitle: clip(src.hero_subtitle, 160),
    hero_slides: sanitizeHeroSlides(src.hero_slides),
    category_images: sanitizeCategoryImages(src.category_images),
  };
}

export function applyStorePreset(preset: Exclude<StoreThemePreset, 'custom'>): Partial<StoreTheme> {
  const p = STORE_THEME_PRESETS[preset];
  if (preset === 'atelier') {
    return {
      preset,
      accent: p.accent,
      background: p.background,
      pack: p.pack,
      hero_cta: 'Explore Collection',
      search_placeholder: 'Search jackets, cashmere, accessories…',
    };
  }
  return { preset, accent: p.accent, background: p.background, pack: p.pack };
}

export function storeThemeFingerprint(theme: StoreTheme): string {
  return JSON.stringify(theme);
}
