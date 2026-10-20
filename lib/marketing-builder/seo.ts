import { absoluteUrl, publicSiteUrl } from '@/lib/blog/site';

const PUBLIC_HOSTS = new Set(['khatario.com', 'www.khatario.com', 'staging.khatario.com']);

/** Canonical may be a site path or an absolute URL on this app's own host. */
export function isSafeCanonical(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.startsWith('/')) return !v.startsWith('//') && !/[\s\\]/.test(v) && v.length <= 300;
  try {
    const url = new URL(v);
    const host = url.hostname.toLowerCase();
    const local = host === 'localhost' || host === '127.0.0.1';
    if (local) return url.protocol === 'http:' || url.protocol === 'https:';
    if (url.protocol !== 'https:') return false;
    if (PUBLIC_HOSTS.has(host)) return true;
    const appHost = new URL(publicSiteUrl()).hostname.toLowerCase();
    return host === appHost;
  } catch {
    return false;
  }
}

export function marketingRobots(value: unknown): 'index' | 'noindex' {
  return value === 'noindex' ? 'noindex' : 'index';
}

/** Absolute canonical when the author set one. Empty means the page's own URL. */
export function resolveCanonical(value: unknown): string | undefined {
  if (typeof value !== 'string' || !isSafeCanonical(value)) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  return v.startsWith('/') ? absoluteUrl(v) : v;
}
