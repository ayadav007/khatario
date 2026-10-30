// Client-safe: no imports, so storefront client components can use it without pulling in the sanitisers.

/** Query keys a storefront link keeps: theme preview and the old Studio draft token. */
const KEPT_PARAMS = ['preview_theme', 'pt', 'td'];
/** Kept only alongside a theme preview (`preview_theme` and `pt`): the Studio 2 frame stays in editor mode. */
const PREVIEW_ONLY_PARAMS = ['editor'];

/**
 * Home-page URL with the catalog narrowed by `cat` and/or `q` (empty values are dropped),
 * keeping any preview params from the current query string.
 */
export function catalogHref(
  currentSearch: string,
  next: { cat?: string | null; q?: string | null },
  hash?: string,
): string {
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
  if (next.cat) out.set('cat', next.cat);
  if (next.q) out.set('q', next.q);
  const qs = out.toString();
  return `/${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`;
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
