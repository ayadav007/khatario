import sanitizeHtml from 'sanitize-html';
import { STUDIO_USP_ICONS } from '@/lib/store/studio-sections';
import type { SettingSchema } from './schema-types';
import { sanitizeCustomHtml } from './html';
import { defaultSettings } from './shared';

export { defaultSettings };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SCHEME_ID_RE = /^[a-z0-9_-]{1,32}$/;
const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be', 'vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const FONTS = ['inter', 'nunito', 'outfit', 'fraunces', 'playfair', 'cormorant', 'source-serif'];
const LIST_MAX = 50;
const RICHTEXT_MAX = 5000;

const RICHTEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'br', 'h2', 'h3', 'h4'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowProtocolRelative: false,
};

/** `#abc`, `#aabbcc` or `#aabbccdd`. */
export function isHexColor(value: string): boolean {
  return COLOR_RE.test(value);
}

function clipText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw.trim().slice(0, max);
}

function parseHttps(value: string): URL | null {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function isRootRelative(value: string): boolean {
  // No whitespace/control chars: browsers strip tab/newline, so "/\t/evil.com" would become "//evil.com".
  return /^\/(?!\/)[^\s\\\x00-\x1f]*$/.test(value);
}

function sanitizeNumber(schema: SettingSchema, raw: unknown, round: boolean): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  let v = n;
  if (round && schema.step && schema.step > 0) {
    const base = schema.min ?? 0;
    v = base + Math.round((v - base) / schema.step) * schema.step;
    v = Number(v.toFixed(6));
  }
  if (schema.min !== undefined) v = Math.max(schema.min, v);
  if (schema.max !== undefined) v = Math.min(schema.max, v);
  return v;
}

function sanitizeUuidList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && UUID_RE.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= LIST_MAX) break;
  }
  return out;
}

/** Returns `undefined` to mean "drop this value and use the default". */
export function sanitizeSettingValue(schema: SettingSchema, raw: unknown): unknown {
  switch (schema.type) {
    case 'text':
      return clipText(raw, schema.max_length ?? 200);
    case 'textarea':
      return clipText(raw, schema.max_length ?? 2000);
    case 'richtext': {
      if (typeof raw !== 'string') return undefined;
      return sanitizeHtml(raw.slice(0, RICHTEXT_MAX), RICHTEXT_OPTIONS).trim();
    }
    case 'number':
      return sanitizeNumber(schema, raw, false);
    case 'range':
      return sanitizeNumber(schema, raw, true);
    case 'checkbox':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'select':
    case 'radio':
      return typeof raw === 'string' && schema.options?.some((o) => o.value === raw) ? raw : undefined;
    case 'color':
      return typeof raw === 'string' && (raw === '' || isHexColor(raw)) ? raw : undefined;
    case 'color_scheme':
      return typeof raw === 'string' && SCHEME_ID_RE.test(raw) ? raw : undefined;
    case 'image': {
      if (typeof raw !== 'string') return undefined;
      const v = raw.trim();
      if (v === '') return '';
      if (v.length > 2000) return undefined;
      if (isRootRelative(v)) return v;
      return parseHttps(v) ? v : undefined;
    }
    case 'url': {
      if (typeof raw !== 'string') return undefined;
      const v = raw.trim();
      if (v.length > 2000) return undefined;
      if (v === '') return '';
      if (v.startsWith('#')) return /^#[\w-]*$/.test(v) ? v : undefined;
      if (isRootRelative(v)) return v;
      return parseHttps(v) ? v : undefined;
    }
    case 'video_url': {
      if (typeof raw !== 'string') return undefined;
      const v = raw.trim();
      if (v === '') return '';
      const u = parseHttps(v);
      return u && VIDEO_HOSTS.has(u.hostname.toLowerCase()) ? v : undefined;
    }
    case 'product':
    case 'category':
      return typeof raw === 'string' && UUID_RE.test(raw) ? raw : undefined;
    case 'product_list':
    case 'category_list':
      return sanitizeUuidList(raw);
    case 'icon':
      return typeof raw === 'string' && (STUDIO_USP_ICONS as readonly string[]).includes(raw) ? raw : undefined;
    case 'font':
      return typeof raw === 'string' && FONTS.includes(raw) ? raw : undefined;
    case 'html':
      return typeof raw === 'string' ? sanitizeCustomHtml(raw) : undefined;
    default:
      return undefined;
  }
}

/** Keeps only keys declared in `schemas`; invalid values are dropped, `header` ids are never stored. */
export function sanitizeSettings(schemas: SettingSchema[], raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const input = raw as Record<string, unknown>;
  for (const s of schemas) {
    if (s.type === 'header') continue;
    if (!Object.prototype.hasOwnProperty.call(input, s.id)) continue;
    const v = sanitizeSettingValue(s, input[s.id]);
    if (v !== undefined) out[s.id] = v;
  }
  return out;
}
