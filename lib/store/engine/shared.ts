// Client-safe: no sanitize-html, no pg. Editor code may import this file.
import type { SettingSchema } from './schema-types';

export const ENGINE_LIMITS = {
  sectionsPerTemplate: 25,
  blocksPerSection: 50,
  customPages: 30,
  themeBytes: 524288,
  themesPerBusiness: 20,
  versionsKept: 30,
};

export const ID_RE = /^[a-z0-9_-]{1,32}$/;

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix?: string): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  const cleaned = (prefix ?? 'id').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return `${cleaned || 'id'}-${suffix}`.slice(0, 32);
}

export function defaultSettings(schemas: SettingSchema[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of schemas) {
    if (s.type === 'header' || s.default === undefined) continue;
    out[s.id] = s.default;
  }
  return out;
}
