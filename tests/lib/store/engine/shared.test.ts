import { SECTION_SCHEMAS } from '@/lib/store/engine/registry';
import { THEME_SETTINGS_SCHEMA, EDITOR_HIDDEN_SETTINGS } from '@/lib/store/engine/theme-settings-schema';
import { presetSettings } from '@/lib/store/engine/presets/shared';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { CARD_DESIGN_IDS, sanitizeProductCard } from '@/lib/store/engine/product-card';

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
  // A `header` entry is a group heading in the editor, not a setting.
  const ids = THEME_SETTINGS_SCHEMA.filter((s) => s.type !== 'header').map((s) => s.id);

  it('ids cover every ThemeSettings key except color_schemes and menus', () => {
    const preset = presetSettings({ accent: '#111111' } as never);
    const expected: string[] = [];
    for (const [k, v] of Object.entries(preset)) {
      if (k === 'color_schemes' || k === 'menus') continue;
      if (k === 'social' || k === 'product_card') for (const sk of Object.keys(v as object)) expected.push(`${k}.${sk}`);
      else expected.push(k);
    }
    expect([...ids].sort()).toEqual(expected.sort());
  });

  it('defaults match the preset settings', () => {
    const preset = presetSettings({ accent: '#111111' } as never) as unknown as Record<string, unknown>;
    for (const s of THEME_SETTINGS_SCHEMA.filter((x) => x.type !== 'header')) {
      const dot = s.id.indexOf('.');
      const actual = dot >= 0 ? (preset[s.id.slice(0, dot)] as Record<string, unknown>)[s.id.slice(dot + 1)] : preset[s.id];
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

  it('product card rows use the spec values, defaults and line ids', () => {
    const by = Object.fromEntries(THEME_SETTINGS_SCHEMA.map((s) => [s.id, s]));
    const card = presetSettings({ accent: '#111111' } as never).product_card as unknown as Record<string, unknown>;
    expect(by['product_card.lines'].type).toBe('line_list');
    expect(by['product_card.lines'].options?.map((o) => o.value)).toEqual(['brand', 'name', 'unit', 'rating', 'tagline', 'price', 'sizes', 'swatches', 'buttons']);
    expect(by['product_card.design'].options?.map((o) => o.value)).toEqual(['theme', ...CARD_DESIGN_IDS]);
    for (const s of THEME_SETTINGS_SCHEMA.filter((x) => x.id.startsWith('product_card.') && x.type === 'select')) {
      const field = s.id.slice('product_card.'.length);
      // Every select lists the default among its options, and every option is a value the sanitiser keeps.
      expect({ id: s.id, has: s.options?.some((o) => o.value === String(card[field])) }).toEqual({ id: s.id, has: true });
      for (const o of s.options ?? []) {
        const kept = sanitizeProductCard({ [field]: field === 'name_lines' ? Number(o.value) : o.value }) as unknown as Record<string, unknown>;
        expect({ id: s.id, v: String(kept[field]) }).toEqual({ id: s.id, v: o.value });
      }
    }
    expect(by['product_card.image_padding']).toMatchObject({ type: 'range', min: 0, max: 24 });
    expect(by['product_card.image_radius']).toMatchObject({ type: 'range', min: 0, max: 32 });
    expect(by['product_card.border']).toMatchObject({ type: 'range', min: 0, max: 3 });
    expect(by['product_card.radius']).toMatchObject({ type: 'range', min: 0, max: 32 });
    expect(by['product_card.padding']).toMatchObject({ type: 'range', min: 0, max: 24 });
    expect(by['product_card.background_image'].type).toBe('image');
    expect(by['product_card.color_scheme'].type).toBe('color_scheme');
    for (const k of ['name_price_row', 'show_mrp', 'image_swipe']) expect(by[`product_card.${k}`].type).toBe('checkbox');
    const headers = THEME_SETTINGS_SCHEMA.filter((s) => s.type === 'header').map((s) => s.label);
    expect(headers).toEqual(expect.arrayContaining(['Product cards', 'Lines', 'Price', 'Photo', 'Badges', 'Buttons', 'Card', 'Out of stock']));
  });

  it('hides nothing now that M3 wired every setting', () => {
    expect(EDITOR_HIDDEN_SETTINGS).toEqual({ theme: [], common: [], sections: {} });
  });

  it('sanity: registry and sanitize still load', () => {
    expect(Object.keys(SECTION_SCHEMAS).length).toBeGreaterThan(0);
    expect(sanitizeThemeData({}).settings.button_radius).toBe(10);
  });
});
