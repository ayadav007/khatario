// Client-safe: no imports, so storefront client components can use it without pulling in the sanitisers.

/** Query keys a storefront link keeps: theme preview and the old Studio draft token. */
const KEPT_PARAMS = ['preview_theme', 'pt', 'td'];
/** Kept only alongside a theme preview (`preview_theme` and `pt`): the Studio 2 frame stays in editor mode. */
const PREVIEW_ONLY_PARAMS = ['editor'];
/** Category ids are uuids; anything else in `cat` cannot name a category. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Home-page URL with the catalog narrowed by `cat` and/or `q` (empty values are dropped),
 * keeping any preview params from the current query string.
 */
export function catalogHref(
  currentSearch: string,
  next: { cat?: string | null; q?: string | null },
  hash?: string,
): string {
  const out = keptParams(currentSearch);
  if (next.cat) out.set('cat', next.cat);
  if (next.q) out.set('q', next.q);
  const qs = out.toString();
  return `/${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`;
}

/** The preview params of a query string that a storefront link carries on. */
function keptParams(currentSearch: string): URLSearchParams {
  const current = new URLSearchParams(currentSearch);
  const out = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const v = current.get(key);
    if (v) out.set(key, v);
  }
  if (out.get('preview_theme') && out.get('pt')) {
    for (const key of PREVIEW_ONLY_PARAMS) {
      const v = current.get(key);
      if (v) out.set(key, v);
    }
  }
  return out;
}

/** Engine catalog URL (D14): `/catalog[/<category id>]?q=…`, keeping preview params as catalogHref does. */
export function engineCatalogHref(
  currentSearch: string,
  next: { categoryId?: string | null; q?: string | null },
): string {
  const out = keptParams(currentSearch);
  if (next.q) out.set('q', next.q);
  const qs = out.toString();
  return `/catalog${next.categoryId ? `/${encodeURIComponent(next.categoryId)}` : ''}${qs ? `?${qs}` : ''}`;
}

/** A product page URL that keeps preview params, as engineCatalogHref does. */
export function engineProductHref(currentSearch: string, productId: string): string {
  const qs = keptParams(currentSearch).toString();
  return `/products/${encodeURIComponent(productId)}${qs ? `?${qs}` : ''}`;
}

/**
 * Where an old or misplaced catalog URL goes (D14), or null to stay:
 * - an engine home with `cat` or `q` → the engine catalog (a `cat` that is not a uuid is dropped, so a
 *   malformed link shows the home, or the catalog search, instead of a 404);
 * - `/catalog[/<id>]` on a store without the engine catalog → the home with `cat=<id>` and the rest of the query.
 */
export function catalogRedirect(engine: boolean, path: string, search: string): string | null {
  const query = new URLSearchParams(search);
  if (engine) {
    if (path !== '/') return null;
    const rawCat = query.get('cat');
    const categoryId = rawCat && UUID_RE.test(rawCat) ? rawCat : null;
    const q = query.get('q');
    if (!categoryId && !q) return null;
    return engineCatalogHref(search, { categoryId, q });
  }
  const m = /^\/catalog(?:\/([^/]+))?\/?$/.exec(path);
  if (!m) return null;
  if (m[1]) {
    let id = m[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep it as written */
    }
    query.delete('cat');
    query.set('cat', id);
  }
  const qs = query.toString();
  return `/${qs ? `?${qs}` : ''}`;
}

/**
 * The link the product Share button shares: origin + path, never the query or hash, so a preview token
 * (`preview_theme`, `pt`, `td`) is never passed on. An unparsable href gives '' (Share is then hidden).
 */
export function shareUrl(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

export type CtaTarget =
  | { kind: 'none' }
  | { kind: 'anchor'; id: string }
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string };

/** Where a banner/hero button goes. Same rules as the `url` setting; anything else does nothing. */
export function ctaTarget(link: unknown): CtaTarget {
  if (typeof link !== 'string') return { kind: 'none' };
  const v = link.trim();
  if (/^#[\w-]+$/.test(v)) return { kind: 'anchor', id: v.slice(1) };
  if (/^\/(?!\/)[^\s\\\x00-\x1f]*$/.test(v)) return { kind: 'internal', href: v };
  try {
    const u = new URL(v);
    if (u.protocol === 'https:') return { kind: 'external', href: u.href };
  } catch {
    /* not a URL */
  }
  return { kind: 'none' };
}
