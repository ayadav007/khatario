import { sanitizeStudioSections, type StudioSection } from './studio-sections';

export type StoreCategoryStyle = 'letter' | 'icon' | 'photo';
export type StoreThemePreset = 'studio' | 'khatario' | 'grocery' | 'custom';
export type StoreThemePack = 'studio' | 'khatario' | 'grocery';
export type StoreAppearanceMode = 'light' | 'dim' | 'dark';
export type StoreHeroViewport = 'both' | 'mobile' | 'desktop';
export type StoreAnnouncementAlign = 'left' | 'center' | 'right';
export type StoreFormFieldMode = 'required' | 'optional' | 'off';

export type StoreContactLayout = 'stacked' | 'text-form' | 'form-text';
export type StoreContactWidth = 'narrow' | 'medium' | 'wide';
export type StoreContactStyle = 'card' | 'plain' | 'filled';

export interface StoreContactForm {
  enabled: boolean;
  title: string;
  intro: string;
  phone: StoreFormFieldMode;
  email: StoreFormFieldMode;
  /** Empty list hides the topic dropdown; otherwise a topic must be chosen. */
  topics: string[];
  message_placeholder: string;
  button: string;
  success: string;
  layout: StoreContactLayout;
  /** Only used by the stacked layout. */
  align: StoreAnnouncementAlign;
  width: StoreContactWidth;
  style: StoreContactStyle;
  labels_inside: boolean;
  button_full: boolean;
  /** Call / WhatsApp / Email buttons beside the contact details; independent of `enabled`. */
  quick_links: boolean;
}
export type StoreHomepageSectionId =
  | 'hero'
  | 'categories'
  | 'featured'
  | 'offers'
  | 'product_shelves'
  | 'category_shelves'
  | 'overlay'
  | 'testimonials'
  | 'brand_story'
  | 'trust'
  | 'catalog';

export interface StoreHeroSlide {
  image_url: string;
  title: string;
  subtitle: string;
  viewport: StoreHeroViewport;
}

export interface StoreHomepageSection {
  id: StoreHomepageSectionId;
  enabled: boolean;
}

export type StoreProductShelfKind = 'discounted' | 'price_max';

export interface StoreProductShelf {
  id: string;
  title: string;
  enabled: boolean;
  kind: StoreProductShelfKind;
  price_max: number;
}

export interface StoreTestimonial {
  name: string;
  text: string;
  photo_url: string;
}

export interface StoreOverlayBand {
  image_url: string;
  caption: string;
  cta: string;
}

export const STORE_FONT_FAMILIES = [
  'system',
  'inter',
  'fraunces',
  'nunito',
  'playfair',
  'outfit',
  'cormorant',
  'source-serif',
] as const;

export type StoreFontFamily = (typeof STORE_FONT_FAMILIES)[number];

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
  appearance_mode: StoreAppearanceMode;
  show_store_name: boolean;
  favicon_url: string;
  show_listing_add: boolean;
  sticky_buy_now: boolean;
  font_family: StoreFontFamily;
  custom_css: string;
  announcement: string;
  /** Optional URL the announcement bar links to. */
  announcement_link: string;
  /** Empty = theme default colours. */
  announcement_bg: string;
  announcement_fg: string;
  announcement_align: StoreAnnouncementAlign;
  /** When no custom text is set, Chowk shows an automatic offer/tagline line. */
  announcement_auto: boolean;
  contact_form: StoreContactForm;
  featured_item_id: string;
  homepage_sections: StoreHomepageSection[];
  product_shelves: StoreProductShelf[];
  testimonials: StoreTestimonial[];
  overlay_bands: StoreOverlayBand[];
  brand_story: string;
  instagram_url: string;
  whatsapp_url: string;
  /** Studio pack home layout, in order. Empty until first customised in Studio. */
  studio_sections: StudioSection[];
}

/** Theme-owned ink. Merchant accent never replaces this. */
export const CHOWK_INK = '#1c1917';

/** Pack-owned page paper in light mode. Brand colour never paints the body. */
export const PACK_CANVAS: Record<StoreThemePack, string> = {
  studio: '#fbf8f3',
  khatario: '#f4f5f7',
  grocery: '#f6f7f4',
};

export const PACK_CANVAS_MODE: Record<StoreThemePack, Record<StoreAppearanceMode, string>> = {
  studio: { light: '#fbf8f3', dim: '#ece6dc', dark: '#131210' },
  khatario: { light: '#f4f5f7', dim: '#e4e7eb', dark: '#111827' },
  grocery: { light: '#f6f7f4', dim: '#e6eae3', dark: '#101a14' },
};

export const STORE_THEME_PRESETS: Record<
  Exclude<StoreThemePreset, 'custom'>,
  { accent: string; background: string; label: string; pack: StoreThemePack }
> = {
  studio: { accent: '#b94717', background: PACK_CANVAS.studio, label: 'Studio', pack: 'studio' },
  khatario: { accent: '#00897b', background: PACK_CANVAS.khatario, label: 'Khatario', pack: 'khatario' },
  grocery: { accent: '#176b45', background: PACK_CANVAS.grocery, label: 'Premium Grocery', pack: 'grocery' },
};

export const DEFAULT_HOMEPAGE_SECTIONS: StoreHomepageSection[] = [
  { id: 'hero', enabled: true },
  { id: 'categories', enabled: true },
  { id: 'featured', enabled: false },
  { id: 'offers', enabled: true },
  { id: 'product_shelves', enabled: false },
  { id: 'category_shelves', enabled: false },
  { id: 'overlay', enabled: false },
  { id: 'testimonials', enabled: false },
  { id: 'brand_story', enabled: false },
  { id: 'trust', enabled: true },
  { id: 'catalog', enabled: true },
];

export const DEFAULT_CONTACT_FORM: StoreContactForm = {
  enabled: false,
  title: 'Send us a message',
  intro: '',
  phone: 'required',
  email: 'optional',
  topics: [],
  message_placeholder: '',
  button: 'Send message',
  success: 'Thanks! We have received your message and will get back to you soon.',
  layout: 'stacked',
  align: 'left',
  width: 'medium',
  style: 'card',
  labels_inside: false,
  button_full: true,
  quick_links: false,
};

export function storeCanvas(theme: Pick<StoreTheme, 'pack'> & { appearance_mode?: StoreAppearanceMode }): string {
  const mode = theme.appearance_mode ?? 'light';
  return PACK_CANVAS_MODE[theme.pack]?.[mode] ?? PACK_CANVAS[theme.pack] ?? PACK_CANVAS.studio;
}

export const DEFAULT_STORE_THEME: StoreTheme = {
  accent: STORE_THEME_PRESETS.studio.accent,
  background: STORE_THEME_PRESETS.studio.background,
  preset: 'studio',
  pack: 'studio',
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
  appearance_mode: 'light',
  show_store_name: true,
  favicon_url: '',
  show_listing_add: true,
  sticky_buy_now: true,
  font_family: 'system',
  custom_css: '',
  announcement: '',
  announcement_link: '',
  announcement_bg: '',
  announcement_fg: '',
  announcement_align: 'center',
  announcement_auto: true,
  contact_form: DEFAULT_CONTACT_FORM,
  featured_item_id: '',
  homepage_sections: DEFAULT_HOMEPAGE_SECTIONS,
  product_shelves: [],
  testimonials: [],
  overlay_bands: [],
  brand_story: '',
  instagram_url: '',
  whatsapp_url: '',
  studio_sections: [],
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PRESETS: StoreThemePreset[] = ['studio', 'khatario', 'grocery', 'custom'];
const PACKS: StoreThemePack[] = ['studio', 'khatario', 'grocery'];
const STYLES: StoreCategoryStyle[] = ['letter', 'icon', 'photo'];
const MODES: StoreAppearanceMode[] = ['light', 'dim', 'dark'];
const VIEWPORTS: StoreHeroViewport[] = ['both', 'mobile', 'desktop'];
const ANNOUNCE_ALIGNS: StoreAnnouncementAlign[] = ['left', 'center', 'right'];
const SECTION_IDS: StoreHomepageSectionId[] = DEFAULT_HOMEPAGE_SECTIONS.map((s) => s.id);
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
    const viewport = VIEWPORTS.includes(row.viewport as StoreHeroViewport)
      ? (row.viewport as StoreHeroViewport)
      : 'both';
    if (!image_url && !title && !subtitle) continue;
    slides.push({ image_url, title, subtitle, viewport });
  }
  return slides;
}

export function resolveHeroSlides(
  theme: StoreTheme,
  fallback: { image_url?: string | null; title?: string | null; subtitle?: string | null },
  device: 'mobile' | 'desktop' = 'desktop',
): StoreHeroSlide[] {
  const match = (s: StoreHeroSlide) => s.viewport === 'both' || s.viewport === device;
  const filtered = theme.hero_slides.filter(match);
  if (filtered.length > 0) return filtered;
  if (theme.hero_slides.length > 0) return theme.hero_slides;
  const image_url = clipStoreMediaUrl(fallback.image_url);
  const title = clip(fallback.title, 80);
  const subtitle = clip(fallback.subtitle ?? theme.hero_subtitle, 160);
  if (!image_url && !title && !subtitle) return [];
  return [{ image_url, title, subtitle, viewport: 'both' }];
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

export function sanitizeHomepageSections(raw: unknown, flags: { show_hero: boolean; show_offers: boolean; show_trust: boolean }): StoreHomepageSection[] {
  const byId = new Map<StoreHomepageSectionId, boolean>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = row.id as StoreHomepageSectionId;
      if (!SECTION_IDS.includes(id) || byId.has(id)) continue;
      byId.set(id, row.enabled !== false);
    }
  }
  return DEFAULT_HOMEPAGE_SECTIONS.map((def) => {
    if (byId.has(def.id)) return { id: def.id, enabled: byId.get(def.id)! };
    if (def.id === 'hero') return { ...def, enabled: flags.show_hero };
    if (def.id === 'offers') return { ...def, enabled: flags.show_offers };
    if (def.id === 'trust') return { ...def, enabled: flags.show_trust };
    return { ...def };
  });
}

/** Custom text wins; otherwise the pack's automatic line if the merchant allows it. */
export function resolveAnnouncementText(theme: StoreTheme, autoLine: string): string {
  const custom = theme.announcement.trim();
  if (custom) return custom;
  return theme.announcement_auto ? autoLine.trim() : '';
}

export function sectionEnabled(theme: StoreTheme, id: StoreHomepageSectionId): boolean {
  const row = theme.homepage_sections.find((s) => s.id === id);
  if (row) return row.enabled;
  if (id === 'hero') return theme.show_hero;
  if (id === 'offers') return theme.show_offers;
  if (id === 'trust') return theme.show_trust;
  return id === 'categories' || id === 'catalog';
}

const SHELF_KINDS: StoreProductShelfKind[] = ['discounted', 'price_max'];

export function newProductShelf(kind: StoreProductShelfKind = 'price_max'): StoreProductShelf {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `shelf-${crypto.randomUUID().slice(0, 8)}`
      : `shelf-${Date.now().toString(36)}`;
  if (kind === 'discounted') {
    return { id, title: 'On sale', enabled: true, kind, price_max: 99 };
  }
  return { id, title: 'Under ₹99', enabled: true, kind: 'price_max', price_max: 99 };
}

export function sanitizeProductShelves(raw: unknown): StoreProductShelf[] {
  if (!Array.isArray(raw)) return [];
  const out: StoreProductShelf[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const kind = SHELF_KINDS.includes(row.kind as StoreProductShelfKind)
      ? (row.kind as StoreProductShelfKind)
      : 'price_max';
    let id = clip(row.id, 64);
    if (!ID_KEY.test(id) || seen.has(id)) id = `shelf-${out.length + 1}`;
    seen.add(id);
    const priceRaw = Number(row.price_max);
    const price_max = Number.isFinite(priceRaw)
      ? Math.min(999999, Math.max(1, Math.round(priceRaw)))
      : 99;
    const titleFallback = kind === 'discounted' ? 'On sale' : `Under ₹${price_max}`;
    out.push({
      id,
      title: clip(row.title, 80) || titleFallback,
      enabled: row.enabled !== false,
      kind,
      price_max,
    });
  }
  return out;
}

function sanitizeTestimonials(raw: unknown): StoreTestimonial[] {
  if (!Array.isArray(raw)) return [];
  const out: StoreTestimonial[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = clip(row.name, 80);
    const text = clip(row.text, 500);
    if (!name && !text) continue;
    out.push({ name, text, photo_url: clipStoreMediaUrl(row.photo_url) });
  }
  return out;
}

function sanitizeOverlayBands(raw: unknown): StoreOverlayBand[] {
  if (!Array.isArray(raw)) return [];
  const out: StoreOverlayBand[] = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const image_url = clipStoreMediaUrl(row.image_url);
    const caption = clip(row.caption, 120);
    const cta = clip(row.cta, 40);
    if (!image_url && !caption) continue;
    out.push({ image_url, caption, cta });
  }
  return out;
}

export function sanitizeCustomCss(raw: unknown): string {
  let css = String(raw ?? '');
  if (css.length > 8000) css = css.slice(0, 8000);
  css = css.replace(/<\/?style/gi, '');
  css = css.replace(/<\/?script/gi, '');
  css = css.replace(/@import\b/gi, '');
  css = css.replace(/expression\s*\(/gi, '');
  css = css.replace(/javascript\s*:/gi, '');
  css = css.replace(/url\s*\(\s*['"]?\s*javascript:/gi, 'url(');
  return css;
}

function sanitizeHttpUrl(raw: unknown): string {
  const v = String(raw ?? '').trim().slice(0, 300);
  if (!v) return '';
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
  if (/^\+?[0-9]{8,15}$/.test(v.replace(/\s/g, ''))) return `https://wa.me/${v.replace(/\D/g, '')}`;
  return '';
}

const FIELD_MODES: StoreFormFieldMode[] = ['required', 'optional', 'off'];

export function sanitizeContactForm(raw: unknown): StoreContactForm {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mode = (v: unknown, fallback: StoreFormFieldMode) =>
    FIELD_MODES.includes(v as StoreFormFieldMode) ? (v as StoreFormFieldMode) : fallback;
  let phone = mode(src.phone, DEFAULT_CONTACT_FORM.phone);
  const email = mode(src.email, DEFAULT_CONTACT_FORM.email);
  // A reply channel is mandatory, otherwise the merchant cannot answer.
  if (phone !== 'required' && email !== 'required') phone = 'required';
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  const topics = Array.isArray(src.topics)
    ? Array.from(new Set(src.topics.map((t) => clip(t, 40)).filter(Boolean))).slice(0, 8)
    : [];
  return {
    enabled: src.enabled === true,
    title: clip(src.title, 80) || DEFAULT_CONTACT_FORM.title,
    intro: clip(src.intro, 300),
    phone,
    email,
    topics,
    message_placeholder: clip(src.message_placeholder, 120),
    button: clip(src.button, 32) || DEFAULT_CONTACT_FORM.button,
    success: clip(src.success, 240) || DEFAULT_CONTACT_FORM.success,
    layout: pick(src.layout, ['stacked', 'text-form', 'form-text'] as const, 'stacked'),
    align: pick(src.align, ANNOUNCE_ALIGNS, 'left'),
    width: pick(src.width, ['narrow', 'medium', 'wide'] as const, 'medium'),
    style: pick(src.style, ['card', 'plain', 'filled'] as const, 'card'),
    labels_inside: src.labels_inside === true,
    button_full: src.button_full !== false,
    quick_links: src.quick_links === true,
  };
}

/** Retired packs (classic, chowk, atelier, noir, aether) and their presets all land on Studio. */
function resolvePack(preset: StoreThemePreset, rawPack: unknown): StoreThemePack {
  if (preset === 'khatario') return 'khatario';
  if (preset === 'grocery') return 'grocery';
  if (preset === 'custom') {
    return PACKS.includes(rawPack as StoreThemePack) ? (rawPack as StoreThemePack) : 'studio';
  }
  return 'studio';
}

export function isKhatarioPack(theme: StoreTheme): boolean {
  return theme.pack === 'khatario';
}

export function isGroceryPack(theme: StoreTheme): boolean {
  return theme.pack === 'grocery';
}

export function isStudioPack(theme: StoreTheme): boolean {
  return theme.pack === 'studio';
}

/** Root CSS class that scopes pack styles (drawers, motion, fonts) on storefront surfaces. */
export function storePackClass(theme: StoreTheme): string {
  const dark = hexLuminance(storeCanvas(theme)) < 0.4;
  switch (theme.pack) {
    case 'khatario':
      return 'store-khatario';
    case 'grocery':
      return dark ? 'store-grocery is-dark' : 'store-grocery';
    default:
      return dark ? 'store-studio is-dark' : 'store-studio';
  }
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

export function storeFontStack(family: StoreFontFamily): string {
  switch (family) {
    case 'inter':
      return 'var(--font-khatario-ui), system-ui, sans-serif';
    case 'fraunces':
      return 'var(--font-store-fraunces), Georgia, serif';
    case 'nunito':
      return 'var(--font-store-nunito), system-ui, sans-serif';
    case 'playfair':
      return 'var(--font-store-playfair), Georgia, serif';
    case 'outfit':
      return 'var(--font-store-outfit), system-ui, sans-serif';
    case 'cormorant':
      return 'var(--font-store-cormorant), Georgia, serif';
    case 'source-serif':
      return 'var(--font-store-source-serif), Georgia, serif';
    default:
      return 'system-ui, sans-serif';
  }
}

export function sanitizeStoreTheme(raw: unknown): StoreTheme {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const preset = PRESETS.includes(src.preset as StoreThemePreset)
    ? (src.preset as StoreThemePreset)
    : 'custom';
  const pack = resolvePack(preset, src.pack);
  const presetColors =
    preset !== 'custom' ? STORE_THEME_PRESETS[preset] : null;
  const accent = normalizeHexColor(
    src.accent,
    presetColors?.accent ?? DEFAULT_STORE_THEME.accent,
  );
  const cols = Number(src.mobile_columns);
  const category_style = STYLES.includes(src.category_style as StoreCategoryStyle)
    ? (src.category_style as StoreCategoryStyle)
    : DEFAULT_STORE_THEME.category_style;
  const appearance_mode = MODES.includes(src.appearance_mode as StoreAppearanceMode)
    ? (src.appearance_mode as StoreAppearanceMode)
    : src.pack === 'noir' || src.pack === 'aether'
      ? 'dark'
      : 'light';
  const font_family = STORE_FONT_FAMILIES.includes(src.font_family as StoreFontFamily)
    ? (src.font_family as StoreFontFamily)
    : 'system';
  const show_hero = src.show_hero !== false;
  const show_offers = src.show_offers !== false;
  const show_trust = src.show_trust !== false;
  const paper = storeCanvas({ pack, appearance_mode });

  return {
    accent: presetColors && preset !== 'custom' ? presetColors.accent : accent,
    background: paper,
    preset,
    pack,
    logo_url: clipStoreMediaUrl(src.logo_url),
    show_hero,
    show_offers,
    show_trust,
    category_style,
    mobile_columns: cols === 3 ? 3 : 2,
    search_placeholder: clip(src.search_placeholder, 80),
    hero_cta: clip(src.hero_cta, 32) || DEFAULT_STORE_THEME.hero_cta,
    hero_subtitle: clip(src.hero_subtitle, 160),
    hero_slides: sanitizeHeroSlides(src.hero_slides),
    category_images: sanitizeCategoryImages(src.category_images),
    appearance_mode,
    show_store_name: src.show_store_name !== false,
    favicon_url: clipStoreMediaUrl(src.favicon_url),
    show_listing_add: src.show_listing_add !== false,
    sticky_buy_now: src.sticky_buy_now !== false,
    font_family,
    custom_css: sanitizeCustomCss(src.custom_css),
    announcement: clip(src.announcement, 160),
    announcement_link: sanitizeHttpUrl(src.announcement_link),
    announcement_bg: HEX.test(String(src.announcement_bg ?? '')) ? normalizeHexColor(src.announcement_bg, '') : '',
    announcement_fg: HEX.test(String(src.announcement_fg ?? '')) ? normalizeHexColor(src.announcement_fg, '') : '',
    announcement_align: ANNOUNCE_ALIGNS.includes(src.announcement_align as StoreAnnouncementAlign)
      ? (src.announcement_align as StoreAnnouncementAlign)
      : 'center',
    announcement_auto: src.announcement_auto !== false,
    contact_form: sanitizeContactForm(src.contact_form),
    featured_item_id: clip(src.featured_item_id, 64),
    homepage_sections: sanitizeHomepageSections(src.homepage_sections, { show_hero, show_offers, show_trust }),
    product_shelves: sanitizeProductShelves(src.product_shelves),
    testimonials: sanitizeTestimonials(src.testimonials),
    overlay_bands: sanitizeOverlayBands(src.overlay_bands),
    brand_story: clip(src.brand_story, 4000),
    instagram_url: sanitizeHttpUrl(src.instagram_url),
    whatsapp_url: sanitizeHttpUrl(src.whatsapp_url),
    studio_sections: sanitizeStudioSections(src.studio_sections),
  };
}

export function applyStorePreset(preset: Exclude<StoreThemePreset, 'custom'>): Partial<StoreTheme> {
  const p = STORE_THEME_PRESETS[preset];
  if (preset === 'khatario') {
    return {
      preset,
      accent: p.accent,
      background: p.background,
      pack: p.pack,
      mobile_columns: 2,
      category_style: 'letter',
      hero_cta: 'Order now',
      search_placeholder: 'Search for items…',
      appearance_mode: 'light',
    };
  }
  if (preset === 'grocery') {
    return {
      preset,
      accent: p.accent,
      background: p.background,
      pack: p.pack,
      mobile_columns: 2,
      category_style: 'icon',
      hero_cta: 'Shop groceries',
      hero_subtitle: 'Fresh produce and everyday essentials, delivered to your doorstep.',
      search_placeholder: 'Search for products, brands and categories…',
      appearance_mode: 'light',
      homepage_sections: DEFAULT_HOMEPAGE_SECTIONS.map((s) =>
        s.id === 'overlay' ? { ...s, enabled: true } : s.id === 'trust' ? { ...s, enabled: false } : s,
      ),
    };
  }
  return {
    preset,
    accent: p.accent,
    background: p.background,
    pack: p.pack,
    mobile_columns: 2,
    category_style: 'photo',
    hero_cta: 'Shop now',
    search_placeholder: 'Search for products, categories…',
    appearance_mode: 'light',
  };
}

export function storeThemeFingerprint(theme: StoreTheme): string {
  return JSON.stringify(theme);
}

export const GALLERY_PACKS: Array<{
  preset: Exclude<StoreThemePreset, 'custom'>;
  pack: StoreThemePack;
  label: string;
  blurb: string;
}> = [
  { preset: 'studio', pack: 'studio', label: 'Studio', blurb: 'Editorial header, split hero, photo category tiles. Every section is editable and re-orderable.' },
  { preset: 'grocery', pack: 'grocery', label: 'Premium Grocery', blurb: 'Fresh green supermarket — hero card, emoji category tiles, lifting product cards, promo cards.' },
  { preset: 'khatario', pack: 'khatario', label: 'Khatario', blurb: 'Brand header, carousel, bottom tabs.' },
];
