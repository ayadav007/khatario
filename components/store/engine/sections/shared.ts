import type { StudioSettings } from '@/lib/store/studio-sections';
import { getSectionSchema } from '@/lib/store/engine/registry';
import { defaultSettings, sanitizeSettingValue } from '@/lib/store/engine/settings';
import type { Block, Section } from '@/lib/store/engine/types';

// Server only: the settings module pulls in the HTML sanitisers.

/** The section frame applies top/bottom spacing, so the Studio component adds none of its own. */
export function noBox(s: StudioSettings): StudioSettings {
  return { ...s, spacingTop: 0, spacingBottom: 0 };
}

/** Section settings value as a string ('' otherwise). */
export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Stored settings over the section schema's defaults. */
export function withDefaults(section: Section): Record<string, unknown> {
  const schema = getSectionSchema(section.type);
  return { ...(schema ? defaultSettings(schema.settings) : {}), ...(section.settings ?? {}) };
}

/** A richtext setting re-sanitised at render with the same rule it was saved with. */
export function richtextHtml(sectionType: string, settingId: string, raw: unknown): string {
  const schema = getSectionSchema(sectionType)?.settings.find((s) => s.id === settingId && s.type === 'richtext');
  if (!schema) return '';
  const html = sanitizeSettingValue(schema, raw);
  return typeof html === 'string' ? html : '';
}

/** A block's settings over its schema's defaults, with every richtext setting re-sanitised at render. */
export function blockSettings(sectionType: string, block: Block): Record<string, unknown> | null {
  const schema = getSectionSchema(sectionType)?.blocks?.find((b) => b.type === block.type);
  if (!schema) return null;
  const out: Record<string, unknown> = { ...defaultSettings(schema.settings), ...(block.settings ?? {}) };
  for (const s of schema.settings) {
    if (s.type !== 'richtext') continue;
    const html = sanitizeSettingValue(s, out[s.id]);
    out[s.id] = typeof html === 'string' ? html : '';
  }
  return out;
}
