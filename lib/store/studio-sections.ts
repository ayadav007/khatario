export type StudioSectionType =
  | 'announcement'
  | 'header'
  | 'hero'
  | 'categories'
  | 'products'
  | 'banner'
  | 'testimonials'
  | 'footer'
  | 'richtext'
  | 'usp'
  | 'marquee';

/** Where a product section gets its products. `all` is the full catalog with Load more. */
export type StudioProductSource =
  | 'all'
  | 'featured'
  | 'new'
  | 'bestsellers'
  | 'discounted'
  | 'category'
  | 'price_max';

export const STUDIO_PRODUCT_SOURCES: StudioProductSource[] = [
  'all',
  'featured',
  'new',
  'bestsellers',
  'discounted',
  'category',
  'price_max',
];

/** Extra hero slides after the first one, which keeps using the hero's own fields. */
export interface StudioSlide {
  image: string;
  /** Shown on phones instead of `image` (engine slideshow only). */
  mobileImage?: string;
  heading: string;
  description: string;
  buttonText: string;
  link: string;
}

export const STUDIO_USP_ICONS = ['truck', 'cash', 'return', 'shield', 'clock', 'leaf', 'star', 'gift', 'phone', 'badge'] as const;
export type StudioUspIcon = (typeof STUDIO_USP_ICONS)[number];

export interface StudioUsp {
  icon: StudioUspIcon;
  title: string;
  text: string;
}

export interface StudioBadge {
  label: string;
  tone: 'sale' | 'new' | 'hot';
}

export interface StudioSettings {
  text?: string;
  extra?: string;
  accent?: string;
  announceMode?: 'custom' | 'auto';
  /** Read-only: the automatic line the storefront would show (empty when the pack has none). */
  autoText?: string;
  link?: string;
  textColor?: string;
  /** Read-only: how the pack colours the bar by default. */
  tone?: 'tint' | 'solid';
  logo?: string;
  tagline?: string;
  showSearch?: boolean;
  showNav?: boolean;
  navLinks?: string;
  highlightLink?: string;
  iconsPosition?: 'left' | 'right';
  showAccount?: boolean;
  showCart?: boolean;
  showCartCount?: boolean;
  /** Iconify names (set:icon) plus their SVG data URLs; empty = theme default glyph. */
  accountIcon?: string;
  accountIconSvg?: string;
  cartIcon?: string;
  cartIconSvg?: string;
  layout?: 'image-text' | 'text-image' | 'full';
  /** Small label above a heading; undefined = section default, empty = hidden. */
  eyebrow?: string;
  /** Comma-separated hero highlights; empty hides the row. */
  benefits?: string;
  heading?: string;
  description?: string;
  buttonText?: string;
  image?: string;
  /** Hero slide one's phone image (engine slideshow only). */
  mobileImage?: string;
  align?: 'left' | 'center' | 'right';
  height?: 'small' | 'medium' | 'large';
  /** Hero: `cover` crops to the height, `contain` shows the whole image, `natural` sizes the hero to the image. */
  imageFit?: 'cover' | 'contain' | 'natural';
  overlay?: number;
  title?: string;
  columns?: number;
  showPrice?: boolean;
  showAdd?: boolean;
  button?: string;
  brand?: string;
  links?: string;
  background?: string;
  spacingTop?: number;
  spacingBottom?: number;
  radius?: number;
  textAlign?: 'left' | 'center' | 'right';
  textVAlign?: 'top' | 'center' | 'bottom';
  textPadTop?: number;
  textPadRight?: number;
  textPadBottom?: number;
  textPadLeft?: number;
  /** Hero: slides shown after the first; autoplay interval in seconds (0 = manual). */
  slides?: StudioSlide[];
  autoplay?: number;
  /** Product sections. */
  source?: StudioProductSource;
  categoryId?: string;
  priceMax?: number;
  limit?: number;
  display?: 'grid' | 'carousel';
  cardStyle?: 'bordered' | 'shadow' | 'minimal';
  imageRatio?: 'square' | 'portrait' | 'landscape';
  showRating?: boolean;
  showBadges?: boolean;
  /** Product tiles: the product's one-line tagline above its name. */
  showTagline?: boolean;
  /** Product tiles: the product's colour swatches under its price. */
  showSwatches?: boolean;
  /** USP strip. */
  usps?: StudioUsp[];
  /** Marquee. */
  speed?: 'slow' | 'normal' | 'fast';
  /** Any section: merchant class names on the wrapper, and CSS scoped to this section. */
  cssClass?: string;
  customCss?: string;
  /** Quick header: delivery promise shown in the location bar, e.g. "in 30 minutes". */
  deliveryEta?: string;
}

/** Per-section custom CSS limit; the store-wide box keeps its own 8,000. */
export const SECTION_CSS_MAX = 3000;

const CLASS_TOKEN = /^[a-zA-Z_][a-zA-Z0-9_-]{0,39}$/;

/** Merchant class names for a section: up to 3 plain CSS class tokens, anything else dropped. */
export function sanitizeCssClass(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return Array.from(
    new Set(
      raw
        .split(/\s+/)
        .map((t) => t.replace(/^\./, ''))
        .filter((t) => CLASS_TOKEN.test(t)),
    ),
  )
    .slice(0, 3)
    .join(' ');
}

export interface StudioSection {
  id: string;
  type: StudioSectionType;
  name: string;
  enabled: boolean;
  settings: StudioSettings;
}

const SECTION_TYPES: StudioSectionType[] = [
  'announcement',
  'header',
  'hero',
  'categories',
  'products',
  'banner',
  'testimonials',
  'footer',
  'richtext',
  'usp',
  'marquee',
];

/** Section types a store can have more than once. */
export const REPEATABLE_TYPES: StudioSectionType[] = ['products', 'banner', 'richtext', 'usp', 'marquee'];

/** Only one of each of these may exist. */
const SINGLETON_TYPES = new Set<StudioSectionType>(SECTION_TYPES.filter((t) => !REPEATABLE_TYPES.includes(t)));

const MAX_SECTIONS = 24;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ICON_NAME = /^[a-z0-9-]+:[a-z0-9-]+$/;

type Rule =
  | { kind: 'text'; max: number }
  | { kind: 'bool' }
  | { kind: 'num'; min: number; max: number }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'hex' }
  | { kind: 'url' }
  | { kind: 'svg' }
  | { kind: 'icon' }
  | { kind: 'slides' }
  | { kind: 'usps' }
  | { kind: 'cssclass' }
  | { kind: 'css' };

const RULES: Record<keyof StudioSettings, Rule> = {
  text: { kind: 'text', max: 2000 },
  extra: { kind: 'text', max: 160 },
  accent: { kind: 'hex' },
  announceMode: { kind: 'enum', values: ['custom', 'auto'] },
  autoText: { kind: 'text', max: 200 },
  link: { kind: 'url' },
  textColor: { kind: 'hex' },
  tone: { kind: 'enum', values: ['tint', 'solid'] },
  logo: { kind: 'text', max: 80 },
  tagline: { kind: 'text', max: 160 },
  showSearch: { kind: 'bool' },
  showNav: { kind: 'bool' },
  navLinks: { kind: 'text', max: 400 },
  highlightLink: { kind: 'text', max: 60 },
  iconsPosition: { kind: 'enum', values: ['left', 'right'] },
  showAccount: { kind: 'bool' },
  showCart: { kind: 'bool' },
  showCartCount: { kind: 'bool' },
  accountIcon: { kind: 'icon' },
  accountIconSvg: { kind: 'svg' },
  cartIcon: { kind: 'icon' },
  cartIconSvg: { kind: 'svg' },
  layout: { kind: 'enum', values: ['image-text', 'text-image', 'full'] },
  eyebrow: { kind: 'text', max: 60 },
  benefits: { kind: 'text', max: 200 },
  heading: { kind: 'text', max: 120 },
  description: { kind: 'text', max: 400 },
  buttonText: { kind: 'text', max: 40 },
  image: { kind: 'url' },
  mobileImage: { kind: 'url' },
  align: { kind: 'enum', values: ['left', 'center', 'right'] },
  height: { kind: 'enum', values: ['small', 'medium', 'large'] },
  imageFit: { kind: 'enum', values: ['cover', 'contain', 'natural'] },
  overlay: { kind: 'num', min: 0, max: 90 },
  title: { kind: 'text', max: 120 },
  columns: { kind: 'num', min: 2, max: 8 },
  showPrice: { kind: 'bool' },
  showAdd: { kind: 'bool' },
  button: { kind: 'text', max: 40 },
  brand: { kind: 'text', max: 80 },
  links: { kind: 'text', max: 400 },
  background: { kind: 'hex' },
  spacingTop: { kind: 'num', min: 0, max: 200 },
  spacingBottom: { kind: 'num', min: 0, max: 200 },
  radius: { kind: 'num', min: 0, max: 60 },
  textAlign: { kind: 'enum', values: ['left', 'center', 'right'] },
  textVAlign: { kind: 'enum', values: ['top', 'center', 'bottom'] },
  textPadTop: { kind: 'num', min: 0, max: 120 },
  textPadRight: { kind: 'num', min: 0, max: 120 },
  textPadBottom: { kind: 'num', min: 0, max: 120 },
  textPadLeft: { kind: 'num', min: 0, max: 120 },
  slides: { kind: 'slides' },
  autoplay: { kind: 'num', min: 0, max: 15 },
  source: { kind: 'enum', values: STUDIO_PRODUCT_SOURCES },
  categoryId: { kind: 'text', max: 64 },
  priceMax: { kind: 'num', min: 1, max: 999999 },
  limit: { kind: 'num', min: 2, max: 24 },
  display: { kind: 'enum', values: ['grid', 'carousel'] },
  cardStyle: { kind: 'enum', values: ['bordered', 'shadow', 'minimal'] },
  imageRatio: { kind: 'enum', values: ['square', 'portrait', 'landscape'] },
  showRating: { kind: 'bool' },
  showBadges: { kind: 'bool' },
  showTagline: { kind: 'bool' },
  showSwatches: { kind: 'bool' },
  usps: { kind: 'usps' },
  speed: { kind: 'enum', values: ['slow', 'normal', 'fast'] },
  cssClass: { kind: 'cssclass' },
  customCss: { kind: 'css' },
  deliveryEta: { kind: 'text', max: 40 },
};

function cleanUrl(v: string): string | undefined {
  if (v.startsWith('data:image/') && !v.startsWith('data:image/svg')) return v.slice(0, 1_800_000);
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v.slice(0, 2000);
  return undefined;
}

function cleanText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.slice(0, max) : '';
}

function cleanSlides(raw: unknown): StudioSlide[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StudioSlide[] = [];
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const image = typeof row.image === 'string' && row.image.trim() ? cleanUrl(row.image.trim()) ?? '' : '';
    const link = typeof row.link === 'string' && row.link.trim() ? cleanUrl(row.link.trim()) ?? '' : '';
    out.push({
      image,
      heading: cleanText(row.heading, 120),
      description: cleanText(row.description, 400),
      buttonText: cleanText(row.buttonText, 40),
      link: link.startsWith('data:') ? '' : link,
    });
  }
  return out;
}

function cleanUsps(raw: unknown): StudioUsp[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StudioUsp[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const icon = STUDIO_USP_ICONS.includes(row.icon as StudioUspIcon) ? (row.icon as StudioUspIcon) : 'badge';
    out.push({ icon, title: cleanText(row.title, 60), text: cleanText(row.text, 120) });
  }
  return out;
}

function cleanValue(rule: Rule, raw: unknown): unknown {
  switch (rule.kind) {
    case 'text':
      return typeof raw === 'string' ? raw.slice(0, rule.max) : undefined;
    case 'bool':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'num': {
      const n = Number(raw);
      if (raw === null || raw === '' || !Number.isFinite(n)) return undefined;
      return Math.min(rule.max, Math.max(rule.min, Math.round(n)));
    }
    case 'enum':
      return rule.values.includes(raw as string) ? raw : undefined;
    case 'hex':
      return typeof raw === 'string' && HEX.test(raw.trim()) ? raw.trim().toLowerCase() : undefined;
    case 'url':
      return typeof raw === 'string' && raw.trim() ? cleanUrl(raw.trim()) : undefined;
    case 'svg':
      // Rendered through CSS mask-image only, never as markup, so a bounded data URL is safe.
      return typeof raw === 'string' && raw.startsWith('data:image/svg+xml') && raw.length < 20000 ? raw : undefined;
    case 'icon':
      return typeof raw === 'string' && ICON_NAME.test(raw) ? raw : undefined;
    case 'slides':
      return cleanSlides(raw);
    case 'usps':
      return cleanUsps(raw);
    case 'cssclass':
      return typeof raw === 'string' ? sanitizeCssClass(raw) : undefined;
    case 'css':
      // Kept as typed (minus `<`); it is cleaned and scoped again every time it is rendered.
      return typeof raw === 'string' ? raw.slice(0, SECTION_CSS_MAX).replace(/</g, '') : undefined;
  }
}

export function sanitizeStudioSettings(raw: unknown): StudioSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const rule = RULES[key as keyof StudioSettings];
    if (!rule) continue;
    const clean = cleanValue(rule, value);
    if (clean !== undefined) out[key] = clean;
  }
  return out as StudioSettings;
}

/** Empty result means "not customised yet": the storefront derives sections from the theme. */
export function sanitizeStudioSections(raw: unknown): StudioSection[] {
  if (!Array.isArray(raw)) return [];
  const out: StudioSection[] = [];
  const ids = new Set<string>();
  const singles = new Set<StudioSectionType>();
  for (const item of raw) {
    if (out.length >= MAX_SECTIONS) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const type = row.type as StudioSectionType;
    if (!SECTION_TYPES.includes(type)) continue;
    if (SINGLETON_TYPES.has(type)) {
      if (singles.has(type)) continue;
      singles.add(type);
    }
    let id = typeof row.id === 'string' && ID.test(row.id) ? row.id : `${type}-${out.length + 1}`;
    if (ids.has(id)) id = `${type}-${out.length + 1}-${ids.size}`;
    ids.add(id);
    out.push({
      id,
      type,
      name: String(row.name ?? '').trim().slice(0, 60) || type,
      enabled: row.enabled !== false,
      settings: sanitizeStudioSettings(row.settings),
    });
  }
  return out;
}
