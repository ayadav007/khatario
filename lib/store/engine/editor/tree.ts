// Pure helpers that shape the Studio 2 section tree and the Add section modal.
// Client-safe: imports only types, schema-types, registry, shared and ops.
import type { Block, Section, ThemeData } from '../types';
import type { SectionSchema } from '../schema-types';
import { getSectionSchema, sectionsForTemplate } from '../registry';
import { pageHandle } from '../shared';
import { OP_ERROR_TEXT, canAddBlock, canAddSection, getGroup, templateKind, type GroupKey, type OpError, type SectionRef } from './ops';

/** The template group's title here is Home's; the tree shows `templateTitle` for the open template. */
export const TREE_GROUPS: { group: GroupKey; title: string }[] = [
  { group: 'header', title: 'Header' },
  { group: 'template', title: 'Home' },
  { group: 'footer', title: 'Footer' },
];

const CORE_TITLES: Record<string, string> = { home: 'Home', product: 'Product', catalog: 'Catalog' };

/** The name of a template: Home, Product, Catalog, or a custom page's title (its handle when untitled). */
export function templateTitle(theme: ThemeData, key: string): string {
  if (hasOwn(CORE_TITLES, key)) return CORE_TITLES[key];
  const handle = pageHandle(key);
  if (!handle) return key;
  const title = hasOwn(theme.templates, key) ? theme.templates[key].title?.trim() : '';
  return title || handle;
}

/** The theme's custom pages sorted by title (the handle when untitled), as the switcher and link picker list them. */
export function customPages(theme: ThemeData): Array<{ key: string; handle: string; title: string }> {
  const out: Array<{ key: string; handle: string; title: string }> = [];
  for (const key of Object.keys(theme.templates)) {
    const handle = pageHandle(key);
    if (handle) out.push({ key, handle, title: templateTitle(theme, key) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key));
}

/** The page switcher: Home, Product, Catalog, then custom pages sorted by title. */
export function templateOptions(theme: ThemeData): Array<{ key: string; label: string }> {
  const pages = customPages(theme).map((p) => ({ key: p.key, label: p.title }));
  return [...Object.keys(CORE_TITLES).map((key) => ({ key, label: CORE_TITLES[key] })), ...pages];
}

/** The template to keep open: `key` while the switcher still offers it, else Home (its page was undone, deleted or restored away). */
export function openTemplateKey(theme: ThemeData, key: string): string {
  return templateOptions(theme).some((o) => o.key === key) ? key : 'home';
}

/** D15: a product or catalog template with no sections at all (as fillTemplate requires); the editor offers its default layout. */
export function isEmptyClassicTemplate(theme: ThemeData, key: string): boolean {
  if (key !== 'product' && key !== 'catalog') return false;
  const t = hasOwn(theme.templates, key) ? theme.templates[key] : null;
  return !!t && t.order.length === 0 && Object.keys(t.sections).length === 0;
}

/** D15: the storefront shows the classic page for a product or catalog template with no enabled section. */
export function showsClassicPage(theme: ThemeData, key: string): boolean {
  if (key !== 'product' && key !== 'catalog') return false;
  const t = hasOwn(theme.templates, key) ? theme.templates[key] : null;
  return !t?.order.some((id) => hasOwn(t.sections, id) && !t.sections[id].disabled);
}

export interface BlockRow {
  id: string;
  /** Position in block_order (what moveBlock takes). */
  index: number;
  label: string;
  hidden: boolean;
  unknown: boolean;
}

export interface SectionRow {
  id: string;
  ref: SectionRef;
  /** Position in the group's order (what moveSection takes). */
  index: number;
  label: string;
  hidden: boolean;
  /** No schema for this type: it can only be removed. */
  unknown: boolean;
  blocks: BlockRow[];
}

export interface AddOption {
  reason: OpError | null;
  reasonText: string | null;
}

export interface AddBlockOption extends AddOption {
  type: string;
  name: string;
}

export interface AddSectionCard extends AddOption {
  key: string;
  type: string;
  presetIndex: number;
  title: string;
  schemaName: string;
  presetName: string;
}

export interface AddSectionCategory {
  category: SectionSchema['category'];
  cards: AddSectionCard[];
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function reasonOf(reason: OpError | null): AddOption {
  return { reason, reasonText: reason ? OP_ERROR_TEXT[reason] : null };
}

export function sectionLabel(section: Section): string {
  return section.label || getSectionSchema(section.type)?.name || section.type;
}

/** A section the settings panel can edit: its type has a schema. Unknown types can only be removed. */
export function isEditableSection(section: Section): boolean {
  return !!getSectionSchema(section.type);
}

/** A drop in a sortable list: the order indices to move between, or null when nothing moves. */
export function dragMove(
  rows: readonly { id: string; index: number }[],
  activeId: string,
  overId: string | null,
): { from: number; to: number } | null {
  if (overId === null || activeId === overId) return null;
  const from = rows.find((r) => r.id === activeId);
  const to = rows.find((r) => r.id === overId);
  return from && to ? { from: from.index, to: to.index } : null;
}

export function blockLabel(sectionType: string, block: Block): string {
  return getSectionSchema(sectionType)?.blocks?.find((b) => b.type === block.type)?.name || block.type;
}

function blockRows(section: Section): BlockRow[] {
  const schema = getSectionSchema(section.type);
  const rows: BlockRow[] = [];
  section.block_order.forEach((id, index) => {
    if (!hasOwn(section.blocks, id)) return;
    const block = section.blocks[id];
    rows.push({
      id,
      index,
      label: blockLabel(section.type, block),
      hidden: !!block.disabled,
      unknown: !schema?.blocks?.some((b) => b.type === block.type),
    });
  });
  return rows;
}

export function groupRows(theme: ThemeData, templateKey: string, group: GroupKey): SectionRow[] {
  const g = getGroup(theme, templateKey, group);
  const rows: SectionRow[] = [];
  g.order.forEach((id, index) => {
    if (!hasOwn(g.sections, id)) return;
    const section = g.sections[id];
    rows.push({
      id,
      ref: { group, id },
      index,
      label: sectionLabel(section),
      hidden: !!section.disabled,
      unknown: !isEditableSection(section),
      blocks: blockRows(section),
    });
  });
  return rows;
}

export function addBlockOptions(theme: ThemeData, templateKey: string, ref: SectionRef): AddBlockOption[] {
  const g = getGroup(theme, templateKey, ref.group);
  if (!hasOwn(g.sections, ref.id)) return [];
  const schema = getSectionSchema(g.sections[ref.id].type);
  return (schema?.blocks ?? []).map((b) => ({
    type: b.type,
    name: b.name,
    ...reasonOf(canAddBlock(theme, templateKey, ref, b.type)),
  }));
}

export function addSectionCards(theme: ThemeData, templateKey: string, group: GroupKey): AddSectionCategory[] {
  const byCategory = new Map<SectionSchema['category'], AddSectionCard[]>();
  for (const schema of sectionsForTemplate(templateKind(templateKey, group))) {
    const reason = reasonOf(canAddSection(theme, templateKey, group, schema.type));
    const many = schema.presets.length > 1;
    const cards = byCategory.get(schema.category) ?? [];
    schema.presets.forEach((preset, presetIndex) => {
      cards.push({
        key: `${schema.type}:${presetIndex}`,
        type: schema.type,
        presetIndex,
        title: many ? `${schema.name} · ${preset.name}` : schema.name,
        schemaName: schema.name,
        presetName: preset.name,
        ...reason,
      });
    });
    byCategory.set(schema.category, cards);
  }
  return Array.from(byCategory, ([category, cards]) => ({ category, cards }));
}
