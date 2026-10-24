/**
 * Which sidebar href is the current page.
 * The longest matching path wins, then a query or hash on that same path.
 * A list link stays current when the page adds filter params, unless another
 * link's query or hash matches those params more closely.
 */

export function parseNavHref(href: string): { path: string; query: string; hash: string } {
  const hashIdx = href.indexOf('#');
  const hash = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
  const beforeHash = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const qIdx = beforeHash.indexOf('?');
  const path = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
  const query = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : '';
  return { path, query, hash };
}

export function navHrefMatchScore(
  href: string,
  pathname: string,
  search: string,
  hash: string,
): number | null {
  if (!href || href === '#' || !pathname) return null;
  const parsed = parseNavHref(href);
  if (!parsed.path) return null;

  const exact = pathname === parsed.path;
  const prefix = pathname.startsWith(`${parsed.path}/`);
  if (!exact && !prefix) return null;

  if (parsed.hash) {
    if (!exact || hash !== parsed.hash) return null;
  }

  if (parsed.query) {
    if (!exact) return null;
    const wanted = new URLSearchParams(parsed.query);
    const actual = new URLSearchParams(search);
    for (const [key, value] of wanted.entries()) {
      if (actual.get(key) !== value) return null;
    }
  }

  let score = parsed.path.length;
  if (exact) score += 10_000;
  if (parsed.query) score += 1_000 + parsed.query.length;
  if (parsed.hash) score += 1_000 + parsed.hash.length;
  return score;
}

export function pickActiveNavHref(
  hrefs: readonly string[],
  pathname: string,
  search: string,
  hash: string,
): string | null {
  let bestHref: string | null = null;
  let bestScore = -1;
  for (const href of hrefs) {
    const score = navHrefMatchScore(href, pathname, search, hash);
    if (score == null || score <= bestScore) continue;
    bestScore = score;
    bestHref = href;
  }
  return bestHref;
}

export function collectNavHrefs(
  items: ReadonlyArray<{ href?: string; subItems?: ReadonlyArray<unknown> }>,
): string[] {
  const out: string[] = [];
  const walk = (list: ReadonlyArray<{ href?: string; subItems?: ReadonlyArray<unknown> }>) => {
    for (const item of list) {
      if (item.href && item.href !== '#') out.push(item.href);
      if (item.subItems?.length) {
        walk(item.subItems as ReadonlyArray<{ href?: string; subItems?: ReadonlyArray<unknown> }>);
      }
    }
  };
  walk(items);
  return out;
}
