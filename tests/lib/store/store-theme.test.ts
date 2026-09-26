import {
  sanitizeStoreTheme,
  applyStorePreset,
  STORE_THEME_PRESETS,
  PACK_CANVAS,
  storeCanvas,
  CHOWK_INK,
  chowkInkOn,
  chowkOnAccent,
  sectionEnabled,
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
    expect(t.background).toBe(PACK_CANVAS.classic);
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
      { image_url: 'https://cdn.example/a.jpg', title: 'Sale', subtitle: 'This week', viewport: 'both' },
      { image_url: '', title: 'Only text', subtitle: '', viewport: 'both' },
    ]);
  });

  it('strips dangerous custom CSS', () => {
    const t = sanitizeStoreTheme({
      custom_css: '@import url("x"); script { } expression(alert(1)); color:red;',
    });
    expect(t.custom_css).not.toMatch(/@import/i);
    expect(t.custom_css).not.toMatch(/expression/i);
  });

  it('honours the categories homepage toggle', () => {
    const t = sanitizeStoreTheme({
      homepage_sections: [{ id: 'categories', enabled: false }],
    });
    expect(sectionEnabled(t, 'categories')).toBe(false);
    expect(sectionEnabled(sanitizeStoreTheme({}), 'categories')).toBe(true);
  });

  it('keeps product collection shelves', () => {
    const t = sanitizeStoreTheme({
      product_shelves: [
        { id: 'shelf-sale', title: 'On sale', kind: 'discounted', enabled: true },
        { id: 'shelf-99', title: 'Under ₹99', kind: 'price_max', price_max: 99, enabled: true },
        { id: 'bad id', kind: 'price_max', price_max: -3 },
      ],
    });
    expect(t.product_shelves).toHaveLength(3);
    expect(t.product_shelves[0]).toMatchObject({ id: 'shelf-sale', kind: 'discounted' });
    expect(t.product_shelves[1].price_max).toBe(99);
    expect(t.product_shelves[2].price_max).toBe(1);
    expect(sectionEnabled(t, 'product_shelves')).toBe(false);
  });

  it('backfills homepage sections from show flags', () => {
    const t = sanitizeStoreTheme({ show_hero: false, show_trust: false });
    expect(t.homepage_sections.find((s) => s.id === 'hero')?.enabled).toBe(false);
    expect(t.homepage_sections.find((s) => s.id === 'trust')?.enabled).toBe(false);
    expect(t.homepage_sections.find((s) => s.id === 'catalog')?.enabled).toBe(true);
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
      pack: 'classic',
      mobile_columns: 2,
      category_style: 'letter',
      hero_cta: 'Shop now',
      appearance_mode: 'light',
    });
  });

  it('applies Chowk pack with paper and chilli', () => {
    expect(applyStorePreset('chowk')).toEqual({
      preset: 'chowk',
      accent: STORE_THEME_PRESETS.chowk.accent,
      background: STORE_THEME_PRESETS.chowk.background,
      pack: 'chowk',
      mobile_columns: 3,
      category_style: 'letter',
      hero_cta: 'Shop now',
      search_placeholder: 'Search atta, oil, soap…',
      appearance_mode: 'light',
    });
  });

  it('applies Atelier pack with ivory paper and ink', () => {
    expect(applyStorePreset('atelier')).toEqual({
      preset: 'atelier',
      accent: STORE_THEME_PRESETS.atelier.accent,
      background: STORE_THEME_PRESETS.atelier.background,
      pack: 'atelier',
      mobile_columns: 2,
      category_style: 'photo',
      hero_cta: 'Explore Collection',
      search_placeholder: 'Search jackets, cashmere, accessories…',
      appearance_mode: 'light',
    });
  });

  it('applies Aether pack with gold on ink', () => {
    const t = applyStorePreset('aether');
    expect(t).toEqual({
      preset: 'aether',
      accent: STORE_THEME_PRESETS.aether.accent,
      background: STORE_THEME_PRESETS.aether.background,
      pack: 'aether',
      mobile_columns: 2,
      category_style: 'photo',
      hero_cta: 'Shop collection',
      hero_subtitle: 'Quiet luxury, considered pieces.',
      search_placeholder: 'Coats, pearls, chronograph…',
      appearance_mode: 'dark',
      font_family: 'cormorant',
      announcement: 'Free express shipping  ·  Handcrafted  ·  Lifetime repairs',
      hero_slides: expect.any(Array),
      homepage_sections: expect.any(Array),
    });
    expect(t.hero_slides?.[0]?.image_url).toMatch(/^https:\/\//);
    expect(t.hero_slides?.[0]?.title).toBe('The art of less.');
  });

  it('applies Khatario pack from Digitable store-app chrome', () => {
    expect(applyStorePreset('khatario')).toEqual({
      preset: 'khatario',
      accent: STORE_THEME_PRESETS.khatario.accent,
      background: STORE_THEME_PRESETS.khatario.background,
      pack: 'khatario',
      mobile_columns: 2,
      category_style: 'letter',
      hero_cta: 'Order now',
      search_placeholder: 'Search for items…',
      appearance_mode: 'light',
    });
  });
});

describe('store theme pack', () => {
  it('keeps classic pack for existing themes without pack', () => {
    const t = sanitizeStoreTheme({ preset: 'green' });
    expect(t.pack).toBe('classic');
  });

  it('keeps Chowk pack when colours are customised', () => {
    const t = sanitizeStoreTheme({
      preset: 'custom',
      pack: 'chowk',
      accent: '#112233',
      background: '#f3eee6',
    });
    expect(t.pack).toBe('chowk');
    expect(t.accent).toBe('#112233');
    expect(t.background).toBe(PACK_CANVAS.chowk);
  });

  it('keeps Khatario pack when colours are customised', () => {
    const t = sanitizeStoreTheme({
      preset: 'custom',
      pack: 'khatario',
      accent: '#e85d04',
    });
    expect(t.pack).toBe('khatario');
    expect(t.accent).toBe('#e85d04');
    expect(t.background).toBe(PACK_CANVAS.khatario);
  });

  it('keeps Atelier pack when colours are customised', () => {
    const t = sanitizeStoreTheme({
      preset: 'custom',
      pack: 'atelier',
      accent: '#3b2f2a',
      background: '#f6f3ef',
    });
    expect(t.pack).toBe('atelier');
    expect(t.accent).toBe('#3b2f2a');
    expect(t.background).toBe(PACK_CANVAS.atelier);
  });

  it('never paints the body with brand colour', () => {
    const t = sanitizeStoreTheme({
      preset: 'custom',
      pack: 'classic',
      accent: '#e11d48',
      background: '#22c55e',
    });
    expect(t.accent).toBe('#e11d48');
    expect(t.background).toBe(PACK_CANVAS.classic);
    expect(storeCanvas(t)).toBe(PACK_CANVAS.classic);
  });
});

describe('chowkInkOn', () => {
  it('keeps dark ink on paper backgrounds', () => {
    expect(chowkInkOn('#f3eee6')).toBe(CHOWK_INK);
    expect(chowkInkOn('#ffffff')).toBe(CHOWK_INK);
  });

  it('switches to light ink on dark merchant backgrounds', () => {
    expect(chowkInkOn('#1c1917')).toBe('#f4efe6');
    expect(chowkInkOn('#111827')).toBe('#f4efe6');
  });

  it('picks readable type on chilli and pale accents', () => {
    expect(chowkOnAccent('#e07030')).toBe('#f4efe6');
    expect(chowkOnAccent('#fbbf24')).toBe(CHOWK_INK);
  });
});
