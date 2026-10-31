// Pure editor operations on a theme's named menus. Client-safe: imports only shared, types and ops.
// No value coercion here (labels, links and pictures are clipped and checked by the server on save);
// only the structure rules the tree editor needs: limits, depth, and which items may hold children.
import type { Menu, MenuItem, ThemeData } from '../types';
import { ENGINE_LIMITS, newId } from '../shared';
import { uniqueId, type MakeId, type OpError, type OpResult } from './ops';

const LIMITS = ENGINE_LIMITS.menus;
const NEW_LINK_LABEL = 'New link';
const DEFAULT_MENU_NAME = 'Menu';
const DEFAULT_HEADER_MENU = 'main';
const DEFAULT_FOOTER_MENU = 'footer';

const fail = (reason: OpError): OpResult => ({ ok: false, reason });

function menusOf(theme: ThemeData): Menu[] {
  return Array.isArray(theme.settings?.menus) ? theme.settings.menus : [];
}

function withMenus(theme: ThemeData, menus: Menu[]): ThemeData {
  return { ...theme, settings: { ...theme.settings, menus } };
}

// ---- tree helpers ----------------------------------------------------------------------------

/** Where an item sits: its siblings, its position, and the items above it (top first). */
interface Loc {
  item: MenuItem;
  list: MenuItem[];
  index: number;
  ancestors: MenuItem[];
}

function locate(items: MenuItem[], id: string, ancestors: MenuItem[] = []): Loc | null {
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.id === id) return { item, list: items, index, ancestors };
    const inner = item.children ? locate(item.children, id, [...ancestors, item]) : null;
    if (inner) return inner;
  }
  return null;
}

const levelOf = (loc: Loc) => loc.ancestors.length + 1;

/** Levels in the subtree under (and including) an item: 1 for a leaf. */
function height(item: MenuItem): number {
  return 1 + Math.max(0, ...(item.children ?? []).map(height));
}

function withChildren(item: MenuItem, children: MenuItem[]): MenuItem {
  const { children: _old, ...rest } = item;
  void _old;
  return children.length ? { ...rest, children } : rest;
}

/**
 * The one tree edit every op uses: rebuilds the list of items under `parentId` (null = the top level)
 * with `fn`, sharing everything else. A parent left with no children loses its `children` key.
 */
function mapTree(items: MenuItem[], parentId: string | null, fn: (list: MenuItem[]) => MenuItem[]): MenuItem[] {
  if (parentId === null) return fn(items);
  return items.map((i) => {
    if (i.id === parentId) return withChildren(i, fn(i.children ?? []));
    return i.children ? { ...i, children: mapTree(i.children, parentId, fn) } : i;
  });
}

function stripTopOnly(item: MenuItem): MenuItem {
  const { highlight: _h, source: _s, category_photos: _c, picture: _p, ...rest } = item;
  void _h;
  void _s;
  void _c;
  void _p;
  return rest;
}

function allIds(items: MenuItem[], into = new Set<string>()): Set<string> {
  for (const i of items) {
    into.add(i.id);
    if (i.children) allIds(i.children, into);
  }
  return into;
}

/** A copy of an item and its descendants where every node has a fresh id unique across `used`. */
function reId(item: MenuItem, makeId: MakeId, used: Set<string>): MenuItem {
  const id = uniqueId(makeId, 'item', used);
  used.add(id);
  const copy: MenuItem = { ...item, id };
  if (item.children) copy.children = item.children.map((c) => reId(c, makeId, used));
  return copy;
}

function insertAt<T>(list: T[], index: number, value: T): T[] {
  return [...list.slice(0, index), value, ...list.slice(index)];
}

function removeAt<T>(list: T[], index: number): T[] {
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Runs an edit on one menu's items; the edit returns the new items (and a created id) or an error. */
function editMenu(
  theme: ThemeData,
  menuId: string,
  edit: (items: MenuItem[]) => { items: MenuItem[]; id?: string } | OpError,
): OpResult {
  const menus = menusOf(theme);
  const menu = menus.find((m) => m.id === menuId);
  if (!menu) return fail('not_found');
  const out = edit(menu.items);
  if (typeof out === 'string') return fail(out);
  const next = menus.map((m) => (m === menu ? { ...m, items: out.items } : m));
  return out.id === undefined ? { ok: true, theme: withMenus(theme, next) } : { ok: true, theme: withMenus(theme, next), id: out.id };
}

/** An item and its level (1 = top) in a menu's items, or null when it is not there. */
export function findMenuItem(items: MenuItem[], id: string): { item: MenuItem; level: number } | null {
  const loc = locate(items, id);
  return loc ? { item: loc.item, level: levelOf(loc) } : null;
}

// ---- menus -----------------------------------------------------------------------------------

/** True when a header or footer section (disabled ones too) points at this menu, by setting or by default. */
export function menuInUse(theme: ThemeData, menuId: string): boolean {
  const uses = (sections: Record<string, { type: string; settings: Record<string, unknown> }> | undefined, type: string, fallback: string) =>
    Object.values(sections ?? {}).some((s) => {
      if (s.type !== type) return false;
      const chosen = s.settings?.menu;
      return (typeof chosen === 'string' && chosen !== '' ? chosen : fallback) === menuId;
    });
  return uses(theme.header_group?.sections, 'header', DEFAULT_HEADER_MENU) || uses(theme.footer_group?.sections, 'footer', DEFAULT_FOOTER_MENU);
}

export function addMenu(theme: ThemeData, name: string, makeId: MakeId = newId): OpResult {
  const menus = menusOf(theme);
  if (menus.length >= LIMITS.menus) return fail('menu_limit');
  const id = uniqueId(makeId, 'menu', new Set(menus.map((m) => m.id)));
  const trimmed = name.trim();
  const menu: Menu = { id, name: trimmed === '' ? DEFAULT_MENU_NAME : trimmed, items: [] };
  return { ok: true, theme: withMenus(theme, [...menus, menu]), id };
}

export function renameMenu(theme: ThemeData, menuId: string, name: string): OpResult {
  const menus = menusOf(theme);
  if (!menus.some((m) => m.id === menuId)) return fail('not_found');
  const trimmed = name.trim();
  const next = menus.map((m) => (m.id === menuId ? { ...m, name: trimmed === '' ? DEFAULT_MENU_NAME : trimmed } : m));
  return { ok: true, theme: withMenus(theme, next) };
}

export function removeMenu(theme: ThemeData, menuId: string): OpResult {
  const menus = menusOf(theme);
  if (!menus.some((m) => m.id === menuId)) return fail('not_found');
  if (menuInUse(theme, menuId)) return fail('menu_in_use');
  return { ok: true, theme: withMenus(theme, menus.filter((m) => m.id !== menuId)) };
}

// ---- items -----------------------------------------------------------------------------------

export function addMenuItem(theme: ThemeData, menuId: string, parentId: string | null, makeId: MakeId = newId): OpResult {
  return editMenu(theme, menuId, (items) => {
    let siblings = items;
    if (parentId !== null) {
      const parent = locate(items, parentId);
      if (!parent) return 'not_found';
      if (levelOf(parent) >= LIMITS.depth) return 'menu_depth';
      if (parent.item.source === 'categories') return 'not_allowed_here';
      siblings = parent.item.children ?? [];
    }
    if (siblings.length >= LIMITS.itemsPerLevel) return 'menu_item_limit';
    const id = uniqueId(makeId, 'item', allIds(items));
    const item: MenuItem = { id, label: NEW_LINK_LABEL, link: '' };
    return { items: mapTree(items, parentId, (list) => [...list, item]), id };
  });
}

export function updateMenuItem(
  theme: ThemeData,
  menuId: string,
  itemId: string,
  patch: Partial<Omit<MenuItem, 'id' | 'children'>>,
): OpResult {
  return editMenu(theme, menuId, (items) => {
    const loc = locate(items, itemId);
    if (!loc) return 'not_found';
    const parentId = loc.ancestors.length ? loc.ancestors[loc.ancestors.length - 1].id : null;
    const next: MenuItem = { ...loc.item, ...patch, id: loc.item.id };
    if (loc.item.children) next.children = loc.item.children;
    return { items: mapTree(items, parentId, (list) => list.map((i) => (i.id === itemId ? next : i))) };
  });
}

export function moveMenuItem(theme: ThemeData, menuId: string, itemId: string, dir: 'up' | 'down' | 'in' | 'out'): OpResult {
  return editMenu(theme, menuId, (items) => {
    const loc = locate(items, itemId);
    if (!loc) return 'not_found';
    const parent = loc.ancestors.length ? loc.ancestors[loc.ancestors.length - 1] : null;
    const parentId = parent ? parent.id : null;

    if (dir === 'up' || dir === 'down') {
      const to = dir === 'up' ? loc.index - 1 : loc.index + 1;
      if (to < 0 || to >= loc.list.length) return 'not_found';
      return { items: mapTree(items, parentId, (list) => reorder(list, loc.index, to)) };
    }

    if (dir === 'in') {
      if (loc.index === 0) return 'not_found';
      const prev = loc.list[loc.index - 1];
      if (prev.source === 'categories') return 'not_allowed_here';
      if (levelOf(loc) + height(loc.item) > LIMITS.depth) return 'menu_depth';
      if ((prev.children ?? []).length >= LIMITS.itemsPerLevel) return 'menu_item_limit';
      // The new level is always below the top, so the top-only fields go.
      const moved = stripTopOnly(loc.item);
      const without = mapTree(items, parentId, (list) => removeAt(list, loc.index));
      return { items: mapTree(without, prev.id, (kids) => [...kids, moved]) };
    }

    // out
    if (!parent) return 'not_found';
    const grand = loc.ancestors.length > 1 ? loc.ancestors[loc.ancestors.length - 2] : null;
    const level = grand ? (grand.children ?? []) : items;
    if (level.length >= LIMITS.itemsPerLevel) return 'menu_item_limit';
    const without = mapTree(items, parent.id, (kids) => removeAt(kids, loc.index));
    // The parent's own level is untouched by the removal above, so its position is stable.
    return {
      items: mapTree(without, grand ? grand.id : null, (list) =>
        insertAt(list, list.findIndex((i) => i.id === parent.id) + 1, loc.item),
      ),
    };
  });
}

export function reorderMenuItem(theme: ThemeData, menuId: string, itemId: string, toIndex: number): OpResult {
  return editMenu(theme, menuId, (items) => {
    const loc = locate(items, itemId);
    if (!loc) return 'not_found';
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= loc.list.length) return 'not_found';
    if (toIndex === loc.index) return { items };
    const parentId = loc.ancestors.length ? loc.ancestors[loc.ancestors.length - 1].id : null;
    return { items: mapTree(items, parentId, (list) => reorder(list, loc.index, toIndex)) };
  });
}

export function duplicateMenuItem(theme: ThemeData, menuId: string, itemId: string, makeId: MakeId = newId): OpResult {
  return editMenu(theme, menuId, (items) => {
    const loc = locate(items, itemId);
    if (!loc) return 'not_found';
    if (loc.list.length >= LIMITS.itemsPerLevel) return 'menu_item_limit';
    const copy = reId(loc.item, makeId, allIds(items));
    const parentId = loc.ancestors.length ? loc.ancestors[loc.ancestors.length - 1].id : null;
    return { items: mapTree(items, parentId, (list) => insertAt(list, loc.index + 1, copy)), id: copy.id };
  });
}

export function removeMenuItem(theme: ThemeData, menuId: string, itemId: string): OpResult {
  return editMenu(theme, menuId, (items) => {
    const loc = locate(items, itemId);
    if (!loc) return 'not_found';
    const parentId = loc.ancestors.length ? loc.ancestors[loc.ancestors.length - 1].id : null;
    return { items: mapTree(items, parentId, (list) => removeAt(list, loc.index)) };
  });
}
