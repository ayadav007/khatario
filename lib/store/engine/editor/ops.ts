// Pure editor operations on a ThemeData. Client-safe: imports only shared, types, schema-types and registry.
// No value coercion here: the server sanitises on save.
import type { Block, ColorScheme, PageTemplate, Section, Template, TemplateKind, ThemeData } from '../types';
import type { SectionSchema } from '../schema-types';
import { getSectionSchema } from '../registry';
import { ENGINE_LIMITS, ID_RE, defaultSettings, newId } from '../shared';

export type GroupKey = 'header' | 'footer' | 'template';
export interface SectionRef {
  group: GroupKey;
  id: string;
}
export type OpError =
  | 'unknown_type'
  | 'not_allowed_here'
  | 'section_limit'
  | 'type_limit'
  | 'block_limit'
  | 'block_type_limit'
  | 'unknown_block_type'
  | 'not_found';
export type OpResult = { ok: true; theme: ThemeData; id?: string } | { ok: false; reason: OpError };
type MakeId = (prefix?: string) => string;

export const OP_ERROR_TEXT: Record<OpError, string> = {
  unknown_type: 'This section type is not available',
  not_allowed_here: 'This section cannot be added to this page',
  section_limit: `A page can have up to ${ENGINE_LIMITS.sectionsPerTemplate} sections`,
  type_limit: 'This section type has reached its limit on this page',
  block_limit: 'This section has reached its block limit',
  block_type_limit: 'This block type has reached its limit in this section',
  unknown_block_type: 'This block type is not available in this section',
  not_found: 'That item no longer exists',
};

const fail = (reason: OpError): OpResult => ({ ok: false, reason });
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function templateKind(templateKey: string, group: GroupKey): TemplateKind {
  if (group === 'header') return 'header';
  if (group === 'footer') return 'footer';
  if (templateKey === 'home' || templateKey === 'product' || templateKey === 'catalog') return templateKey;
  return 'page';
}

const EMPTY: Template = { order: [], sections: {} };

function findGroup(theme: ThemeData, templateKey: string, group: GroupKey): Template | null {
  if (group === 'header') return theme.header_group;
  if (group === 'footer') return theme.footer_group;
  return hasOwn(theme.templates, templateKey) ? theme.templates[templateKey] : null;
}

export function getGroup(theme: ThemeData, templateKey: string, group: GroupKey): Template {
  return findGroup(theme, templateKey, group) ?? EMPTY;
}

function withGroup(theme: ThemeData, templateKey: string, group: GroupKey, next: Template): ThemeData {
  if (group === 'header') return { ...theme, header_group: { ...theme.header_group, order: next.order, sections: next.sections } };
  if (group === 'footer') return { ...theme, footer_group: { ...theme.footer_group, order: next.order, sections: next.sections } };
  const old = theme.templates[templateKey] as PageTemplate;
  return { ...theme, templates: { ...theme.templates, [templateKey]: { ...old, order: next.order, sections: next.sections } } };
}

function allSectionIds(theme: ThemeData): Set<string> {
  const used = new Set<string>();
  const groups: Template[] = [theme.header_group, theme.footer_group, ...Object.values(theme.templates)];
  for (const g of groups) {
    for (const id of g.order) used.add(id);
    for (const id of Object.keys(g.sections)) used.add(id);
  }
  return used;
}

function uniqueId(makeId: MakeId, prefix: string, used: ReadonlySet<string>): string {
  for (let i = 0; i < 20; i++) {
    const id = makeId(prefix);
    if (ID_RE.test(id) && !used.has(id)) return id;
  }
  for (let n = 2; n < 100000; n++) {
    const suffix = String(n);
    const id = `${newId(prefix).slice(0, 32 - suffix.length)}${suffix}`;
    if (ID_RE.test(id) && !used.has(id)) return id;
  }
  return newId(prefix);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function blockCap(schema: SectionSchema): number {
  return Math.min(schema.max_blocks ?? ENGINE_LIMITS.blocksPerSection, ENGINE_LIMITS.blocksPerSection);
}

function findSection(theme: ThemeData, templateKey: string, ref: SectionRef): { g: Template; section: Section } | null {
  const g = findGroup(theme, templateKey, ref.group);
  if (!g || !hasOwn(g.sections, ref.id)) return null;
  return { g, section: g.sections[ref.id] };
}

function checkSectionAdd(g: Template, kind: TemplateKind, type: string): OpError | null {
  const schema = getSectionSchema(type);
  if (!schema) return 'unknown_type';
  if (!schema.templates.includes(kind)) return 'not_allowed_here';
  if (g.order.length >= ENGINE_LIMITS.sectionsPerTemplate) return 'section_limit';
  if (schema.limit !== undefined && g.order.filter((id) => g.sections[id]?.type === type).length >= schema.limit) return 'type_limit';
  return null;
}

export function canAddSection(theme: ThemeData, templateKey: string, group: GroupKey, type: string): OpError | null {
  const g = findGroup(theme, templateKey, group);
  if (!g) return 'not_found';
  return checkSectionAdd(g, templateKind(templateKey, group), type);
}

function checkBlockAdd(section: Section, blockType: string): OpError | null {
  const schema = getSectionSchema(section.type);
  const bs = schema?.blocks?.find((b) => b.type === blockType);
  if (!schema || !bs) return 'unknown_block_type';
  if (section.block_order.length >= blockCap(schema)) return 'block_limit';
  if (bs.limit !== undefined && section.block_order.filter((id) => section.blocks[id]?.type === blockType).length >= bs.limit) {
    return 'block_type_limit';
  }
  return null;
}

export function canAddBlock(theme: ThemeData, templateKey: string, ref: SectionRef, blockType: string): OpError | null {
  const found = findSection(theme, templateKey, ref);
  if (!found) return 'not_found';
  return checkBlockAdd(found.section, blockType);
}

function insertAt<T>(arr: readonly T[], index: number, item: T): T[] {
  const i = Number.isFinite(index) ? Math.max(0, Math.min(arr.length, Math.trunc(index))) : arr.length;
  return [...arr.slice(0, i), item, ...arr.slice(i)];
}

function inRange(i: number, len: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < len;
}

function reorder<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function addSection(
  theme: ThemeData,
  templateKey: string,
  group: GroupKey,
  type: string,
  index: number,
  presetIndex = 0,
  makeId: MakeId = newId,
): OpResult {
  const g = findGroup(theme, templateKey, group);
  if (!g) return fail('not_found');
  const err = checkSectionAdd(g, templateKind(templateKey, group), type);
  if (err) return fail(err);
  const schema = getSectionSchema(type) as SectionSchema;
  const preset = schema.presets[presetIndex] ?? schema.presets[0];
  const blocks: Record<string, Block> = {};
  const block_order: string[] = [];
  const cap = blockCap(schema);
  const perType: Record<string, number> = {};
  for (const pb of preset?.blocks ?? []) {
    const bs = schema.blocks?.find((b) => b.type === pb.type);
    if (!bs || block_order.length >= cap) continue;
    const used = perType[bs.type] ?? 0;
    if (bs.limit !== undefined && used >= bs.limit) continue;
    perType[bs.type] = used + 1;
    const bid = uniqueId(makeId, bs.type, new Set(block_order));
    blocks[bid] = { type: bs.type, settings: { ...defaultSettings(bs.settings), ...(pb.settings ?? {}) } };
    block_order.push(bid);
  }
  const section: Section = {
    type,
    settings: { ...defaultSettings(schema.settings), ...(preset?.settings ?? {}) },
    blocks,
    block_order,
  };
  const id = uniqueId(makeId, type, allSectionIds(theme));
  const next: Template = { order: insertAt(g.order, index, id), sections: { ...g.sections, [id]: section } };
  return { ok: true, theme: withGroup(theme, templateKey, group, next), id };
}

export function duplicateSection(theme: ThemeData, templateKey: string, ref: SectionRef, makeId: MakeId = newId): OpResult {
  const found = findSection(theme, templateKey, ref);
  if (!found) return fail('not_found');
  const { g, section } = found;
  const err = checkSectionAdd(g, templateKind(templateKey, ref.group), section.type);
  if (err) return fail(err);
  const copy = clone(section);
  const blocks: Record<string, Block> = {};
  const block_order: string[] = [];
  for (const oldId of section.block_order) {
    const b = copy.blocks[oldId];
    if (!b) continue;
    const bid = uniqueId(makeId, b.type, new Set(block_order));
    blocks[bid] = b;
    block_order.push(bid);
  }
  copy.blocks = blocks;
  copy.block_order = block_order;
  const id = uniqueId(makeId, section.type, allSectionIds(theme));
  const at = g.order.indexOf(ref.id);
  const next: Template = {
    order: insertAt(g.order, at < 0 ? g.order.length : at + 1, id),
    sections: { ...g.sections, [id]: copy },
  };
  return { ok: true, theme: withGroup(theme, templateKey, ref.group, next), id };
}

export function removeSection(theme: ThemeData, templateKey: string, ref: SectionRef): OpResult {
  const found = findSection(theme, templateKey, ref);
  if (!found) return fail('not_found');
  const sections = { ...found.g.sections };
  delete sections[ref.id];
  const next: Template = { order: found.g.order.filter((id) => id !== ref.id), sections };
  return { ok: true, theme: withGroup(theme, templateKey, ref.group, next) };
}

export function moveSection(theme: ThemeData, templateKey: string, group: GroupKey, from: number, to: number): OpResult {
  const g = findGroup(theme, templateKey, group);
  if (!g || !inRange(from, g.order.length) || !inRange(to, g.order.length)) return fail('not_found');
  return { ok: true, theme: withGroup(theme, templateKey, group, { order: reorder(g.order, from, to), sections: g.sections }) };
}

function mapSection(theme: ThemeData, templateKey: string, ref: SectionRef, fn: (s: Section) => Section): OpResult {
  const found = findSection(theme, templateKey, ref);
  if (!found) return fail('not_found');
  const next: Template = { order: found.g.order, sections: { ...found.g.sections, [ref.id]: fn(found.section) } };
  return { ok: true, theme: withGroup(theme, templateKey, ref.group, next) };
}

function toggled<T extends { disabled?: boolean }>(item: T): T {
  const out = { ...item };
  if (out.disabled) delete out.disabled;
  else out.disabled = true;
  return out;
}

export function toggleSection(theme: ThemeData, templateKey: string, ref: SectionRef): OpResult {
  return mapSection(theme, templateKey, ref, toggled);
}

export function updateSection(
  theme: ThemeData,
  templateKey: string,
  ref: SectionRef,
  patch: Partial<Pick<Section, 'label' | 'color_scheme' | 'css_class' | 'custom_css'>>,
): OpResult {
  return mapSection(theme, templateKey, ref, (s) => {
    const out: Section = { ...s };
    for (const key of ['label', 'color_scheme', 'css_class', 'custom_css'] as const) {
      if (!(key in patch)) continue;
      const raw = patch[key];
      const v = key === 'label' && typeof raw === 'string' ? raw.trim() : raw;
      if (v === undefined || v === '') delete out[key];
      else out[key] = v;
    }
    return out;
  });
}

export function setSectionSetting(theme: ThemeData, templateKey: string, ref: SectionRef, key: string, value: unknown): OpResult {
  return mapSection(theme, templateKey, ref, (s) => ({ ...s, settings: { ...s.settings, [key]: value } }));
}

export function addBlock(
  theme: ThemeData,
  templateKey: string,
  ref: SectionRef,
  blockType: string,
  index: number,
  makeId: MakeId = newId,
): OpResult {
  const found = findSection(theme, templateKey, ref);
  if (!found) return fail('not_found');
  const err = checkBlockAdd(found.section, blockType);
  if (err) return fail(err);
  const bs = getSectionSchema(found.section.type)?.blocks?.find((b) => b.type === blockType);
  const bid = uniqueId(makeId, blockType, new Set(found.section.block_order));
  const block: Block = { type: blockType, settings: defaultSettings(bs?.settings ?? []) };
  const res = mapSection(theme, templateKey, ref, (s) => ({
    ...s,
    blocks: { ...s.blocks, [bid]: block },
    block_order: insertAt(s.block_order, index, bid),
  }));
  return res.ok ? { ...res, id: bid } : res;
}

export function duplicateBlock(theme: ThemeData, templateKey: string, ref: SectionRef, blockId: string, makeId: MakeId = newId): OpResult {
  const found = findSection(theme, templateKey, ref);
  if (!found || !hasOwn(found.section.blocks, blockId)) return fail('not_found');
  const src = found.section.blocks[blockId];
  const err = checkBlockAdd(found.section, src.type);
  if (err) return fail(err);
  const bid = uniqueId(makeId, src.type, new Set(found.section.block_order));
  const res = mapSection(theme, templateKey, ref, (s) => {
    const at = s.block_order.indexOf(blockId);
    return {
      ...s,
      blocks: { ...s.blocks, [bid]: clone(src) },
      block_order: insertAt(s.block_order, at < 0 ? s.block_order.length : at + 1, bid),
    };
  });
  return res.ok ? { ...res, id: bid } : res;
}

function hasBlock(theme: ThemeData, templateKey: string, ref: SectionRef, blockId: string): boolean {
  const found = findSection(theme, templateKey, ref);
  return !!found && hasOwn(found.section.blocks, blockId);
}

export function removeBlock(theme: ThemeData, templateKey: string, ref: SectionRef, blockId: string): OpResult {
  if (!hasBlock(theme, templateKey, ref, blockId)) return fail('not_found');
  return mapSection(theme, templateKey, ref, (s) => {
    const blocks = { ...s.blocks };
    delete blocks[blockId];
    return { ...s, blocks, block_order: s.block_order.filter((id) => id !== blockId) };
  });
}

export function moveBlock(theme: ThemeData, templateKey: string, ref: SectionRef, from: number, to: number): OpResult {
  const found = findSection(theme, templateKey, ref);
  if (!found || !inRange(from, found.section.block_order.length) || !inRange(to, found.section.block_order.length)) return fail('not_found');
  return mapSection(theme, templateKey, ref, (s) => ({ ...s, block_order: reorder(s.block_order, from, to) }));
}

function mapBlock(theme: ThemeData, templateKey: string, ref: SectionRef, blockId: string, fn: (b: Block) => Block): OpResult {
  if (!hasBlock(theme, templateKey, ref, blockId)) return fail('not_found');
  return mapSection(theme, templateKey, ref, (s) => ({ ...s, blocks: { ...s.blocks, [blockId]: fn(s.blocks[blockId]) } }));
}

export function toggleBlock(theme: ThemeData, templateKey: string, ref: SectionRef, blockId: string): OpResult {
  return mapBlock(theme, templateKey, ref, blockId, toggled);
}

export function setBlockSetting(theme: ThemeData, templateKey: string, ref: SectionRef, blockId: string, key: string, value: unknown): OpResult {
  return mapBlock(theme, templateKey, ref, blockId, (b) => ({ ...b, settings: { ...b.settings, [key]: value } }));
}

export function setThemeSetting(theme: ThemeData, key: string, value: unknown): ThemeData {
  if (key.startsWith('social.')) {
    const sub = key.slice('social.'.length);
    return { ...theme, settings: { ...theme.settings, social: { ...theme.settings.social, [sub]: value } } };
  }
  return { ...theme, settings: { ...theme.settings, [key]: value } };
}

/** A new color_schemes array with one colour of one scheme changed; the same theme when the scheme is gone. */
export function setSchemeColor(
  theme: ThemeData,
  schemeId: string,
  field: Exclude<keyof ColorScheme, 'id' | 'name'>,
  hex: string,
): ThemeData {
  const schemes = theme.settings.color_schemes;
  if (!schemes.some((s) => s.id === schemeId)) return theme;
  return {
    ...theme,
    settings: { ...theme.settings, color_schemes: schemes.map((s) => (s.id === schemeId ? { ...s, [field]: hex } : s)) },
  };
}
