import { SECTION_SCHEMAS } from '@/lib/store/engine/registry';
import { THEME_SETTINGS_SCHEMA, EDITOR_HIDDEN_SETTINGS } from '@/lib/store/engine/theme-settings-schema';
import { presetSettings } from '@/lib/store/engine/presets/shared';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';

describe('client-safe shared module', () => {
  it('shared.ts loads without sanitize-html or pg', () => {
    jest.isolateModules(() => {
      jest.doMock('sanitize-html', () => {
        throw new Error('server-only');
      });
      jest.doMock('pg', () => {
        throw new Error('server-only');
      });
      const shared = require('@/lib/store/engine/shared');
      const registry = require('@/lib/store/engine/registry');
      const schema = require('@/lib/store/engine/theme-settings-schema');
      expect(shared.ENGINE_LIMITS.sectionsPerTemplate).toBe(25);
      expect(typeof shared.newId).toBe('function');
      expect(typeof shared.defaultSettings).toBe('function');
      expect(Object.keys(registry.SECTION_SCHEMAS).length).toBeGreaterThan(0);
      expect(schema.THEME_SETTINGS_SCHEMA.length).toBeGreaterThan(0);
    });
  });

  it('re-exports from sanitize and settings are the same values', () => {
    const shared = require('@/lib/store/engine/shared');
    const sanitize = require('@/lib/store/engine/sanitize');
    const settings = require('@/lib/store/engine/settings');
    expect(sanitize.ENGINE_LIMITS).toBe(shared.ENGINE_LIMITS);
    expect(sanitize.ID_RE).toBe(shared.ID_RE);
    expect(sanitize.newId).toBe(shared.newId);
    expect(settings.defaultSettings).toBe(shared.defaultSettings);
  });
});

describe('THEME_SETTINGS_SCHEMA', () => {
  const ids = THEME_SETTINGS_SCHEMA.map((s) => s.id);

  it('ids cover every ThemeSettings key except color_schemes', () => {
    const preset = presetSettings({ accent: '#111111' } as never);
    const expected: string[] = [];
    for (const [k, v] of Object.entries(preset)) {
      if (k === 'color_schemes') continue;
      if (k === 'social') for (const sk of Object.keys(v as object)) expected.push(`social.${sk}`);
      else expected.push(k);
    }
    expect([...ids].sort()).toEqual(expected.sort());
  });

  it('defaults match the preset settings', () => {
    const preset = presetSettings({ accent: '#111111' } as never) as unknown as Record<string, unknown>;
    for (const s of THEME_SETTINGS_SCHEMA) {
      const actual = s.id.startsWith('social.') ? (preset.social as Record<string, unknown>)[s.id.slice(7)] : preset[s.id];
      expect({ id: s.id, d: s.default }).toEqual({ id: s.id, d: actual });
    }
  });

  it('uses the specified types, range and options', () => {
    const by = Object.fromEntries(THEME_SETTINGS_SCHEMA.map((s) => [s.id, s]));
    expect(by.font_heading.type).toBe('font');
    expect(by.font_body.type).toBe('font');
    expect(by.button_radius).toMatchObject({ type: 'range', min: 0, max: 32 });
    expect(by.card_style.options?.map((o) => o.value)).toEqual(['plain', 'bordered', 'shadow']);
    expect(by.phone_kit.type).toBe('checkbox');
    expect(by.logo_url.type).toBe('image');
    expect(by.favicon_url.type).toBe('image');
    expect(by.custom_css).toMatchObject({ type: 'textarea', info: 'Applies to the whole store' });
    for (const k of ['instagram', 'whatsapp', 'facebook', 'youtube']) expect(by[`social.${k}`].type).toBe('text');
  });

  it('hides the settings not wired until M3', () => {
    expect(EDITOR_HIDDEN_SETTINGS).toEqual({
      theme: ['card_style'],
      common: ['full_width'],
      sections: { footer: ['show_payment_icons'] },
    });
  });

  it('sanity: registry and sanitize still load', () => {
    expect(Object.keys(SECTION_SCHEMAS).length).toBeGreaterThan(0);
    expect(sanitizeThemeData({}).settings.button_radius).toBe(10);
  });
});
