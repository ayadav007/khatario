// Client-safe: maps template keys to storefront paths for preview links. Imports only shared.ts.
import { PAGE_HANDLE_RE, RESERVED_PAGE_HANDLES, pageHandle } from './shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The storefront path that shows a template, or null when it has none (a product template needs a product id). */
export function previewPath(templateKey: string, opts?: { productId?: string | null }): string | null {
  if (templateKey === 'home') return '/';
  if (templateKey === 'catalog') return '/catalog';
  if (templateKey === 'product') {
    const id = opts?.productId;
    return id && UUID_RE.test(id) ? `/products/${id}` : null;
  }
  const handle = pageHandle(templateKey);
  return handle ? `/pages/${handle}` : null;
}

/** True only for the exact paths previewPath can produce (plus a catalog category); no query, hash, `..` or `//`. */
export function isPreviewPath(path: string): boolean {
  if (path === '/' || path === '/catalog') return true;
  const m = /^\/(catalog|products|pages)\/([^/]+)$/.exec(path);
  if (!m) return false;
  if (m[1] === 'pages') return PAGE_HANDLE_RE.test(m[2]) && !RESERVED_PAGE_HANDLES.includes(m[2]);
  return UUID_RE.test(m[2]);
}
