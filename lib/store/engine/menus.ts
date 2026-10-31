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

/**
 * Which desktop menu item is open, and the one delayed step waiting on a timer (hover opens after a short delay and
 * closes after a grace period). `hoverOpened` remembers that hover opened the item, so a mouse click on its ▾ that
 * follows keeps it open instead of closing it.
 */
export interface MenuOpenState {
  open: string | null;
  hoverOpened: string | null;
  pending: { kind: 'open'; id: string } | { kind: 'close' } | null;
}

export type MenuOpenEvent =
  | { type: 'enter'; id: string; hasPanel: boolean }
  | { type: 'leave'; id: string }
  /** The pending step's timer ran out. */
  | { type: 'fire' }
  | { type: 'toggle'; id: string; mouse: boolean }
  /** Keyboard open (ArrowDown). */
  | { type: 'open'; id: string }
  /** Esc or outside click (no id), or focus leaving that item (id). */
  | { type: 'close'; id?: string };

export const MENU_CLOSED: MenuOpenState = { open: null, hoverOpened: null, pending: null };

export function menuOpenStep(s: MenuOpenState, e: MenuOpenEvent): MenuOpenState {
  switch (e.type) {
    case 'enter':
      // A plain link leaves a pending close of the open item running.
      if (!e.hasPanel) return s;
      if (s.open === e.id) return s.pending ? { ...s, pending: null } : s;
      return { ...s, pending: { kind: 'open', id: e.id } };
    case 'leave':
      if (s.open !== null) return s.pending?.kind === 'close' ? s : { ...s, pending: { kind: 'close' } };
      return s.pending?.kind === 'open' && s.pending.id === e.id ? { ...s, pending: null } : s;
    case 'fire':
      if (!s.pending) return s;
      return s.pending.kind === 'open'
        ? { open: s.pending.id, hoverOpened: s.pending.id, pending: null }
        : MENU_CLOSED;
    case 'toggle':
      if (e.mouse && s.open === e.id && s.hoverOpened === e.id) return { open: e.id, hoverOpened: null, pending: null };
      return { open: s.open === e.id ? null : e.id, hoverOpened: null, pending: null };
    case 'open':
      return s.open === e.id && !s.pending && !s.hoverOpened ? s : { open: e.id, hoverOpened: null, pending: null };
    case 'close':
      if (e.id !== undefined && s.open !== e.id) return s;
      return s.open === null && !s.pending ? s : MENU_CLOSED;
  }
}
