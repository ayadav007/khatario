import type { ColorScheme, PageTemplate, Section, Template, TemplateKind, ThemeData, ThemeSettings, Block } from './types';
import type { SettingSchema } from './schema-types';
import { ENGINE_LIMITS, ID_RE, newId } from './shared';
import { getSectionSchema } from './registry';
import { sanitizeSettingValue, sanitizeSettings } from './settings';
import { sanitizeColorSchemes } from './color-schemes';
import { SECTION_CSS_MAX, sanitizeCssClass } from '@/lib/store/section-css';

export { ENGINE_LIMITS, ID_RE, newId };

export const PAGE_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
export const RESERVED_PAGE_HANDLES = ['cart', 'checkout', 'account', 'products', 'catalog', 'pages', 'api', 'khata', 'wishlist', 'about', 'contact', 'privacy', 'refund', 'terms'];

const THEME_CSS_MAX = 8000;
const CARD_STYLES = ['plain', 'bordered', 'shadow'] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id) && id !== '__proto__';
}

function sanitizeBlocks(
  schema: NonNullable<ReturnType<typeof getSectionSchema>>,
  rawBlocks: unknown,
  rawOrder: unknown,
): { blocks: Record<string, Block>; block_order: string[] } {
  const blocks: Record<string, Block> = {};
  const block_order: string[] = [];
  const blockSchemas = schema.blocks ?? [];
  const input = isObject(rawBlocks) ? rawBlocks : {};
  const cap = Math.min(schema.max_blocks ?? ENGINE_LIMITS.blocksPerSection, ENGINE_LIMITS.blocksPerSection);
  const perType: Record<string, number> = {};
  for (const id of Array.isArray(rawOrder) ? rawOrder : []) {
    if (block_order.length >= cap) break;
    if (!validId(id) || !has(input, id) || has(blocks, id)) continue;
    const rb = input[id];
    if (!isObject(rb) || typeof rb.type !== 'string') continue;
    const bs = blockSchemas.find((b) => b.type === rb.type);
    if (!bs) continue;
    const used = perType[bs.type] ?? 0;
    if (bs.limit !== undefined && used >= bs.limit) continue;
    perType[bs.type] = used + 1;
    const block: Block = { type: bs.type, settings: sanitizeSettings(bs.settings, rb.settings) };
    if (rb.disabled === true) block.disabled = true;
    blocks[id] = block;
    block_order.push(id);
  }
  return { blocks, block_order };
}

export function sanitizeSection(raw: unknown, kind: TemplateKind, schemeIds?: ReadonlySet<string>): Section | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null;
  const schema = getSectionSchema(raw.type);
  if (!schema || !schema.templates.includes(kind)) return null;
  const { blocks, block_order } = sanitizeBlocks(schema, raw.blocks, raw.block_order);
  const section: Section = {
    type: schema.type,
    settings: sanitizeSettings(schema.settings, raw.settings),
    blocks,
    block_order,
  };
  if (raw.disabled === true) section.disabled = true;
  if (typeof raw.color_scheme === 'string' && ID_RE.test(raw.color_scheme) && (!schemeIds || schemeIds.has(raw.color_scheme))) {
    section.color_scheme = raw.color_scheme;
  }
  if (typeof raw.label === 'string') {
    const label = raw.label.trim().slice(0, 40);
    if (label) section.label = label;
  }
  const cls = sanitizeCssClass(raw.css_class);
  if (cls) section.css_class = cls;
  if (typeof raw.custom_css === 'string') {
    const css = raw.custom_css.slice(0, SECTION_CSS_MAX).replace(/</g, '');
    if (css) section.custom_css = css;
  }
  return section;
}

export function sanitizeTemplate(raw: unknown, kind: TemplateKind, schemeIds?: ReadonlySet<string>): Template {
  const out: Template = { order: [], sections: {} };
  if (!isObject(raw)) return out;
  const input = isObject(raw.sections) ? raw.sections : {};
  const perType: Record<string, number> = {};
  for (const id of Array.isArray(raw.order) ? raw.order : []) {
    if (out.order.length >= ENGINE_LIMITS.sectionsPerTemplate) break;
    if (!validId(id) || !has(input, id) || has(out.sections, id)) continue;
    const section = sanitizeSection(input[id], kind, schemeIds);
    if (!section) continue;
    const limit = getSectionSchema(section.type)?.limit;
    const used = perType[section.type] ?? 0;
    if (limit !== undefined && used >= limit) continue;
    perType[section.type] = used + 1;
    out.sections[id] = section;
    out.order.push(id);
  }
  return out;
}

function clip(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().slice(0, max);
  return v || undefined;
}

function sanitizePageTemplate(raw: unknown, kind: TemplateKind, schemeIds: ReadonlySet<string>, isPage: boolean): PageTemplate {
  const out: PageTemplate = sanitizeTemplate(raw, kind, schemeIds);
  if (isPage && isObject(raw)) {
    const title = clip(raw.title, 100);
    const seoTitle = clip(raw.seo_title, 120);
    const seoDescription = clip(raw.seo_description, 320);
    if (title) out.title = title;
    if (seoTitle) out.seo_title = seoTitle;
    if (seoDescription) out.seo_description = seoDescription;
  }
  return out;
}

const FONT_SCHEMA: SettingSchema = { id: 'font', type: 'font', label: 'Font' };
const URL_SCHEMA: SettingSchema = { id: 'url', type: 'url', label: 'URL' };
const IMAGE_SCHEMA: SettingSchema = { id: 'image', type: 'image', label: 'Image' };

function sanitizeThemeSettings(raw: unknown): ThemeSettings {
  const r = isObject(raw) ? raw : {};
  const social = isObject(r.social) ? r.social : {};
  const url = (v: unknown): string => {
    const s = sanitizeSettingValue(URL_SCHEMA, v);
    return typeof s === 'string' ? s : '';
  };
  const image = (v: unknown): string => {
    const s = sanitizeSettingValue(IMAGE_SCHEMA, v);
    return typeof s === 'string' ? s : '';
  };
  const radius = typeof r.button_radius === 'number' && Number.isFinite(r.button_radius) ? Math.min(32, Math.max(0, Math.round(r.button_radius))) : 10;
  return {
    color_schemes: sanitizeColorSchemes(r.color_schemes),
    font_heading: (sanitizeSettingValue(FONT_SCHEMA, r.font_heading) as string | undefined) ?? 'outfit',
    font_body: (sanitizeSettingValue(FONT_SCHEMA, r.font_body) as string | undefined) ?? 'inter',
    button_radius: radius,
    card_style: (CARD_STYLES as readonly unknown[]).includes(r.card_style) ? (r.card_style as ThemeSettings['card_style']) : 'bordered',
    phone_kit: typeof r.phone_kit === 'boolean' ? r.phone_kit : true,
    logo_url: image(r.logo_url),
    favicon_url: image(r.favicon_url),
    custom_css: typeof r.custom_css === 'string' ? r.custom_css.slice(0, THEME_CSS_MAX).replace(/</g, '') : '',
    social: {
      instagram: url(social.instagram),
      whatsapp: url(social.whatsapp),
      facebook: url(social.facebook),
      youtube: url(social.youtube),
    },
  };
}

function isValidPageKey(key: string): boolean {
  if (!key.startsWith('page.')) return false;
  const handle = key.slice(5);
  return PAGE_HANDLE_RE.test(handle) && !RESERVED_PAGE_HANDLES.includes(handle);
}

export function sanitizeThemeData(raw: unknown): ThemeData {
  const r = isObject(raw) ? raw : {};
  const settings = sanitizeThemeSettings(r.settings);
  const schemeIds: ReadonlySet<string> = new Set<string>(settings.color_schemes.map((s: ColorScheme) => s.id));
  const rawTemplates = isObject(r.templates) ? r.templates : {};
  const templates: Record<string, PageTemplate> = {};
  for (const key of ['home', 'product', 'catalog'] as const) {
    templates[key] = sanitizePageTemplate(has(rawTemplates, key) ? rawTemplates[key] : undefined, key, schemeIds, false);
  }
  let pages = 0;
  for (const key of Object.keys(rawTemplates)) {
    if (pages >= ENGINE_LIMITS.customPages) break;
    if (!isValidPageKey(key)) continue;
    templates[key] = sanitizePageTemplate(rawTemplates[key], 'page', schemeIds, true);
    pages++;
  }
  const header_group = sanitizeTemplate(r.header_group, 'header', schemeIds);
  const footer_group = sanitizeTemplate(r.footer_group, 'footer', schemeIds);
  // D12: a section id is unique across the header group, the footer group and each template (templates may share ids with each other).
  // The groups win over templates, so the brief's example holds (a home section `footer` is dropped). Header wins over footer.
  const dropIds = (t: Template, taken: ReadonlySet<string>) => {
    const kept = t.order.filter((id) => !taken.has(id));
    for (const id of t.order) if (taken.has(id)) delete t.sections[id];
    t.order = kept;
  };
  dropIds(footer_group, new Set(header_group.order));
  const groupIds = new Set<string>([...header_group.order, ...footer_group.order]);
  for (const t of Object.values(templates)) dropIds(t, groupIds);
  return { settings, header_group, footer_group, templates };
}

export function themeTooLarge(data: ThemeData): boolean {
  return Buffer.byteLength(JSON.stringify(data), 'utf8') > ENGINE_LIMITS.themeBytes;
}
