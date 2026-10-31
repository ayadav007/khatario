import type { Menu, MenuItem, MenuPicture } from './types';
import type { SettingSchema } from './schema-types';
import { ENGINE_LIMITS, ID_RE } from './shared';
import { sanitizeSettingValue } from './settings';

const URL_SCHEMA: SettingSchema = { id: 'url', type: 'url', label: 'URL' };
const IMAGE_SCHEMA: SettingSchema = { id: 'image', type: 'image', label: 'Image' };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id) && id !== '__proto__';
}

/** Trim, then keep the first `max` characters (code points, so an emoji is never split). */
function clip(raw: unknown, max: number): string {
  return typeof raw === 'string' ? Array.from(raw.trim()).slice(0, max).join('') : '';
}

function cleanLink(raw: unknown): string {
  const v = sanitizeSettingValue(URL_SCHEMA, raw);
  return typeof v === 'string' ? v : '';
}

function cleanPicture(raw: unknown): MenuPicture | undefined {
  if (!isObject(raw)) return undefined;
  const image = sanitizeSettingValue(IMAGE_SCHEMA, raw.image);
  if (typeof image !== 'string' || image === '') return undefined;
  return { image, caption: clip(raw.caption, ENGINE_LIMITS.menus.caption), link: cleanLink(raw.link) };
}

function cleanItems(raw: unknown, level: number, ids: Set<string>): MenuItem[] {
  const out: MenuItem[] = [];
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    if (out.length >= ENGINE_LIMITS.menus.itemsPerLevel) break;
    if (!isObject(r) || !validId(r.id) || ids.has(r.id)) continue;
    const label = clip(r.label, ENGINE_LIMITS.menus.label);
    if (!label) continue;
    ids.add(r.id);
    const item: MenuItem = { id: r.id, label, link: cleanLink(r.link) };
    const top = level === 1;
    const automatic = top && r.source === 'categories';
    if (top) {
      if (r.highlight === true) item.highlight = true;
      if (r.source === 'categories' || r.source === 'links') item.source = r.source;
      if (typeof r.category_photos === 'boolean') item.category_photos = r.category_photos;
      const picture = cleanPicture(r.picture);
      if (picture) item.picture = picture;
    }
    if (!automatic && level < ENGINE_LIMITS.menus.depth) {
      const children = cleanItems(r.children, level + 1, ids);
      if (children.length > 0) item.children = children;
    }
    out.push(item);
  }
  return out;
}

/** Clean a theme's menus: limits, depth, ids, links, pictures, and top-only fields. Anything that is not an array gives []. */
export function sanitizeMenus(raw: unknown): Menu[] {
  const out: Menu[] = [];
  if (!Array.isArray(raw)) return out;
  const menuIds = new Set<string>();
  for (const r of raw) {
    if (out.length >= ENGINE_LIMITS.menus.menus) break;
    if (!isObject(r) || !validId(r.id) || menuIds.has(r.id)) continue;
    menuIds.add(r.id);
    out.push({ id: r.id, name: clip(r.name, ENGINE_LIMITS.menus.name) || 'Menu', items: cleanItems(r.items, 1, new Set<string>()) });
  }
  return out;
}
