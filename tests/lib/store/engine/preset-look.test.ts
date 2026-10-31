import { contrastRatio, mixHex, PRESET_LOOK, presetSettings, readableAccent, schemesFor } from '@/lib/store/engine/presets/look';
import { presetContextFromRow } from '@/lib/store/engine/preset-context';
import { sanitizeColorSchemes } from '@/lib/store/engine/color-schemes';
import { THEME_SETTINGS_SCHEMA } from '@/lib/store/engine/theme-settings-schema';
import { chowkOnAccent } from '@/lib/store/store-theme';
import type { ThemePreset } from '@/lib/store/engine/types';

const PRESETS: ThemePreset[] = ['studio', 'blank', 'quick', 'grocery', 'khatario'];

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
  it('uses the pack accent for a named preset', () => {
    expect(presetContextFromRow({ name: 'A', store_theme: { preset: 'grocery', accent: '#ff0000' } }).accent).toBe('#176b45');
  });

  it('uses the stored accent for a custom theme', () => {
    expect(presetContextFromRow({ name: 'A', store_theme: { preset: 'custom', accent: '#ff0000' } }).accent).toBe('#ff0000');
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

it('every preset starts with the default style', () => {
  for (const p of PRESETS) expect(presetSettings({ businessName: 'X', tagline: '' }, p)).toMatchObject({ label_style: 'normal', frame_style: 'none', texture: 'none' });
});
