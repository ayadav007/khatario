// Pure and client-safe: no registry, no sanitiser. Runs on the RAW theme before sections are sanitised, because the
// Image with text and Rich text schemas no longer declare the old `heading`, `description`, `content`, `button_text` and `link` settings.

type Raw = Record<string, unknown>;

const TEXT_SECTION_TYPES = ['image-with-text', 'rich-text'];
const OLD_KEYS = ['heading', 'description', 'content', 'button_text', 'link'] as const;

function isObject(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * The blocks the old settings stood for, in order (heading, text, button), with ids as `presets/shared.ts section()` makes
 * them. Each block holds only the values the old settings held, so the schema defaults (heading size, button style) apply
 * at render. An empty value makes no block; a link without a button label makes none either.
 */
function blocksFromOldSettings(type: string, settings: Raw): Array<{ id: string; block: Raw }> {
  const out: Array<{ id: string; block: Raw }> = [];
  const heading = text(settings.heading);
  if (heading.trim()) out.push({ id: 'heading-1', block: { type: 'heading', settings: { text: heading } } });
  const body = text(type === 'rich-text' ? settings.content : settings.description);
  if (body.trim()) out.push({ id: 'text-1', block: { type: 'text', settings: { content: body } } });
  const label = text(settings.button_text);
  if (type === 'image-with-text' && label.trim()) {
    const link = text(settings.link);
    out.push({ id: 'button-1', block: { type: 'button', settings: link.trim() ? { label, link } : { label } } });
  }
  return out;
}

function convertSection(section: unknown): unknown {
  if (!isObject(section) || typeof section.type !== 'string' || !TEXT_SECTION_TYPES.includes(section.type)) return section;
  const settings = isObject(section.settings) ? section.settings : {};
  if (!OLD_KEYS.some((k) => Object.prototype.hasOwnProperty.call(settings, k))) return section;

  const kept: Raw = { ...settings };
  for (const k of OLD_KEYS) delete kept[k];
  const out: Raw = { ...section, settings: kept };

  const hasBlocks = Array.isArray(section.block_order) && section.block_order.length > 0;
  if (!hasBlocks) {
    const made = blocksFromOldSettings(section.type, settings);
    out.blocks = Object.fromEntries(made.map((m) => [m.id, m.block]));
    out.block_order = made.map((m) => m.id);
  }
  return out;
}

function convertTemplate(template: unknown): unknown {
  if (!isObject(template) || !isObject(template.sections)) return template;
  const sections: Raw = {};
  for (const [id, s] of Object.entries(template.sections)) sections[id] = convertSection(s);
  return { ...template, sections };
}

/**
 * Turn the old heading, description / content, button text and link settings of every Image with text and Rich text
 * section of a RAW theme into content blocks. A section that already has blocks keeps them and only loses the old keys.
 * After one run the old keys are gone, so a second run changes nothing. Only these two section types are touched.
 * Returns a new object; the input is untouched.
 */
export function convertLegacyTextSections(raw: Raw): Raw {
  const out: Raw = { ...raw };
  if (raw.header_group !== undefined) out.header_group = convertTemplate(raw.header_group);
  if (raw.footer_group !== undefined) out.footer_group = convertTemplate(raw.footer_group);
  if (isObject(raw.templates)) {
    const templates: Raw = {};
    for (const [key, t] of Object.entries(raw.templates)) templates[key] = convertTemplate(t);
    out.templates = templates;
  }
  return out;
}
