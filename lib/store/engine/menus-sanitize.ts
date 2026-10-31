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

// ---- One-time conversion of the old header `menu_link` and footer `link_column` blocks into menus ----

const LEGACY_HEADER_BLOCK = 'menu_link';
const LEGACY_FOOTER_BLOCK = 'link_column';

type RawSection = Record<string, unknown>;

/** The first section of `type` in a raw header or footer group, as [id, section]. */
function findSection(group: unknown, type: string): [string, RawSection] | null {
  if (!isObject(group) || !isObject(group.sections) || !Array.isArray(group.order)) return null;
  for (const id of group.order) {
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(group.sections, id)) continue;
    const s = group.sections[id];
    if (isObject(s) && s.type === type) return [id, s];
  }
  return null;
}

/** Enabled blocks of one type, in `block_order`. */
function enabledBlocks(section: RawSection, type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (!isObject(section.blocks) || !Array.isArray(section.block_order)) return out;
  for (const id of section.block_order) {
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(section.blocks, id)) continue;
    const b = section.blocks[id];
    if (!isObject(b) || b.type !== type || b.disabled === true) continue;
    out.push(isObject(b.settings) ? b.settings : {});
  }
  return out;
}

/** The section without its blocks of `legacyType`, and with `menu` set. Other blocks stay (the sanitiser handles them). */
function withMenu(section: RawSection, legacyType: string, menuId: string): RawSection {
  const blocks = isObject(section.blocks) ? section.blocks : {};
  const order = Array.isArray(section.block_order) ? section.block_order : [];
  const keptOrder = order.filter((id) => typeof id === 'string' && !(isObject(blocks[id]) && (blocks[id] as RawSection).type === legacyType));
  const keptBlocks: Record<string, unknown> = {};
  for (const [id, b] of Object.entries(blocks)) {
    if (!(isObject(b) && b.type === legacyType)) keptBlocks[id] = b;
  }
  return {
    ...section,
    settings: { ...(isObject(section.settings) ? section.settings : {}), menu: menuId },
    blocks: keptBlocks,
    block_order: keptOrder,
  };
}

/** The old footer text rule: `Label|/url` per line; a line without `|`, an empty label or a bad link is skipped. */
function footerLinks(raw: unknown): { label: string; link: string }[] {
  const out: { label: string; link: string }[] = [];
  if (typeof raw !== 'string') return out;
  for (const line of raw.split('\n')) {
    const i = line.indexOf('|');
    if (i < 0) continue;
    const label = line.slice(0, i).trim();
    const href = sanitizeSettingValue(URL_SCHEMA, line.slice(i + 1).trim());
    if (label && typeof href === 'string' && href) out.push({ label, link: href });
  }
  return out;
}

/**
 * Turn the old header `menu_link` blocks and footer `link_column` blocks of a RAW theme into the `main` and `footer` menus.
 * Applies when the theme has no usable menus yet (`settings.menus` is missing, not an array, or holds nothing valid; a
 * preset or a migrated store arrives with `[]`); a theme with menus is returned unchanged. After one run both menus
 * exist, so a second run changes nothing. Returns a new object; the input is untouched. Must run before the header and
 * footer are sanitised, because their schemas no longer declare the old block types.
 */
export function convertLegacyMenus(raw: Record<string, unknown>): Record<string, unknown> {
  const settings = isObject(raw.settings) ? raw.settings : {};
  if (sanitizeMenus(settings.menus).length > 0) return { ...raw };

  const out: Record<string, unknown> = { ...raw };

  let n = 0;
  const nextId = () => `m${++n}`;

  const mainItems: MenuItem[] = [];
  const header = findSection(raw.header_group, 'header');
  if (header) {
    for (const b of enabledBlocks(header[1], LEGACY_HEADER_BLOCK)) {
      const label = typeof b.label === 'string' ? b.label : 'All Products';
      const link = typeof b.link === 'string' && b.link.trim() ? b.link : '/';
      const item: MenuItem = { id: nextId(), label, link };
      if (b.highlight === true) item.highlight = true;
      mainItems.push(item);
    }
  }

  n = 0;
  const footerItems: MenuItem[] = [];
  const footer = findSection(raw.footer_group, 'footer');
  if (footer) {
    for (const b of enabledBlocks(footer[1], LEGACY_FOOTER_BLOCK)) {
      const item: MenuItem = { id: nextId(), label: typeof b.heading === 'string' ? b.heading : 'Shop', link: '' };
      const links = footerLinks(b.links).map((l) => ({ id: nextId(), label: l.label, link: l.link }));
      if (links.length > 0) item.children = links;
      footerItems.push(item);
    }
  }

  out.settings = {
    ...settings,
    menus: sanitizeMenus([
      { id: 'main', name: 'Main menu', items: mainItems },
      { id: 'footer', name: 'Footer menu', items: footerItems },
    ]),
  };

  const swap = (groupKey: 'header_group' | 'footer_group', found: [string, RawSection] | null, legacyType: string, menuId: string) => {
    if (!found) return;
    const group = raw[groupKey] as Record<string, unknown>;
    out[groupKey] = { ...group, sections: { ...(group.sections as Record<string, unknown>), [found[0]]: withMenu(found[1], legacyType, menuId) } };
  };
  swap('header_group', header, LEGACY_HEADER_BLOCK, 'main');
  swap('footer_group', footer, LEGACY_FOOTER_BLOCK, 'footer');
  return out;
}
