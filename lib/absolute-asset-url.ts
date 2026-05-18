import type { NextRequest } from 'next/server';

/**
 * Server-side HTML/PDF (Puppeteer) must use absolute image URLs; relative paths
 * do not load when `page.setContent(html)`.
 */
export function absoluteUrlForServerSideAsset(
  url: string | null | undefined,
  request: NextRequest
): string | null {
  if (url == null || typeof url !== 'string') return null;
  const u = url.trim();
  if (u === '') return null;
  if (/^https?:\/\//i.test(u) || u.startsWith('data:')) return u;
  const origin =
    request.nextUrl?.origin ||
    (() => {
      const host = request.headers.get('host') || '127.0.0.1:3000';
      const proto = request.headers.get('x-forwarded-proto') || 'http';
      return `${proto}://${host}`;
    })();
  if (u.startsWith('/')) return `${origin}${u}`;
  return `${origin}/${u.replace(/^\//, '')}`;
}
