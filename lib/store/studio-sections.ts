export type StudioSectionType =
  | 'announcement'
  | 'header'
  | 'hero'
  | 'categories'
  | 'products'
  | 'banner'
  | 'testimonials'
  | 'footer'
  | 'richtext';

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
  align?: 'left' | 'center' | 'right';
  height?: 'small' | 'medium' | 'large';
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
];

/** Only one of each of these may exist; richtext can repeat. */
const SINGLETON_TYPES = new Set<StudioSectionType>(SECTION_TYPES.filter((t) => t !== 'richtext'));

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
  | { kind: 'icon' };

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
  align: { kind: 'enum', values: ['left', 'center', 'right'] },
  height: { kind: 'enum', values: ['small', 'medium', 'large'] },
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
};

function cleanUrl(v: string): string | undefined {
  if (v.startsWith('data:image/') && !v.startsWith('data:image/svg')) return v.slice(0, 1_800_000);
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v.slice(0, 2000);
  return undefined;
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
