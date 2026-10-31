/**
 * Render model for store menus: turns a stored Menu into what the header, the phone panel, the footer and the
 * Quick pills draw. Pure and client-safe (imports types only).
 */
import type { Menu, MenuItem, MenuPicture } from './types';

export type MenuItemKind = 'link' | 'dropdown' | 'mega' | 'categories';

export interface MenuCategory {
  id: string;
  name: string;
  image_url: string | null;
}

export interface ResolvedItem {
  id: string;
  label: string;
  href: string;
  highlight: boolean;
  kind: MenuItemKind;
  children: ResolvedItem[];
  picture?: MenuPicture;
  categoryPhotos: boolean;
  categories?: MenuCategory[];
}

const CATALOG = '/catalog';

/** The kind of a stored item: automatic categories, a mega menu (any grandchild), a dropdown, or a plain link. */
export function menuItemKind(item: MenuItem): MenuItemKind {
  if (item.source === 'categories') return 'categories';
  const kids = item.children ?? [];
  if (kids.length === 0) return 'link';
  return kids.some((k) => (k.children ?? []).length > 0) ? 'mega' : 'dropdown';
}

/** The chosen menu, else the fallback menu (`main` for the header, `footer` for the footer), else null. */
export function pickMenu(menus: Menu[], id: unknown, fallbackId: 'main' | 'footer'): Menu | null {
  if (typeof id === 'string') {
    const chosen = menus.find((m) => m.id === id);
    if (chosen) return chosen;
  }
  return menus.find((m) => m.id === fallbackId) ?? null;
}

/** The category id of a link written by the editor's link picker (`/catalog/<encoded id>`), else null. */
function categoryIdOfLink(link: string): string | null {
  const m = /^\/catalog\/([^/?#]+)(?:[?#].*)?$/.exec(link);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function kindOfResolved(children: ResolvedItem[]): MenuItemKind {
  if (children.length === 0) return 'link';
  return children.some((c) => c.children.length > 0) ? 'mega' : 'dropdown';
}

function resolveItems(
  items: MenuItem[],
  categories: MenuCategory[] | null,
  known: Set<string> | null,
  top: boolean,
): ResolvedItem[] {
  const out: ResolvedItem[] = [];
  for (const item of items) {
    const catId = known ? categoryIdOfLink(item.link) : null;
    const gone = catId !== null && known !== null && !known.has(catId);

    if (top && item.source === 'categories') {
      const withCats = categories !== null && categories.length > 0;
      out.push({
        id: item.id,
        label: item.label,
        href: item.link || CATALOG,
        highlight: item.highlight === true,
        kind: withCats ? 'categories' : 'link',
        children: [],
        categoryPhotos: item.category_photos === true,
        ...(withCats ? { categories } : {}),
        ...(item.picture ? { picture: item.picture } : {}),
      });
      continue;
    }

    const children = resolveItems(item.children ?? [], categories, known, false);
    // A hidden link with surviving children stays as a heading without a link.
    if (gone && children.length === 0) continue;
    out.push({
      id: item.id,
      label: item.label,
      href: gone ? '' : item.link,
      highlight: top && item.highlight === true,
      kind: kindOfResolved(children),
      children,
      categoryPhotos: false,
      ...(top && item.picture ? { picture: item.picture } : {}),
    });
  }
  return out;
}

/**
 * Resolves a menu for drawing. `categories` are the store's categories that have products; `null` means the lookup
 * failed (keep every link; an automatic categories item becomes a plain link to /catalog).
 */
export function resolveMenu(menu: Menu | null, categories: MenuCategory[] | null): ResolvedItem[] {
  if (!menu) return [];
  const known = categories ? new Set(categories.map((c) => c.id)) : null;
  return resolveItems(menu.items, categories, known, true);
}

/** Footer columns: each top item is a heading, its children the links, third-level links right after their group. */
export function menuFooterColumns(
  items: ResolvedItem[],
): { heading: string; href: string; links: { label: string; href: string }[] }[] {
  return items.map((top) => {
    const links: { label: string; href: string }[] = [];
    for (const child of top.children) {
      links.push({ label: child.label, href: child.href });
      for (const grand of child.children) links.push({ label: grand.label, href: grand.href });
    }
    return { heading: top.label, href: top.href, links };
  });
}

/** How many items stay in the bar: all when they fit, else the most that fit beside the "More" item (at least 0). */
export function foldMenu(widths: number[], available: number, moreWidth: number): number {
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= available) return widths.length;
  let sum = 0;
  let keep = 0;
  for (let i = 0; i < widths.length; i++) {
    sum += widths[i];
    if (sum + moreWidth <= available) keep = i + 1;
    else break;
  }
  return keep;
}
