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
  resolveAnnouncementText,
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
    expect(t.background).toBe(PACK_CANVAS.studio);
    expect(t.mobile_columns).toBe(3);
    expect(t.category_style).toBe('photo');
    expect(t.search_placeholder).toBe('Search atta');
  });

  it('treats retired presets as a custom Studio theme', () => {
    const t = sanitizeStoreTheme({ preset: 'saffron', accent: '#123456' });
    expect(t.preset).toBe('custom');
    expect(t.pack).toBe('studio');
    expect(t.accent).toBe('#123456');
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
  it('applies the Studio pack with photo categories', () => {
    expect(applyStorePreset('studio')).toEqual({
      preset: 'studio',
      accent: STORE_THEME_PRESETS.studio.accent,
      background: STORE_THEME_PRESETS.studio.background,
      pack: 'studio',
      mobile_columns: 2,
      category_style: 'photo',
      hero_cta: 'Shop now',
      search_placeholder: 'Search for products, categories…',
      appearance_mode: 'light',
    });
  });

  it('applies Premium Grocery with overlay bands on and trust off', () => {
    const t = applyStorePreset('grocery');
    expect(t).toMatchObject({ preset: 'grocery', pack: 'grocery', category_style: 'icon', hero_cta: 'Shop groceries' });
    expect(t.homepage_sections?.find((s) => s.id === 'overlay')?.enabled).toBe(true);
    expect(t.homepage_sections?.find((s) => s.id === 'trust')?.enabled).toBe(false);
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
  it('defaults themes without a pack to Studio', () => {
    expect(sanitizeStoreTheme({ preset: 'green' }).pack).toBe('studio');
    expect(sanitizeStoreTheme(null).pack).toBe('studio');
  });

  it.each(['classic', 'chowk', 'atelier', 'noir', 'aether'])('moves retired %s pack to Studio', (pack) => {
    const t = sanitizeStoreTheme({ preset: 'custom', pack, accent: '#112233' });
    expect(t.pack).toBe('studio');
    expect(t.accent).toBe('#112233');
    expect(t.background).toBe(storeCanvas(t));
  });

  it('keeps retired dark packs dark when no mode was saved', () => {
    expect(sanitizeStoreTheme({ pack: 'aether' }).appearance_mode).toBe('dark');
    expect(sanitizeStoreTheme({ pack: 'aether', appearance_mode: 'light' }).appearance_mode).toBe('light');
  });

  it('keeps Khatario and Grocery packs when colours are customised', () => {
    const k = sanitizeStoreTheme({ preset: 'custom', pack: 'khatario', accent: '#e85d04' });
    expect(k.pack).toBe('khatario');
    expect(k.accent).toBe('#e85d04');
    expect(k.background).toBe(PACK_CANVAS.khatario);
    expect(sanitizeStoreTheme({ preset: 'custom', pack: 'grocery' }).pack).toBe('grocery');
  });

  it('never paints the body with brand colour', () => {
    const t = sanitizeStoreTheme({
      preset: 'custom',
      pack: 'studio',
      accent: '#e11d48',
      background: '#22c55e',
    });
    expect(t.accent).toBe('#e11d48');
    expect(t.background).toBe(PACK_CANVAS.studio);
    expect(storeCanvas(t)).toBe(PACK_CANVAS.studio);
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

describe('announcement settings', () => {
  it('defaults to theme colours, centred, automatic allowed', () => {
    const t = sanitizeStoreTheme({});
    expect(t.announcement_bg).toBe('');
    expect(t.announcement_fg).toBe('');
    expect(t.announcement_align).toBe('center');
    expect(t.announcement_auto).toBe(true);
    expect(t.announcement_link).toBe('');
  });

  it('keeps valid colours, alignment and links; drops junk', () => {
    const t = sanitizeStoreTheme({
      announcement_bg: '#ABC',
      announcement_fg: 'red',
      announcement_align: 'right',
      announcement_link: 'javascript:alert(1)',
      announcement_auto: false,
    });
    expect(t.announcement_bg).toBe('#aabbcc');
    expect(t.announcement_fg).toBe('');
    expect(t.announcement_align).toBe('right');
    expect(t.announcement_link).toBe('');
    expect(t.announcement_auto).toBe(false);
    expect(sanitizeStoreTheme({ announcement_align: 'middle' }).announcement_align).toBe('center');
    expect(sanitizeStoreTheme({ announcement_link: '/about' }).announcement_link).toBe('/about');
  });

  it('prefers custom text over the automatic line', () => {
    const base = sanitizeStoreTheme({});
    expect(resolveAnnouncementText({ ...base, announcement: 'Diwali sale' }, 'auto line')).toBe('Diwali sale');
    expect(resolveAnnouncementText(base, 'auto line')).toBe('auto line');
    expect(resolveAnnouncementText({ ...base, announcement_auto: false }, 'auto line')).toBe('');
  });
});

describe('contact form settings', () => {
  it('is off by default with sensible copy', () => {
    const f = sanitizeStoreTheme({}).contact_form;
    expect(f.enabled).toBe(false);
    expect(f.phone).toBe('required');
    expect(f.email).toBe('optional');
    expect(f.button).toBe('Send message');
  });

  it('keeps valid values and rejects bad modes', () => {
    const f = sanitizeStoreTheme({
      contact_form: { enabled: true, title: 'Ask us', phone: 'off', email: 'required', button: 'Go', success: 'Done' },
    }).contact_form;
    expect(f).toMatchObject({ enabled: true, title: 'Ask us', phone: 'off', email: 'required', button: 'Go', success: 'Done' });
    expect(sanitizeStoreTheme({ contact_form: { phone: 'maybe' } }).contact_form.phone).toBe('required');
  });

  it('sanitizes layout and look options', () => {
    const d = sanitizeStoreTheme({}).contact_form;
    expect(d).toMatchObject({
      layout: 'stacked', align: 'left', width: 'medium', style: 'card',
      labels_inside: false, button_full: true, quick_links: false, topics: [],
    });
    const f = sanitizeStoreTheme({
      contact_form: {
        layout: 'text-form', align: 'center', width: 'wide', style: 'filled',
        labels_inside: true, button_full: false, quick_links: true,
        topics: [' Bulk order ', '', 'Bulk order', 'Order status', 42],
      },
    }).contact_form;
    expect(f).toMatchObject({
      layout: 'text-form', align: 'center', width: 'wide', style: 'filled',
      labels_inside: true, button_full: false, quick_links: true,
      topics: ['Bulk order', 'Order status', '42'],
    });
    const bad = sanitizeStoreTheme({ contact_form: { layout: 'grid', width: 'huge', style: 'neon', align: 'top' } }).contact_form;
    expect(bad).toMatchObject({ layout: 'stacked', width: 'medium', style: 'card', align: 'left' });
  });

  it('always requires at least one way to reply', () => {
    const f = sanitizeStoreTheme({ contact_form: { phone: 'off', email: 'optional' } }).contact_form;
    expect(f.phone).toBe('required');
  });
});
