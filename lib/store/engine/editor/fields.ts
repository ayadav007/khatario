// Pure helpers for the Studio 2 settings panel (generated fields, pickers, merge keys).
// Client-safe: imports only engine types/schema-types/theme-settings-schema/registry, ops types and the
// import-free option lists in lib/store (store-theme pulls in only studio-sections).
import type { ColorScheme, ThemeSettings } from '../types';
import type { SettingSchema } from '../schema-types';
import { EDITOR_HIDDEN_SETTINGS } from '../theme-settings-schema';
import { COMMON_SETTINGS } from '../registry';
import { VIDEO_HOSTS } from '../shared';
import type { SectionRef } from './ops';
import { STORE_FONT_FAMILIES } from '@/lib/store/store-theme';
import { STUDIO_USP_ICONS } from '@/lib/store/studio-sections';

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Same as the server's CUSTOM_HTML_MAX (characters kept before sanitising). */
export const HTML_MAX = 20000;
/** Same as the server's cap on product and category lists. */
const LIST_MAX = 50;

/** What a field edits: a section's or block's settings, or the theme's. */
export type FieldTarget =
  | { kind: 'section'; ref: SectionRef }
  | { kind: 'block'; ref: SectionRef; blockId: string }
  | { kind: 'theme' };

/** The stored value, else the schema default (what defaultSettings would give), else undefined. */
export function settingValue(settings: Record<string, unknown> | undefined, schema: SettingSchema): unknown {
  if (settings && hasOwn(settings, schema.id) && settings[schema.id] !== undefined) return settings[schema.id];
  return schema.default;
}

/** settingValue for theme settings, where `social.*` ids are nested. */
export function themeSettingValue(settings: ThemeSettings, schema: SettingSchema): unknown {
  const dot = schema.id.indexOf('.');
  if (dot < 0) return settingValue(settings as unknown as Record<string, unknown>, schema);
  const parent = (settings as unknown as Record<string, unknown>)[schema.id.slice(0, dot)];
  const obj = parent && typeof parent === 'object' ? (parent as Record<string, unknown>) : undefined;
  return settingValue(obj, { ...schema, id: schema.id.slice(dot + 1) });
}

/** Clamps to min/max; a range also snaps to its step (counted from min). Same as the server. */
export function clampNumber(schema: SettingSchema, n: number): number | null {
  if (!Number.isFinite(n)) return null;
  let v = n;
  if (schema.type === 'range' && schema.step && schema.step > 0) {
    const base = schema.min ?? 0;
    v = Number((base + Math.round((v - base) / schema.step) * schema.step).toFixed(6));
  }
  if (schema.min !== undefined) v = Math.max(schema.min, v);
  if (schema.max !== undefined) v = Math.min(schema.max, v);
  return v;
}

/** `#rrggbb`, or `#rgb` expanded, lowercased; null for anything else. */
export function parseHex(input: string): string | null {
  const v = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

/** "5/120" under a field with a max_length; null when there is no max. */
export function lengthCounter(value: unknown, max: number | undefined): { text: string; over: boolean } | null {
  if (max === undefined) return null;
  const n = typeof value === 'string' ? value.length : 0;
  return { text: `${n}/${max}`, over: n > max };
}

/** Which form a settings list belongs to. */
export type FormScope = { kind: 'theme' } | { kind: 'section'; type: string } | { kind: 'block' };

/**
 * The settings a form shows, minus those not wired yet (D13): the theme form hides
 * EDITOR_HIDDEN_SETTINGS.theme; a section form hides the `common` ids that come from
 * COMMON_SETTINGS plus its type's own list; block forms hide nothing.
 */
export function visibleSettings(schemas: readonly SettingSchema[], scope: FormScope): SettingSchema[] {
  const hidden = EDITOR_HIDDEN_SETTINGS;
  if (scope.kind === 'block') return schemas.slice();
  if (scope.kind === 'theme') return schemas.filter((s) => !(hidden.theme as readonly string[]).includes(s.id));
  const own: readonly string[] = hasOwn(hidden.sections, scope.type)
    ? hidden.sections[scope.type as keyof typeof hidden.sections]
    : [];
  return schemas.filter(
    (s) => !own.includes(s.id) && !((hidden.common as readonly string[]).includes(s.id) && COMMON_SETTINGS.includes(s)),
  );
}

export const CUSTOM_LINK = 'custom';

/** Link picker choices: Home, All products (the catalog), then one catalog page per category (D14). */
export function linkOptions(categories: readonly { id: string; name: string }[]): { value: string; label: string }[] {
  return [
    { value: '/', label: 'Home' },
    { value: '/catalog', label: 'All products' },
    ...categories.map((c) => ({ value: `/catalog/${encodeURIComponent(c.id)}`, label: c.name })),
  ];
}

/** Which picker choice a stored link is: '' (none), one of linkOptions, or 'custom' (old `/?cat=` links too). */
export function linkChoice(value: unknown, categories: readonly { id: string; name: string }[]): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const v = value.trim();
  return linkOptions(categories).some((o) => o.value === v) ? v : CUSTOM_LINK;
}

/** Mirrors the server's url rule: empty, `#anchor`, a root-relative path or an https URL. */
export function isLinkValue(raw: string): boolean {
  const v = raw.trim();
  if (v === '') return true;
  if (v.length > 2000) return false;
  if (v.startsWith('#')) return /^#[\w-]*$/.test(v);
  if (/^\/(?!\/)[^\s\\\x00-\x1f]*$/.test(v)) return true;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Mirrors the server's video_url rule: empty, or an https link on a YouTube or Vimeo host. */
export function isVideoUrl(raw: string): boolean {
  const v = raw.trim();
  if (v === '') return true;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && VIDEO_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Free-text settings the server keeps only when they pass a rule: a `video_url`, and the theme's
 * `social.*` links (stored through the url rule). The field shows the typed text but commits only
 * a valid value, so it never shows something the server drops. Null: any text is kept.
 */
export function textRuleFor(schema: SettingSchema): ((raw: string) => boolean) | null {
  if (schema.type === 'video_url') return isVideoUrl;
  if (schema.type === 'text' && schema.id.startsWith('social.')) return isLinkValue;
  return null;
}

/** `<group>:<sectionId>[:<blockId>]:<key>`, or `theme:<key>`: edits to one field merge into one undo step. */
export function settingMergeKey(target: FieldTarget, key: string): string {
  if (target.kind === 'theme') return `theme:${key}`;
  if (target.kind === 'block') return `${target.ref.group}:${target.ref.id}:${target.blockId}:${key}`;
  return `${target.ref.group}:${target.ref.id}:${key}`;
}

export type SchemeColorKey = Exclude<keyof ColorScheme, 'id' | 'name'>;

export const SCHEME_COLOR_FIELDS: { key: SchemeColorKey; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Accent' },
  { key: 'button', label: 'Button' },
  { key: 'button_text', label: 'Button text' },
  { key: 'border', label: 'Border' },
  { key: 'card', label: 'Card' },
];

export function schemeMergeKey(schemeId: string, field: SchemeColorKey): string {
  return `theme:color_schemes:${schemeId}:${field}`;
}

/** Adds or removes an id; adding stops at `max`. */
export function toggleListItem(list: readonly string[] | undefined, id: string, max: number): string[] {
  const cur = Array.isArray(list) ? list : [];
  if (cur.includes(id)) return cur.filter((x) => x !== id);
  return cur.length >= max ? cur.slice() : [...cur, id];
}

/** How many ids a product_list/category_list may hold: the schema's max, capped at the server's 50. */
export function listLimit(schema: SettingSchema): number {
  return Math.min(schema.max ?? LIST_MAX, LIST_MAX);
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, ' ');

/** Store fonts the engine accepts ('system' is old-Studio only). */
export const FONT_OPTIONS: { value: string; label: string }[] = STORE_FONT_FAMILIES.filter((f) => f !== 'system').map((f) => ({
  value: f,
  label: titleCase(f),
}));

export const ICON_OPTIONS: { value: string; label: string }[] = STUDIO_USP_ICONS.map((i) => ({ value: i, label: titleCase(i) }));

/**
 * Percent-encodes an image URL's file name (last path segment) so the url rule, which rejects
 * spaces, accepts it. Idempotent; the query string and anything without a file name are left alone.
 */
export function encodeImageUrl(url: string): string {
  const m = /^((?:https:\/\/[^/?#]+)?\/(?:[^?#]*\/)?)([^/?#]+)(.*)$/.exec(url);
  if (!m) return url;
  const [, head, name, rest] = m;
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // A stray "%": encode the raw name.
  }
  const encoded = encodeURIComponent(decoded).replace(/%28/g, '(').replace(/%29/g, ')');
  return `${head}${encoded}${rest}`;
}
