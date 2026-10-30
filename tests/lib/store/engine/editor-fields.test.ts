import {
  FONT_OPTIONS,
  HTML_MAX,
  ICON_OPTIONS,
  SCHEME_COLOR_FIELDS,
  clampNumber,
  encodeImageUrl,
  isLinkValue,
  lengthCounter,
  linkChoice,
  linkOptions,
  listLimit,
  parseHex,
  schemeMergeKey,
  settingMergeKey,
  settingValue,
  themeSettingValue,
  toggleListItem,
  visibleSettings,
} from '@/lib/store/engine/editor/fields';
import { setSchemeColor } from '@/lib/store/engine/editor/ops';
import { COMMON_SETTINGS, getSectionSchema } from '@/lib/store/engine/registry';
import { THEME_SETTINGS_SCHEMA } from '@/lib/store/engine/theme-settings-schema';
import { sanitizeSettingValue } from '@/lib/store/engine/settings';
import { CUSTOM_HTML_MAX } from '@/lib/store/engine/html';
import { DEFAULT_COLOR_SCHEMES } from '@/lib/store/engine/color-schemes';
import { STORE_FONT_FAMILIES } from '@/lib/store/store-theme';
import { STUDIO_USP_ICONS } from '@/lib/store/studio-sections';
import type { SettingSchema } from '@/lib/store/engine/schema-types';
import type { ThemeData, ThemeSettings } from '@/lib/store/engine/types';

const range: SettingSchema = { id: 'r', type: 'range', label: 'R', min: 0, max: 96, step: 4, default: 32 };

describe('settingValue', () => {
  it('returns the stored value, else the default, else undefined', () => {
    expect(settingValue({ r: 8 }, range)).toBe(8);
    expect(settingValue({}, range)).toBe(32);
    expect(settingValue(undefined, range)).toBe(32);
    expect(settingValue({ r: undefined }, range)).toBe(32);
    expect(settingValue({}, { id: 'x', type: 'text', label: 'X' })).toBeUndefined();
  });

  it('keeps falsy stored values and ignores inherited keys', () => {
    expect(settingValue({ r: 0 }, range)).toBe(0);
    expect(settingValue({ c: false }, { id: 'c', type: 'checkbox', label: 'C', default: true })).toBe(false);
    expect(settingValue({}, { id: 'toString', type: 'text', label: 'T', default: 'd' })).toBe('d');
  });

  it('reads dotted theme keys', () => {
    const s = { button_radius: 6, social: { instagram: 'https://i.example' } } as unknown as ThemeSettings;
    expect(themeSettingValue(s, { id: 'button_radius', type: 'range', label: 'B', default: 10 })).toBe(6);
    expect(themeSettingValue(s, { id: 'social.instagram', type: 'text', label: 'I', default: '' })).toBe('https://i.example');
    expect(themeSettingValue(s, { id: 'social.youtube', type: 'text', label: 'Y', default: '' })).toBe('');
    expect(themeSettingValue(s, { id: 'font_body', type: 'font', label: 'F', default: 'inter' })).toBe('inter');
  });
});

describe('clampNumber', () => {
  it('clamps to min and max and snaps to the step from min', () => {
    expect(clampNumber(range, -5)).toBe(0);
    expect(clampNumber(range, 200)).toBe(96);
    expect(clampNumber(range, 33)).toBe(32);
    expect(clampNumber(range, 35)).toBe(36);
    expect(clampNumber({ id: 'x', type: 'range', label: 'X', min: 3, max: 10, step: 2 }, 6)).toBe(7);
  });

  it('handles decimal steps and missing bounds', () => {
    expect(clampNumber({ id: 'x', type: 'range', label: 'X', min: 0, max: 1, step: 0.1 }, 0.33)).toBe(0.3);
    expect(clampNumber({ id: 'x', type: 'number', label: 'X', min: 1 }, 123456.5)).toBe(123456.5);
    expect(clampNumber({ id: 'x', type: 'number', label: 'X', min: 1, max: 999999 }, 0)).toBe(1);
  });

  it('returns null for non-finite input', () => {
    expect(clampNumber(range, NaN)).toBeNull();
    expect(clampNumber(range, Infinity)).toBeNull();
  });
});

describe('parseHex', () => {
  it('accepts #rrggbb and expands #rgb, lowercased', () => {
    expect(parseHex('#AABBCC')).toBe('#aabbcc');
    expect(parseHex(' #abc ')).toBe('#aabbcc');
    expect(parseHex('#0f0')).toBe('#00ff00');
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '#ab', '#abcd', '#abcdef12', '#ggg', 'red', '#12345', '#1234567']) {
      expect(parseHex(bad)).toBeNull();
    }
  });

  it('every accepted value passes the server colour rule', () => {
    const schema: SettingSchema = { id: 'c', type: 'color', label: 'C' };
    expect(sanitizeSettingValue(schema, parseHex('#abc'))).toBe('#aabbcc');
  });
});

describe('lengthCounter', () => {
  it('counts against max_length and flags overflow', () => {
    expect(lengthCounter('hello', 120)).toEqual({ text: '5/120', over: false });
    expect(lengthCounter('x'.repeat(31), 30)).toEqual({ text: '31/30', over: true });
    expect(lengthCounter(undefined, 30)).toEqual({ text: '0/30', over: false });
  });

  it('is null without a max', () => {
    expect(lengthCounter('hello', undefined)).toBeNull();
  });

  it('HTML_MAX matches the server limit', () => {
    expect(HTML_MAX).toBe(CUSTOM_HTML_MAX);
  });
});

describe('visibleSettings', () => {
  it('drops EDITOR_HIDDEN_SETTINGS from section and theme forms', () => {
    const fp = getSectionSchema('featured-products')!.settings;
    const ids = visibleSettings(fp).map((s) => s.id);
    expect(ids).toContain('spacing_top');
    expect(ids).toContain('heading');
    expect(ids).not.toContain('full_width');
    // A section's own card_style is hidden too (same id): D13 hides by id, in every form.
    expect(ids).not.toContain('card_style');
    const theme = visibleSettings(THEME_SETTINGS_SCHEMA).map((s) => s.id);
    expect(theme).not.toContain('card_style');
    expect(theme).toContain('button_radius');
    const footer = visibleSettings(getSectionSchema('footer')!.settings).map((s) => s.id);
    expect(footer).not.toContain('show_payment_icons');
  });

  it('section forms already include COMMON_SETTINGS (registry combines them)', () => {
    const ids = getSectionSchema('rich-text')!.settings.map((s) => s.id);
    for (const c of COMMON_SETTINGS) expect(ids).toContain(c.id);
  });
});

describe('link picker', () => {
  const cats = [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Fruit' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Veg' },
  ];

  it('lists Home, All products and each category', () => {
    expect(linkOptions(cats)).toEqual([
      { value: '/', label: 'Home' },
      { value: '/?cat=', label: 'All products' },
      { value: '/?cat=11111111-1111-1111-1111-111111111111', label: 'Fruit' },
      { value: '/?cat=22222222-2222-2222-2222-222222222222', label: 'Veg' },
    ]);
  });

  it('maps a value to its option, custom, or none', () => {
    expect(linkChoice('/', cats)).toBe('/');
    expect(linkChoice('/?cat=22222222-2222-2222-2222-222222222222', cats)).toBe('/?cat=22222222-2222-2222-2222-222222222222');
    expect(linkChoice('https://example.com', cats)).toBe('custom');
    expect(linkChoice('', cats)).toBe('');
    expect(linkChoice(undefined, cats)).toBe('');
  });

  it('every option passes the server url rule', () => {
    const schema: SettingSchema = { id: 'l', type: 'url', label: 'L' };
    for (const o of linkOptions(cats)) expect(sanitizeSettingValue(schema, o.value)).toBe(o.value);
  });

  it('isLinkValue matches the server url rule', () => {
    const schema: SettingSchema = { id: 'l', type: 'url', label: 'L' };
    for (const v of ['', 'https://example.com/a', '/about', '#catalog', 'http://x.com', 'javascript:alert(1)', '//evil.com', 'https://a b', '/a b']) {
      expect(isLinkValue(v)).toBe(sanitizeSettingValue(schema, v) === v.trim());
    }
  });
});

describe('merge keys', () => {
  it('builds section, block and theme keys', () => {
    expect(settingMergeKey({ kind: 'section', ref: { group: 'template', id: 's1' } }, 'heading')).toBe('template:s1:heading');
    expect(settingMergeKey({ kind: 'block', ref: { group: 'header', id: 'h' }, blockId: 'b1' }, 'text')).toBe('header:h:b1:text');
    expect(settingMergeKey({ kind: 'theme' }, 'social.instagram')).toBe('theme:social.instagram');
    expect(schemeMergeKey('scheme-1', 'accent')).toBe('theme:color_schemes:scheme-1:accent');
  });
});

describe('setSchemeColor', () => {
  const t = (): ThemeData =>
    ({
      settings: { color_schemes: DEFAULT_COLOR_SCHEMES.slice(0, 2).map((s) => ({ ...s })) },
      header_group: { order: [], sections: {} },
      footer_group: { order: [], sections: {} },
      templates: {},
    }) as unknown as ThemeData;

  it('replaces one colour of one scheme with a new array', () => {
    const before = t();
    const after = setSchemeColor(before, 'scheme-2', 'accent', '#123456');
    expect(after.settings.color_schemes[1].accent).toBe('#123456');
    expect(after.settings.color_schemes[0]).toEqual(before.settings.color_schemes[0]);
    expect(after.settings.color_schemes).not.toBe(before.settings.color_schemes);
    expect(before.settings.color_schemes[1].accent).toBe(DEFAULT_COLOR_SCHEMES[1].accent);
  });

  it('returns the same theme for an unknown scheme', () => {
    const before = t();
    expect(setSchemeColor(before, 'nope', 'accent', '#123456')).toBe(before);
  });

  it('lists the 7 scheme colours', () => {
    expect(SCHEME_COLOR_FIELDS.map((f) => f.key)).toEqual(['background', 'text', 'accent', 'button', 'button_text', 'border', 'card']);
  });
});

describe('lists', () => {
  it('toggles an id in and out, up to a max', () => {
    expect(toggleListItem(['a'], 'b', 3)).toEqual(['a', 'b']);
    expect(toggleListItem(['a', 'b'], 'a', 3)).toEqual(['b']);
    expect(toggleListItem(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggleListItem(undefined, 'a', 2)).toEqual(['a']);
  });

  it('list limit comes from the schema max, else the server cap of 50', () => {
    expect(listLimit({ id: 'p', type: 'product_list', label: 'P', max: 12 })).toBe(12);
    expect(listLimit({ id: 'p', type: 'product_list', label: 'P' })).toBe(50);
    expect(listLimit({ id: 'p', type: 'product_list', label: 'P', max: 500 })).toBe(50);
  });
});

describe('options lists', () => {
  it('fonts are the store fonts the server accepts', () => {
    const schema: SettingSchema = { id: 'f', type: 'font', label: 'F' };
    expect(FONT_OPTIONS.map((o) => o.value)).toEqual(STORE_FONT_FAMILIES.filter((f) => f !== 'system'));
    for (const o of FONT_OPTIONS) expect(sanitizeSettingValue(schema, o.value)).toBe(o.value);
  });

  it('icons are the USP icons', () => {
    expect(ICON_OPTIONS.map((o) => o.value)).toEqual([...STUDIO_USP_ICONS]);
  });
});

describe('encodeImageUrl', () => {
  it('encodes the file name so the url rule accepts it', () => {
    expect(encodeImageUrl('https://cdn.example.com/store/my photo (1).png')).toBe('https://cdn.example.com/store/my%20photo%20(1).png');
    expect(encodeImageUrl('/uploads/a b.png')).toBe('/uploads/a%20b.png');
    const schema: SettingSchema = { id: 'i', type: 'image', label: 'I' };
    expect(sanitizeSettingValue(schema, encodeImageUrl('/uploads/a b.png'))).toBe('/uploads/a%20b.png');
  });

  it('is idempotent and leaves query strings, empty and partial values alone', () => {
    expect(encodeImageUrl('/uploads/a%20b.png')).toBe('/uploads/a%20b.png');
    expect(encodeImageUrl('https://x.com/a.png?w=1 2')).toBe('https://x.com/a.png?w=1 2');
    expect(encodeImageUrl('')).toBe('');
    expect(encodeImageUrl('https://')).toBe('https://');
    expect(encodeImageUrl('/a/100% b.png')).toBe('/a/100%25%20b.png');
  });
});

describe('client safety', () => {
  it('fields.ts loads without sanitize-html or pg', () => {
    jest.isolateModules(() => {
      jest.doMock('sanitize-html', () => {
        throw new Error('server-only');
      });
      jest.doMock('pg', () => {
        throw new Error('server-only');
      });
      const f = require('@/lib/store/engine/editor/fields');
      expect(typeof f.settingValue).toBe('function');
    });
  });
});
