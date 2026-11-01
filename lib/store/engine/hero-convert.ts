// Pure and client-safe: no registry, no sanitiser. Runs on the RAW theme before sections are sanitised, because the
// Hero banner schema no longer declares the old `heading`, `description`, `button_text`, `link` and `text_position`
// settings, and the Slideshow schema no longer declares the section-wide `overlay` and `text_color`.

type Raw = Record<string, unknown>;

const BANNER_OLD_KEYS = ['heading', 'description', 'button_text', 'link', 'text_position'] as const;
const SLIDESHOW_OLD_KEYS = ['overlay', 'text_color'] as const;
const ALIGNS = ['left', 'center', 'right'];

function isObject(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function has(o: Raw, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The label every old engine banner showed above its heading (Studio's default banner eyebrow, studio-layout.ts). */
const OLD_BANNER_LABEL = 'SPECIAL OFFER';

/**
 * The blocks the old banner settings stood for, in order (label, heading, text, button), with ids as
 * `presets/shared.ts section()` makes them. The old banner always showed the "SPECIAL OFFER" label, so every converted
 * banner starts with that label block (the owner can now edit or remove it). Only the values the old settings held are
 * written, so the block schema defaults apply at render. An empty value makes no block, and so does an explicit empty
 * button label; a missing `button_text` stands for the old default "Shop now" (existing stores look the same).
 */
function bannerBlocks(settings: Raw): Array<{ id: string; block: Raw }> {
  const out: Array<{ id: string; block: Raw }> = [{ id: 'eyebrow-1', block: { type: 'eyebrow', settings: { text: OLD_BANNER_LABEL } } }];
  const heading = text(settings.heading);
  if (heading.trim()) out.push({ id: 'heading-1', block: { type: 'heading', settings: { text: heading } } });
  const description = text(settings.description);
  if (description.trim()) out.push({ id: 'text-1', block: { type: 'text', settings: { content: `<p>${escapeHtml(description)}</p>` } } });
  // A banner that never stored `button_text` showed the old schema default, so it keeps that button; an explicit '' means none.
  const label = has(settings, 'button_text') ? text(settings.button_text) : 'Shop now';
  if (label.trim()) {
    const link = text(settings.link);
    out.push({ id: 'button-1', block: { type: 'button', settings: link.trim() ? { label, link } : { label } } });
  }
  return out;
}

function convertBanner(section: Raw): Raw {
  const settings = isObject(section.settings) ? section.settings : {};
  if (!BANNER_OLD_KEYS.some((k) => has(settings, k))) return section;
  // A banner that already has blocks is left alone: the sanitiser drops the old keys it may still hold.
  if (Array.isArray(section.block_order) && section.block_order.length > 0) return section;

  const kept: Raw = { ...settings };
  for (const k of BANNER_OLD_KEYS) delete kept[k];
  const side = text(settings.text_position);
  if (ALIGNS.includes(side)) {
    kept.position = `middle-${side}`;
    kept.align = side;
    // The old text position applied on phones too.
    kept.align_mobile = side;
  }
  const made = bannerBlocks(settings);
  return {
    ...section,
    settings: kept,
    blocks: Object.fromEntries(made.map((m) => [m.id, m.block])),
    block_order: made.map((m) => m.id),
  };
}

function convertSlideshow(section: Raw): Raw {
  const settings = isObject(section.settings) ? section.settings : {};
  if (!SLIDESHOW_OLD_KEYS.some((k) => has(settings, k))) return section;

  const overlay = settings.overlay;
  const color = settings.text_color;
  const kept: Raw = { ...settings };
  for (const k of SLIDESHOW_OLD_KEYS) delete kept[k];

  const blocks: Raw = {};
  for (const [id, b] of Object.entries(isObject(section.blocks) ? section.blocks : {})) {
    if (!isObject(b) || b.type !== 'slide') {
      blocks[id] = b;
      continue;
    }
    const s: Raw = isObject(b.settings) ? { ...b.settings } : {};
    if (!has(s, 'overlay') && typeof overlay === 'number' && Number.isFinite(overlay)) s.overlay = overlay;
    if (!has(s, 'text_color') && typeof color === 'string' && color !== '') s.text_color = color;
    if (!has(s, 'position')) s.position = 'middle-left';
    blocks[id] = { ...b, settings: s };
  }
  return { ...section, settings: kept, blocks };
}

function convertSection(section: unknown): unknown {
  if (!isObject(section)) return section;
  if (section.type === 'image-banner') return convertBanner(section);
  if (section.type === 'slideshow') return convertSlideshow(section);
  return section;
}

function convertTemplate(template: unknown): unknown {
  if (!isObject(template) || !isObject(template.sections)) return template;
  const sections: Raw = {};
  for (const [id, s] of Object.entries(template.sections)) sections[id] = convertSection(s);
  return { ...template, sections };
}

/**
 * Turn an old Image banner's heading, description, button text, link and text position into Hero banner blocks and
 * settings, and copy a Slideshow's section-wide darkening and text colour into every slide that has no value of its own,
 * in every section of a RAW theme (header group, footer group and each template). The old keys are removed, so a second
 * run changes nothing, and a banner that already has blocks is left alone.
 * Returns a new object; the input is untouched.
 */
export function convertLegacyHeroSections(raw: Raw): Raw {
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
