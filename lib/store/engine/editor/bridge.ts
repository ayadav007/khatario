// Client-safe: postMessage protocol between the Studio 2 editor and the storefront preview iframe.
import { CORE_TEMPLATES, ID_RE, pageHandle } from '../shared';
import { extractStoreSubdomain } from '../../subdomain';
import type { GroupKey, SectionRef } from './ops';

export const BRIDGE_SOURCE = 'kh-studio';

// `template` is the template key the sender is showing or editing; each side drops messages for another one.
export type EditorToPreview =
  | { source: 'kh-studio'; type: 'select'; template: string; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'hover'; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'scroll-to'; template: string; ref: SectionRef }
  | { source: 'kh-studio'; type: 'refresh'; rev: number };

export type PreviewToEditor =
  | { source: 'kh-studio'; type: 'ready'; template: string; rev: number | null }
  | { source: 'kh-studio'; type: 'hover'; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'select'; template: string; ref: SectionRef }
  // `after`: the section just above the "+" (null at the top); the editor resolves it against its own order.
  | { source: 'kh-studio'; type: 'add-at'; template: string; after: string | null };

const TEMPLATE_KEY_MAX = 80;

const GROUPS: readonly string[] = ['header', 'footer', 'template'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function parseRef(v: unknown): SectionRef | null {
  if (!isPlainObject(v)) return null;
  const { group, id } = v;
  if (typeof group !== 'string' || !GROUPS.includes(group)) return null;
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return { group: group as GroupKey, id };
}

function isRev(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && !Object.is(v, -0) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
}

/** A core template key or a valid `page.<handle>` key. */
function isTemplateKey(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > TEMPLATE_KEY_MAX) return false;
  return (CORE_TEMPLATES as readonly string[]).includes(v) || pageHandle(v) !== null;
}

/** Where an `add-at` inserts in `order`: the top for null, after `after`, or the end when it is gone. */
export function resolveAddIndex(order: readonly string[], after: string | null): number {
  if (after === null) return 0;
  const i = order.indexOf(after);
  return i < 0 ? order.length : i + 1;
}

/** `null` is a valid ref (returned as `{ ok: true, ref: null }`); anything else must parse as a SectionRef. */
function parseNullableRef(v: unknown): { ok: true; ref: SectionRef | null } | null {
  if (v === null) return { ok: true, ref: null };
  const ref = parseRef(v);
  return ref ? { ok: true, ref } : null;
}

export function parseEditorMessage(data: unknown): EditorToPreview | null {
  if (!isPlainObject(data) || data.source !== BRIDGE_SOURCE) return null;
  switch (data.type) {
    case 'select': {
      const r = parseNullableRef(data.ref);
      return r && isTemplateKey(data.template) ? { source: BRIDGE_SOURCE, type: 'select', template: data.template, ref: r.ref } : null;
    }
    case 'hover': {
      const r = parseNullableRef(data.ref);
      return r ? { source: BRIDGE_SOURCE, type: 'hover', ref: r.ref } : null;
    }
    case 'scroll-to': {
      const ref = parseRef(data.ref);
      return ref && isTemplateKey(data.template) ? { source: BRIDGE_SOURCE, type: 'scroll-to', template: data.template, ref } : null;
    }
    case 'refresh':
      return isRev(data.rev) ? { source: BRIDGE_SOURCE, type: 'refresh', rev: data.rev } : null;
    default:
      return null;
  }
}

/**
 * Gate for messages the storefront preview receives: only from the parent window (`parent` is null
 * when the page is not framed), only from an allowed app origin, only from the origin locked by the
 * first valid message, and only well-formed. Returns the message and the origin to lock, or null.
 */
export function acceptEditorMessage(
  event: { origin: string; source: unknown; data: unknown },
  ctx: { parent: unknown; allowed: readonly string[]; locked: string | null },
): { msg: EditorToPreview; lock: string } | null {
  if (ctx.parent === null || ctx.parent === undefined || event.source !== ctx.parent) return null;
  if (!ctx.allowed.includes(event.origin)) return null;
  if (ctx.locked !== null && event.origin !== ctx.locked) return null;
  const msg = parseEditorMessage(event.data);
  return msg ? { msg, lock: event.origin } : null;
}

export function parsePreviewMessage(data: unknown): PreviewToEditor | null {
  if (!isPlainObject(data) || data.source !== BRIDGE_SOURCE) return null;
  switch (data.type) {
    case 'ready': {
      const { template, rev } = data;
      if (!isTemplateKey(template)) return null;
      if (rev === null) return { source: BRIDGE_SOURCE, type: 'ready', template, rev: null };
      return isRev(rev) ? { source: BRIDGE_SOURCE, type: 'ready', template, rev } : null;
    }
    case 'hover': {
      const r = parseNullableRef(data.ref);
      return r ? { source: BRIDGE_SOURCE, type: 'hover', ref: r.ref } : null;
    }
    case 'select': {
      const ref = parseRef(data.ref);
      return ref && isTemplateKey(data.template) ? { source: BRIDGE_SOURCE, type: 'select', template: data.template, ref } : null;
    }
    case 'add-at': {
      const { template, after } = data;
      // The pre-M3 shape carried an index; a frame still sending it is out of date.
      if ('index' in data || !isTemplateKey(template)) return null;
      if (after !== null && (typeof after !== 'string' || !ID_RE.test(after))) return null;
      return { source: BRIDGE_SOURCE, type: 'add-at', template, after };
    }
    default:
      return null;
  }
}

/** App origins allowed to embed/post to a store page served on `host` (may include a port). */
export function appOriginsForStoreHost(protocol: 'http:' | 'https:', host: string): string[] {
  if (protocol !== 'http:' && protocol !== 'https:') return [];
  const m = /^([^:]*)(?::(\d+))?$/.exec(host.trim().toLowerCase());
  if (!m) return [];
  const hostname = m[1];
  const port = m[2] ? `:${m[2]}` : '';
  if (!extractStoreSubdomain(hostname)) return [];

  if (hostname.endsWith('.localhost')) {
    return [`${protocol}//localhost${port}`, `${protocol}//127.0.0.1${port}`];
  }
  if (protocol !== 'https:' || port) return [];
  if (hostname.endsWith('.staging.khatario.com')) return ['https://staging.khatario.com'];
  if (hostname.endsWith('.khatario.com')) {
    return ['https://khatario.com', 'https://app.khatario.com', 'https://www.khatario.com'];
  }
  return [];
}

export function storeOriginFromPreviewUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}
