export type StoreCategoryStyle = 'letter' | 'icon' | 'photo';
export type StoreThemePreset = 'green' | 'saffron' | 'blue' | 'custom';

export interface StoreHeroSlide {
  image_url: string;
  title: string;
  subtitle: string;
}

export interface StoreTheme {
  accent: string;
  background: string;
  preset: StoreThemePreset;
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

export const STORE_THEME_PRESETS: Record<
  Exclude<StoreThemePreset, 'custom'>,
  { accent: string; background: string; label: string }
> = {
  green: { accent: '#16a34a', background: '#f9fafb', label: 'Green' },
  saffron: { accent: '#ea580c', background: '#fff7ed', label: 'Saffron' },
  blue: { accent: '#2563eb', background: '#f8fafc', label: 'Blue' },
};

export const DEFAULT_STORE_THEME: StoreTheme = {
  accent: STORE_THEME_PRESETS.green.accent,
  background: STORE_THEME_PRESETS.green.background,
  preset: 'green',
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
const PRESETS: StoreThemePreset[] = ['green', 'saffron', 'blue', 'custom'];
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
  return { preset, accent: p.accent, background: p.background };
}

export function storeThemeFingerprint(theme: StoreTheme): string {
  return JSON.stringify(theme);
}
