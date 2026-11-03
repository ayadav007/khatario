import { contrastRatio, mixHex, PRESET_LOOK, presetSettings, readableAccent, schemesFor } from '@/lib/store/engine/presets/look';
import { presetContextFromRow } from '@/lib/store/engine/preset-context';
import { sanitizeColorSchemes } from '@/lib/store/engine/color-schemes';
import { THEME_SETTINGS_SCHEMA } from '@/lib/store/engine/theme-settings-schema';
import { chowkOnAccent } from '@/lib/store/store-theme';
import type { ThemePreset } from '@/lib/store/engine/types';

const PRESETS: ThemePreset[] = ['studio', 'blank', 'quick', 'grocery', 'khatario', 'heritage'];

describe('mixHex', () => {
  it('mixes and rounds half up', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('expands 3-digit input and returns a', () => {
    expect(mixHex('#fff', '#000', 1)).toBe('#ffffff');
  });

  it('clamps the weight', () => {
    expect(mixHex('#fff', '#000', 2)).toBe('#ffffff');
    expect(mixHex('#fff', '#000', -1)).toBe('#000000');
  });
});

describe('PRESET_LOOK', () => {
  it('holds the D26 table', () => {
    expect(PRESET_LOOK.studio).toEqual({ canvas: '#fbf8f3', accent: '#b94717', font_heading: 'outfit', font_body: 'inter', button_radius: 10, card_style: 'bordered', label_style: 'normal', frame_style: 'none', texture: 'none' });
    expect(PRESET_LOOK.blank).toEqual(PRESET_LOOK.studio);
    expect(PRESET_LOOK.quick).toEqual({ canvas: '#f3f5f7', accent: '#0f7a5c', font_heading: 'inter', font_body: 'inter', button_radius: 14, card_style: 'shadow', label_style: 'normal', frame_style: 'none', texture: 'none' });
    expect(PRESET_LOOK.grocery).toEqual({ canvas: '#f6f7f4', accent: '#176b45', font_heading: 'inter', font_body: 'inter', button_radius: 24, card_style: 'bordered', label_style: 'normal', frame_style: 'none', texture: 'none' });
    expect(PRESET_LOOK.khatario).toEqual({ canvas: '#f4f5f7', accent: '#00897b', font_heading: 'inter', font_body: 'inter', button_radius: 12, card_style: 'plain', label_style: 'normal', frame_style: 'none', texture: 'none' });
    expect(PRESET_LOOK.heritage).toEqual({ canvas: '#fcf9f3', accent: '#7a0c1e', font_heading: 'newsreader', font_body: 'manrope', button_radius: 0, card_style: 'bordered', label_style: 'caps', frame_style: 'accent', texture: 'dots' });
  });
});

describe('schemesFor', () => {
  it('builds grocery from its paper and accent', () => {
    const s = schemesFor('grocery', '#176b45');
    expect(s).toHaveLength(6);
    expect(s[0].background).toBe('#f6f7f4');
    expect(s[0].text).toBe('#1c1917');
    expect(s[0].accent).toBe('#176b45');
    expect(s[0].button).toBe('#176b45');
    expect(s[0].button_text).toBe(chowkOnAccent('#176b45'));
    expect(s[0].card).toBe('#ffffff');
    expect(s[0].border).toBe(mixHex('#1c1917', '#f6f7f4', 0.12));
    expect(s[3]).toMatchObject({ name: 'Accent', background: '#176b45', text: chowkOnAccent('#176b45'), button: chowkOnAccent('#176b45'), button_text: '#176b45' });
    expect(s[5].name).toBe('Deep green');
    expect(s[5].text).toBe('#ffffffe0');
    expect(s[5].accent).toBe('#fbbf24');
    expect(s[5].background).toBe(mixHex('#176b45', '#07140d', 0.3));
  });

  it('falls back to the look accent when the accent is invalid or missing', () => {
    expect(schemesFor('studio', 'nope')[0].accent).toBe('#b94717');
    expect(schemesFor('quick', undefined)[0].accent).toBe('#0f7a5c');
  });

  it('gives Soft, Dark and Cream the store accent, readable on their paper', () => {
    const d = sanitizeColorSchemes(undefined);
    const s = schemesFor('khatario', '#00897b');
    for (const i of [1, 2, 4]) {
      expect(s[i].background).toBe(d[i].background);
      expect(contrastRatio(s[i].accent, s[i].background)).toBeGreaterThanOrEqual(3);
    }
    expect(s[1].accent).toBe('#00897b');
    expect(s[1].button).toBe(d[1].button);
    expect(s[2].button).toBe(s[2].accent);
    expect(s[2].button_text).toBe(chowkOnAccent(s[2].accent));
  });

  it('readableAccent keeps a readable accent and lightens or darkens one that is not', () => {
    expect(readableAccent('#00897b', '#ffffff')).toBe('#00897b');
    const onDark = readableAccent('#1e3a8a', '#111827');
    expect(contrastRatio(onDark, '#111827')).toBeGreaterThanOrEqual(3);
    const onLight = readableAccent('#fde68a', '#faf5eb');
    expect(contrastRatio(onLight, '#faf5eb')).toBeGreaterThanOrEqual(3);
  });

  it('reads on a dark canvas', () => {
    const s = schemesFor('studio', '#b94717', '#131210');
    expect(s[0].background).toBe('#131210');
    expect(s[0].text).toBe('#f4efe6');
    expect(s[0].card).not.toBe('#ffffff');
    expect(s[0].card).toBe(mixHex('#ffffff', '#131210', 0.06));
  });

  it.each(PRESETS)('%s survives sanitising unchanged', (p) => {
    for (const accent of [undefined, '#e11d48', PRESET_LOOK[p].accent]) {
      const s = schemesFor(p, accent);
      expect(sanitizeColorSchemes(s)).toEqual(s);
    }
  });
});

describe('presetContextFromRow', () => {
  it('carries no store accent, so an added theme starts in its own colours', () => {
    expect(presetContextFromRow({ name: 'A', store_theme: { preset: 'grocery', accent: '#ff0000' } }).accent).toBeUndefined();
    expect(presetContextFromRow({ name: 'A', store_theme: { preset: 'custom', accent: '#ff0000' } }).accent).toBeUndefined();
  });

  it('gives an added preset its own accent whatever the store accent', () => {
    for (const p of ['studio', 'quick', 'grocery', 'khatario'] as ThemePreset[]) {
      const ctx = presetContextFromRow({ name: 'A', store_theme: { preset: 'custom', accent: '#ff0000' } });
      expect(presetSettings(ctx, p).color_schemes[0].accent).toBe(PRESET_LOOK[p].accent);
    }
  });

  it('fills the rest of the context', () => {
    const c = presetContextFromRow({
      name: 'Rose Mart',
      tagline: 'Fresh',
      hero_url: 'https://example.com/h.jpg',
      store_theme: { logo_url: 'https://example.com/l.png' },
    });
    expect(c).toMatchObject({ businessName: 'Rose Mart', tagline: 'Fresh', logoUrl: 'https://example.com/l.png', heroUrl: 'https://example.com/h.jpg' });
    expect(presetContextFromRow(null)).toMatchObject({ businessName: '', tagline: '', logoUrl: undefined, heroUrl: undefined });
  });
});

it('the theme card_style setting explains its reach', () => {
  const s = THEME_SETTINGS_SCHEMA.find((x) => x.id === 'card_style');
  expect(s?.info).toBe('Product grid and rail sections keep their own card style');
});

it('every preset but Heritage starts with the default style', () => {
  for (const p of PRESETS.filter((x) => x !== 'heritage')) expect(presetSettings({ businessName: 'X', tagline: '' }, p)).toMatchObject({ label_style: 'normal', frame_style: 'none', texture: 'none' });
});

describe('heritage schemes', () => {
  it('heritage uses its fixed six schemes', () => {
    const s = schemesFor('heritage', undefined);
    expect(s.map((x) => x.name)).toEqual(['Ivory', 'Parchment', 'Crimson', 'Dark', 'Cream', 'Gold']);
    expect(s.map((x) => x.id)).toEqual(['scheme-1', 'scheme-2', 'scheme-3', 'scheme-4', 'scheme-5', 'scheme-6']);
    expect(s[0]).toMatchObject({ background: '#fcf9f3', button: '#7a0c1e' });
    expect(s[3].background).toBe('#1b1514');
  });

  it('ignores the store accent: any accent, valid or not, returns the same table', () => {
    const base = schemesFor('heritage', undefined);
    for (const accent of ['#004537', '#b94717', '#7a0c1e', 'nope', '']) expect(schemesFor('heritage', accent)).toEqual(base);
    expect(schemesFor('heritage', '#004537', '#101010')).toEqual(base);
  });

  it('returns a fresh copy of the table every call', () => {
    const a = schemesFor('heritage', undefined);
    a[0].button = '#000000';
    expect(schemesFor('heritage', undefined)[0].button).toBe('#7a0c1e');
  });

  it('holds the brief colours, with a readable gold on the light papers', () => {
    const s = schemesFor('heritage', undefined);
    const light = (i: number, bg: string) => ({
      id: `scheme-${i + 1}`, background: bg, text: '#1c1c18', accent: readableAccent('#c89d53', bg), button: '#7a0c1e', button_text: '#ffffff', border: mixHex('#1c1c18', bg, 0.12), card: '#ffffff',
    });
    expect(s[0]).toMatchObject({ name: 'Ivory', ...light(0, '#fcf9f3') });
    expect(s[1]).toMatchObject({ name: 'Parchment', ...light(1, '#f4ece0') });
    expect(s[4]).toMatchObject({ name: 'Cream', ...light(4, '#faf5ed') });
    expect(s[2]).toMatchObject({ background: '#7a0c1e', text: '#fcf9f3', accent: '#c89d53', button: '#c89d53', button_text: '#1c1c18' });
    expect(s[3]).toMatchObject({ background: '#1b1514', text: '#fbf8f5', accent: '#c89d53', button: '#c89d53', button_text: '#1b1514', border: '#3d3230', card: '#2a2220' });
    expect(s[5]).toMatchObject({ background: '#c89d53', text: '#1c1c18', accent: '#7a0c1e', button: '#7a0c1e', button_text: '#ffffff' });
    // Gold stays as given where it already reads; the light papers get a darker gold.
    for (const i of [2, 3]) expect(s[i].accent).toBe('#c89d53');
    for (const i of [0, 1, 4]) expect(s[i].accent).not.toBe('#c89d53');
  });

  it('every scheme accent and button reads on its own background (3:1)', () => {
    for (const x of schemesFor('heritage', undefined)) {
      expect(contrastRatio(x.accent, x.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(x.button_text, x.button)).toBeGreaterThanOrEqual(3);
    }
  });

  it('Parchment and Cream compute their border against their own paper', () => {
    const s = schemesFor('heritage', undefined);
    expect(s[1].border).toBe(mixHex('#1c1c18', '#f4ece0', 0.12));
    expect(s[4].border).toBe(mixHex('#1c1c18', '#faf5ed', 0.12));
    expect(s[1].border).not.toBe(s[0].border);
  });

  it('presetSettings gives Heritage its fonts, corners and style fields', () => {
    expect(presetSettings({ businessName: 'X', tagline: '' }, 'heritage')).toMatchObject({
      font_heading: 'newsreader', font_body: 'manrope', button_radius: 0, card_style: 'bordered', label_style: 'caps', frame_style: 'accent', texture: 'dots',
    });
  });
});

describe('drop schemes', () => {
  const SCHEMES: [string, string, string, string, string, string][] = [
    ['Ink', '#0d0d0d', '#f2f0ea', '#d4ff3a', '#d4ff3a', '#0d0d0d'],
    ['Concrete', '#1f1f1f', '#f2f0ea', '#d4ff3a', '#f2f0ea', '#0d0d0d'],
    ['Bone', '#f2f0ea', '#0d0d0d', '#0d0d0d', '#0d0d0d', '#f2f0ea'],
    ['Volt', '#d4ff3a', '#0d0d0d', '#0d0d0d', '#0d0d0d', '#d4ff3a'],
    ['Alarm', '#ff4d2e', '#0d0d0d', '#0d0d0d', '#0d0d0d', '#ff4d2e'],
    ['Smoke', '#2a2a2a', '#f2f0ea', '#d4ff3a', '#d4ff3a', '#0d0d0d'],
  ];

  it('holds the PRESET_LOOK.drop values', () => {
    expect(PRESET_LOOK.drop).toEqual({ canvas: '#0d0d0d', accent: '#d4ff3a', font_heading: 'anton', font_body: 'space-grotesk', button_radius: 0, card_style: 'plain', label_style: 'caps', frame_style: 'none', texture: 'none' });
  });

  it('holds the spec table, with borders and cards mixed from text and background', () => {
    const s = schemesFor('drop', undefined);
    expect(s).toEqual(
      SCHEMES.map(([name, background, text, accent, button, button_text], i) => ({
        id: `scheme-${i + 1}`, name, background, text, accent, button, button_text,
        border: mixHex(text, background, 0.12),
        card: mixHex(text, background, 0.06),
      })),
    );
  });

  it('drop ignores the store accent', () => {
    const base = schemesFor('drop', '#004537');
    for (const accent of ['nope', '', undefined]) expect(schemesFor('drop', accent)).toEqual(base);
    expect(schemesFor('drop', '#004537', '#ffffff')).toEqual(base);
  });

  it('every drop accent and button reads on its background (3:1)', () => {
    for (const x of schemesFor('drop', undefined)) {
      expect(contrastRatio(x.accent, x.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(x.button, x.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(x.button_text, x.button)).toBeGreaterThanOrEqual(3);
    }
  });

  it('survives sanitising unchanged and gives Drop its fonts, corners and style fields', () => {
    const s = schemesFor('drop', undefined);
    expect(sanitizeColorSchemes(s)).toEqual(s);
    expect(presetSettings({ businessName: 'X', tagline: '' }, 'drop')).toMatchObject({
      font_heading: 'anton', font_body: 'space-grotesk', button_radius: 0, card_style: 'plain', label_style: 'caps', frame_style: 'none', texture: 'none',
    });
  });
});

describe('bazaar schemes', () => {
  const SCHEMES: [string, string, string, string, string, string][] = [
    ['White', '#ffffff', '#14213d', '#e8590c', '#e8590c', '#ffffff'],
    ['Cream', '#fff6ea', '#14213d', '#e8590c', '#14213d', '#ffffff'],
    // The spec gives Saffron a marigold accent (#ffc300), which reads only 2.2:1 on saffron; white reads 3.6:1, like Leaf.
    ['Saffron', '#e8590c', '#ffffff', '#ffffff', '#14213d', '#ffffff'],
    ['Navy', '#14213d', '#ffffff', '#ffc300', '#ffc300', '#14213d'],
    ['Marigold', '#ffc300', '#14213d', '#14213d', '#14213d', '#ffffff'],
    ['Leaf', '#2a9d4b', '#ffffff', '#ffffff', '#ffffff', '#1d6b33'],
  ];

  it('holds the PRESET_LOOK.bazaar values', () => {
    expect(PRESET_LOOK.bazaar).toEqual({ canvas: '#ffffff', accent: '#e8590c', font_heading: 'baloo', font_body: 'poppins', button_radius: 12, card_style: 'bordered', label_style: 'normal', frame_style: 'none', texture: 'none' });
  });

  it('holds the spec table, with borders and cards mixed from text and background', () => {
    expect(schemesFor('bazaar', undefined)).toEqual(
      SCHEMES.map(([name, background, text, accent, button, button_text], i) => ({
        id: `scheme-${i + 1}`, name, background, text, accent, button, button_text,
        border: mixHex(text, background, 0.12),
        card: mixHex(text, background, 0.04),
      })),
    );
  });

  it('bazaar ignores the store accent', () => {
    const base = schemesFor('bazaar', '#004537');
    for (const accent of ['nope', '', undefined, '#e11d48']) expect(schemesFor('bazaar', accent)).toEqual(base);
    expect(schemesFor('bazaar', '#004537', '#000000')).toEqual(base);
    expect(base[0].accent).toBe('#e8590c');
  });

  it('every bazaar accent, button and button text reads 3:1', () => {
    for (const x of schemesFor('bazaar', undefined)) {
      expect(contrastRatio(x.accent, x.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(x.button, x.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(x.button_text, x.button)).toBeGreaterThanOrEqual(3);
    }
  });

  it('survives sanitising unchanged and gives Bazaar its fonts, corners and style fields', () => {
    const s = schemesFor('bazaar', undefined);
    expect(sanitizeColorSchemes(s)).toEqual(s);
    expect(presetSettings({ businessName: 'X', tagline: '' }, 'bazaar')).toMatchObject({
      font_heading: 'baloo', font_body: 'poppins', button_radius: 12, card_style: 'bordered', label_style: 'normal', frame_style: 'none', texture: 'none',
    });
  });
});
