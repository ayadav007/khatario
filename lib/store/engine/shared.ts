// Client-safe: no sanitize-html, no pg. Editor code may import this file.
import type { SettingSchema } from './schema-types';

export const ENGINE_LIMITS = {
  sectionsPerTemplate: 25,
  blocksPerSection: 50,
  customPages: 30,
  themeBytes: 524288,
  themesPerBusiness: 20,
  versionsKept: 30,
};

export const ID_RE = /^[a-z0-9_-]{1,32}$/;

export const PAGE_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
export const RESERVED_PAGE_HANDLES: readonly string[] = ['cart', 'checkout', 'account', 'products', 'catalog', 'pages', 'api', 'khata', 'wishlist', 'about', 'contact', 'privacy', 'refund', 'terms'];

/** Templates every theme carries; custom pages are keyed `page.<handle>`. */
export const CORE_TEMPLATES = ['home', 'product', 'catalog'] as const;

export function pageKey(handle: string): string {
  return `page.${handle}`;
}

/** The handle of a `page.<handle>` template key, or null for any other key or an invalid/reserved handle. */
export function pageHandle(key: string): string | null {
  if (!key.startsWith('page.')) return null;
  const handle = key.slice(5);
  return PAGE_HANDLE_RE.test(handle) && !RESERVED_PAGE_HANDLES.includes(handle) ? handle : null;
}

/** Hosts a `video_url` setting may point at (https only); the server drops anything else. */
export const VIDEO_HOSTS: readonly string[] = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
];

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix?: string): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  const cleaned = (prefix ?? 'id').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return `${cleaned || 'id'}-${suffix}`.slice(0, 32);
}

export function defaultSettings(schemas: SettingSchema[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of schemas) {
    if (s.type === 'header' || s.default === undefined) continue;
    out[s.id] = s.default;
  }
  return out;
}

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be'];
const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];

/**
 * The privacy-friendly embed address for a YouTube or Vimeo link, or null when the link is not https,
 * not one of those hosts, or has no valid video id.
 */
export function videoEmbedUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (YOUTUBE_HOSTS.includes(host)) {
    let id: string | undefined;
    if (host.endsWith('youtu.be')) id = parts[0];
    else if (parts[0] === 'watch') id = u.searchParams.get('v') ?? undefined;
    else if (parts[0] === 'embed' || parts[0] === 'shorts') id = parts[1];
    return id && YOUTUBE_ID_RE.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (VIMEO_HOSTS.includes(host)) {
    const id = host === 'player.vimeo.com' ? (parts[0] === 'video' ? parts[1] : undefined) : parts[0];
    return id && /^\d{1,12}$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}
