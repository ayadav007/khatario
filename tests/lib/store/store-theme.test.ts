import {
  sanitizeStoreTheme,
  applyStorePreset,
  DEFAULT_STORE_THEME,
  STORE_THEME_PRESETS,
} from '@/lib/store/store-theme';

describe('sanitizeStoreTheme', () => {
  it('defaults missing theme to green-like homepage on', () => {
    const t = sanitizeStoreTheme(null);
    expect(t.show_hero).toBe(true);
    expect(t.show_offers).toBe(true);
    expect(t.mobile_columns).toBe(2);
    expect(t.category_style).toBe('letter');
  });

  it('keeps a custom accent when preset is custom', () => {
    const t = sanitizeStoreTheme({
      preset: 'custom',
      accent: '#0f0',
      background: 'nope',
      mobile_columns: 3,
      category_style: 'photo',
      search_placeholder: 'Search atta',
    });
    expect(t.accent).toBe('#00ff00');
    expect(t.background).toBe(DEFAULT_STORE_THEME.background);
    expect(t.mobile_columns).toBe(3);
    expect(t.category_style).toBe('photo');
    expect(t.search_placeholder).toBe('Search atta');
  });

  it('applies saffron preset colours', () => {
    const t = sanitizeStoreTheme({ preset: 'saffron', accent: '#000000' });
    expect(t.accent).toBe(STORE_THEME_PRESETS.saffron.accent);
    expect(t.background).toBe(STORE_THEME_PRESETS.saffron.background);
  });

  it('keeps up to six hero slides', () => {
    const t = sanitizeStoreTheme({
      hero_slides: [
        { image_url: 'https://cdn.example/a.jpg', title: 'Sale', subtitle: 'This week' },
        { image_url: 'javascript:alert(1)', title: '', subtitle: '' },
        { title: 'Only text' },
      ],
    });
    expect(t.hero_slides).toEqual([
      { image_url: 'https://cdn.example/a.jpg', title: 'Sale', subtitle: 'This week' },
      { image_url: '', title: 'Only text', subtitle: '' },
    ]);
  });

  it('drops unsafe category image keys', () => {
    const t = sanitizeStoreTheme({
      category_images: {
        'ok-id': 'https://cdn.example/cat.jpg',
        'bad key': 'https://x',
        script: 'javascript:alert(1)',
      },
    });
    expect(t.category_images['ok-id']).toBe('https://cdn.example/cat.jpg');
    expect(t.category_images['bad key']).toBeUndefined();
    expect(t.category_images.script).toBeUndefined();
  });
});

describe('applyStorePreset', () => {
  it('returns matching accent and background', () => {
    expect(applyStorePreset('blue')).toEqual({
      preset: 'blue',
      accent: STORE_THEME_PRESETS.blue.accent,
      background: STORE_THEME_PRESETS.blue.background,
    });
  });
});
