// Client-safe: postMessage protocol between the Studio 2 editor and the storefront preview iframe.
import { ENGINE_LIMITS, ID_RE } from '../shared';
import { extractStoreSubdomain } from '../../subdomain';
import type { GroupKey, SectionRef } from './ops';

export const BRIDGE_SOURCE = 'kh-studio';

export type EditorToPreview =
  | { source: 'kh-studio'; type: 'select'; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'hover'; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'scroll-to'; ref: SectionRef }
  | { source: 'kh-studio'; type: 'refresh'; rev: number };

export type PreviewToEditor =
  | { source: 'kh-studio'; type: 'ready'; rev: number | null }
  | { source: 'kh-studio'; type: 'hover'; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'select'; ref: SectionRef }
  | { source: 'kh-studio'; type: 'add-at'; index: number }; // index in the current template

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
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

export function parseEditorMessage(data: unknown): EditorToPreview | null {
  if (!isPlainObject(data) || data.source !== BRIDGE_SOURCE) return null;
  switch (data.type) {
    case 'select':
    case 'hover': {
      if (data.ref === null) return { source: BRIDGE_SOURCE, type: data.type, ref: null };
      const ref = parseRef(data.ref);
      return ref ? { source: BRIDGE_SOURCE, type: data.type, ref } : null;
    }
    case 'scroll-to': {
      const ref = parseRef(data.ref);
      return ref ? { source: BRIDGE_SOURCE, type: 'scroll-to', ref } : null;
    }
    case 'refresh':
      return isRev(data.rev) ? { source: BRIDGE_SOURCE, type: 'refresh', rev: data.rev } : null;
    default:
      return null;
  }
}

export function parsePreviewMessage(data: unknown): PreviewToEditor | null {
  if (!isPlainObject(data) || data.source !== BRIDGE_SOURCE) return null;
  switch (data.type) {
    case 'ready':
      if (data.rev === null) return { source: BRIDGE_SOURCE, type: 'ready', rev: null };
      return isRev(data.rev) ? { source: BRIDGE_SOURCE, type: 'ready', rev: data.rev } : null;
    case 'hover': {
      if (data.ref === null) return { source: BRIDGE_SOURCE, type: 'hover', ref: null };
      const ref = parseRef(data.ref);
      return ref ? { source: BRIDGE_SOURCE, type: 'hover', ref } : null;
    }
    case 'select': {
      const ref = parseRef(data.ref);
      return ref ? { source: BRIDGE_SOURCE, type: 'select', ref } : null;
    }
    case 'add-at': {
      const { index } = data;
      if (typeof index !== 'number' || !Number.isInteger(index)) return null;
      if (index < 0 || index > ENGINE_LIMITS.sectionsPerTemplate) return null;
      return { source: BRIDGE_SOURCE, type: 'add-at', index };
    }
    default:
      return null;
  }
}

/** App origins allowed to embed/post to a store page served on `host` (may include a port). */
export function appOriginsForStoreHost(protocol: 'http:' | 'https:', host: string): string[] {
  const m = /^([^:]*)(?::(\d+))?$/.exec(host.trim().toLowerCase());
  if (!m) return [];
  const hostname = m[1];
  const port = m[2] ? `:${m[2]}` : '';
  if (!extractStoreSubdomain(hostname)) return [];

  if (hostname.endsWith('.localhost')) {
    return [`${protocol}//localhost${port}`, `${protocol}//127.0.0.1${port}`];
  }
  if (protocol !== 'https:') return [];
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
