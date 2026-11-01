import {
  CARD_DESIGNS,
  CARD_DESIGN_IDS,
  CARD_LINE_IDS,
  PRODUCT_CARD_DEFAULTS,
  cardLookClasses,
  cardLookVars,
  nameAndPriceInRow,
  normaliseLines,
  resolveCardLook,
  sanitizeProductCard,
  type CardDesignId,
  type ProductCardSettings,
} from '@/lib/store/engine/product-card';
import { sanitizeSettingValue } from '@/lib/store/engine/settings';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import type { SettingSchema } from '@/lib/store/engine/schema-types';

const on = (card: ProductCardSettings, id: string) => card.lines.find((l) => l.id === id)?.on;
const withLines = (lines: ProductCardSettings['lines'], extra: Partial<ProductCardSettings> = {}): ProductCardSettings => ({
  ...PRODUCT_CARD_DEFAULTS,
  ...extra,
  lines,
});

describe('PRODUCT_CARD_DEFAULTS', () => {
  it('matches the spec table', () => {
    const d = PRODUCT_CARD_DEFAULTS;
    expect(d.design).toBe('theme');
    expect(d.lines.map((l) => l.id)).toEqual(['brand', 'name', 'unit', 'rating', 'tagline', 'price', 'swatches', 'buttons']);
    expect(d.lines.map((l) => l.on)).toEqual([false, true, true, true, true, true, true, true]);
    expect(d).toMatchObject({
      layout: 'stack',
      name_price_row: false,
      name_font: 'body',
      name_case: 'normal',
      name_lines: 2,
      name_size: 'm',
      rating_style: 'number',
      price_size: 'm',
      price_color: 'text',
      show_mrp: true,
      discount_style: 'text',
      image_shape: 'square',
      image_fit: 'fill',
      image_padding: 0,
      image_radius: 0,
      image_bg: '',
      image_hover: 'none',
      image_swipe: false,
      placeholder: 'initial',
      badge_shape: 'pill',
      badge_position: 'top-left',
      badge_icon: 'none',
      badge_colors: 'accent',
      button_style: 'full',
      button_fill: 'filled',
      button_shape: 'rounded',
      button_reveal: 'always',
      button_action: 'add',
      after_add: 'stepper',
      wishlist: 'top-right',
      wishlist_bg: 'plain',
      color_scheme: '',
      border: 0,
      radius: 12,
      shadow: 'none',
      align: 'left',
      padding: 12,
      background_image: '',
      hover: 'none',
      oos_look: 'label',
      oos_place: 'stay',
    });
  });

  it('passes the sanitiser unchanged and sanitising nothing gives the defaults', () => {
    expect(sanitizeProductCard(PRODUCT_CARD_DEFAULTS)).toEqual(PRODUCT_CARD_DEFAULTS);
    for (const raw of [undefined, null, 5, 'x', [], {}]) expect(sanitizeProductCard(raw)).toEqual(PRODUCT_CARD_DEFAULTS);
  });

  it('gives a fresh object each time', () => {
    const a = sanitizeProductCard({});
    a.lines[0].on = true;
    expect(sanitizeProductCard({}).lines[0].on).toBe(false);
    expect(PRODUCT_CARD_DEFAULTS.lines[0].on).toBe(false);
  });
});

describe('sanitizeProductCard fields', () => {
  const D = PRODUCT_CARD_DEFAULTS as unknown as Record<string, unknown>;
  const enums: Array<[string, string[]]> = [
    ['design', ['theme', ...CARD_DESIGN_IDS]],
    ['layout', ['stack', 'row']],
    ['name_font', ['heading', 'body']],
    ['name_case', ['normal', 'caps']],
    ['name_size', ['s', 'm', 'l']],
    ['rating_style', ['stars', 'number', 'count']],
    ['price_size', ['s', 'm', 'l']],
    ['price_color', ['text', 'accent']],
    ['discount_style', ['none', 'text', 'pill', 'save']],
    ['image_shape', ['square', 'portrait', 'landscape', 'natural']],
    ['image_fit', ['fill', 'contain']],
    ['image_hover', ['none', 'second', 'zoom']],
    ['placeholder', ['initial', 'logo', 'icon']],
    ['badge_shape', ['pill', 'ribbon', 'corner']],
    ['badge_position', ['top-left', 'top-right']],
    ['badge_icon', ['none', 'crown', 'star', 'flame', 'sparkle']],
    ['badge_colors', ['accent', 'button']],
    ['button_style', ['full', 'pill_on_photo', 'icon', 'icon_full', 'none']],
    ['button_fill', ['filled', 'outline']],
    ['button_shape', ['rounded', 'pill']],
    ['button_reveal', ['always', 'hover']],
    ['button_action', ['add', 'buy']],
    ['after_add', ['button', 'stepper']],
    ['wishlist', ['off', 'top-left', 'top-right']],
    ['wishlist_bg', ['plain', 'circle']],
    ['shadow', ['none', 'soft', 'strong']],
    ['align', ['left', 'center']],
    ['hover', ['none', 'lift', 'zoom']],
    ['oos_look', ['label', 'faded', 'soldout_button']],
    ['oos_place', ['stay', 'end', 'hide']],
  ];

  it.each(enums)('%s keeps every allowed value and falls back on anything else', (key, allowed) => {
    for (const v of allowed) expect((sanitizeProductCard({ [key]: v }) as unknown as Record<string, unknown>)[key]).toBe(v);
    for (const bad of ['nope', '', 3, null, true, {}, ['x']]) {
      expect((sanitizeProductCard({ [key]: bad }) as unknown as Record<string, unknown>)[key]).toBe(D[key]);
    }
  });

  const flags = ['name_price_row', 'show_mrp', 'image_swipe'] as const;
  it.each(flags)('%s takes only a real boolean', (key) => {
    expect(sanitizeProductCard({ [key]: true })[key]).toBe(true);
    expect(sanitizeProductCard({ [key]: false })[key]).toBe(false);
    for (const bad of ['true', 1, 0, null, 'yes']) expect(sanitizeProductCard({ [key]: bad })[key]).toBe(D[key]);
  });

  const ranges: Array<[keyof ProductCardSettings, number, number]> = [
    ['image_padding', 0, 24],
    ['image_radius', 0, 32],
    ['border', 0, 3],
    ['radius', 0, 32],
    ['padding', 0, 24],
  ];
  it.each(ranges)('%s is a whole number kept inside its range; non-numbers fall back', (key, min, max) => {
    const get = (v: unknown) => sanitizeProductCard({ [key]: v })[key];
    expect(get(min)).toBe(min);
    expect(get(max)).toBe(max);
    expect(get(max + 50)).toBe(max);
    expect(get(min - 50)).toBe(min);
    expect(get(Math.min(max, min + 1.4))).toBe(Math.min(max, min + 1));
    for (const bad of ['5', null, NaN, Infinity, true, {}]) expect(get(bad)).toBe(D[key as string]);
  });

  it('name_lines is 1 or 2 only', () => {
    expect(sanitizeProductCard({ name_lines: 1 }).name_lines).toBe(1);
    expect(sanitizeProductCard({ name_lines: 2 }).name_lines).toBe(2);
    for (const bad of [0, 3, '1', null, 1.5]) expect(sanitizeProductCard({ name_lines: bad }).name_lines).toBe(2);
  });

  it('image_bg takes a hex colour or empty', () => {
    expect(sanitizeProductCard({ image_bg: '#f4f4f5' }).image_bg).toBe('#f4f4f5');
    expect(sanitizeProductCard({ image_bg: '#fff' }).image_bg).toBe('#fff');
    expect(sanitizeProductCard({ image_bg: '' }).image_bg).toBe('');
    for (const bad of ['red', 'url(x)', '#12', 5, null]) expect(sanitizeProductCard({ image_bg: bad }).image_bg).toBe('');
  });

  it('background_image takes an https or site-relative link or empty, nothing else', () => {
    expect(sanitizeProductCard({ background_image: 'https://cdn.example.com/a.jpg' }).background_image).toBe('https://cdn.example.com/a.jpg');
    expect(sanitizeProductCard({ background_image: '/uploads/a.jpg' }).background_image).toBe('/uploads/a.jpg');
    expect(sanitizeProductCard({ background_image: '' }).background_image).toBe('');
    for (const bad of ['javascript:alert(1)', 'http://x.com/a.jpg', '//evil.com/a.jpg', 'data:image/png;base64,AA', 7, null]) {
      expect(sanitizeProductCard({ background_image: bad }).background_image).toBe('');
    }
  });

  it('color_scheme takes a scheme id or empty; with known ids an unknown one is dropped', () => {
    expect(sanitizeProductCard({ color_scheme: 'scheme-3' }).color_scheme).toBe('scheme-3');
    expect(sanitizeProductCard({ color_scheme: '' }).color_scheme).toBe('');
    for (const bad of ['Bad Id', 'x'.repeat(40), 3, null]) expect(sanitizeProductCard({ color_scheme: bad }).color_scheme).toBe('');
    const known = new Set(['scheme-1', 'scheme-3']);
    expect(sanitizeProductCard({ color_scheme: 'scheme-3' }, known).color_scheme).toBe('scheme-3');
    expect(sanitizeProductCard({ color_scheme: 'scheme-9' }, known).color_scheme).toBe('');
  });

  it('keeps good fields when others are bad', () => {
    const out = sanitizeProductCard({ design: 'bogus', radius: 20, button_style: 'icon' });
    expect(out.design).toBe('theme');
    expect(out.radius).toBe(20);
    expect(out.button_style).toBe('icon');
  });
});

describe('normaliseLines', () => {
  it('always gives every known line exactly once', () => {
    for (const raw of [undefined, null, 'x', 5, [], {}, [1, 'a', null], [{ id: 'zzz', on: true }]]) {
      expect(normaliseLines(raw).map((l) => l.id)).toEqual([...PRODUCT_CARD_DEFAULTS.lines.map((l) => l.id)]);
    }
    expect(CARD_LINE_IDS).toEqual(PRODUCT_CARD_DEFAULTS.lines.map((l) => l.id));
  });

  it('drops duplicates (the first wins) and unknown ids, and appends missing ones off', () => {
    const out = normaliseLines([
      { id: 'price', on: true },
      { id: 'bogus', on: true },
      { id: 'name', on: true },
      { id: 'price', on: false },
      null,
      { id: 'buttons', on: false },
    ]);
    expect(out).toEqual([
      { id: 'price', on: true },
      { id: 'name', on: true },
      { id: 'buttons', on: false },
      { id: 'brand', on: false },
      { id: 'unit', on: false },
      { id: 'rating', on: false },
      { id: 'tagline', on: false },
      { id: 'swatches', on: false },
    ]);
  });

  it('a line with a bad on flag takes that line\'s default', () => {
    const out = normaliseLines([{ id: 'brand', on: 'yes' }, { id: 'name', on: 1 }]);
    expect(out.slice(0, 2)).toEqual([{ id: 'brand', on: false }, { id: 'name', on: true }]);
  });

  it('keeps a sensible order from an array that holds nothing usable', () => {
    expect(normaliseLines([])).toEqual(PRODUCT_CARD_DEFAULTS.lines);
    expect(normaliseLines([{ id: 'nope' }, 4])).toEqual(PRODUCT_CARD_DEFAULTS.lines);
  });

  it('is applied by sanitizeProductCard', () => {
    const out = sanitizeProductCard({ lines: [{ id: 'price', on: true }, { id: 'price', on: true }, { id: 'x', on: true }] });
    expect(out.lines.map((l) => l.id)).toEqual(['price', 'brand', 'name', 'unit', 'rating', 'tagline', 'swatches', 'buttons']);
  });
});

describe('the ten designs', () => {
  const ids: CardDesignId[] = ['classic', 'minimal', 'grocery', 'boutique', 'list', 'royal', 'deal', 'soft', 'editorial', 'dark'];

  it('are exactly the ten ids', () => {
    expect([...CARD_DESIGN_IDS]).toEqual(ids);
    expect(Object.keys(CARD_DESIGNS).sort()).toEqual([...ids].sort());
  });

  it.each(ids)('%s is complete, named after itself and passes the sanitiser unchanged', (id) => {
    const d = CARD_DESIGNS[id];
    expect(d.design).toBe(id);
    expect(sanitizeProductCard(d)).toEqual(d);
    expect(Object.keys(d).sort()).toEqual(Object.keys(PRODUCT_CARD_DEFAULTS).sort());
    expect(d.oos_look).toBe('label');
    expect(d.oos_place).toBe('stay');
  });

  it.each(ids)('%s name line is on', (id) => {
    expect(on(CARD_DESIGNS[id], 'name')).toBe(true);
  });

  it('are separate objects from the defaults', () => {
    expect(CARD_DESIGNS.classic.lines).not.toBe(PRODUCT_CARD_DEFAULTS.lines);
    expect(CARD_DESIGNS.classic.lines).not.toBe(CARD_DESIGNS.minimal.lines);
  });

  it('are all different from each other', () => {
    const seen = new Set(ids.map((id) => JSON.stringify({ ...CARD_DESIGNS[id], design: '' })));
    expect(seen.size).toBe(ids.length);
  });

  it('Royal matches the jewellery reference', () => {
    const r = CARD_DESIGNS.royal;
    expect(r).toMatchObject({
      image_shape: 'portrait',
      badge_shape: 'ribbon',
      badge_icon: 'crown',
      badge_position: 'top-left',
      wishlist: 'top-right',
      wishlist_bg: 'circle',
      image_swipe: true,
      name_font: 'heading',
      rating_style: 'count',
      price_size: 'l',
      price_color: 'accent',
      show_mrp: true,
      discount_style: 'pill',
      button_style: 'icon_full',
      button_action: 'add',
      border: 1,
      radius: 16,
    });
    expect(r.image_padding).toBeGreaterThan(0);
    expect(r.image_radius).toBeGreaterThan(0);
    expect(on(r, 'tagline')).toBe(true);
    expect(on(r, 'rating')).toBe(true);
    expect(on(r, 'price')).toBe(true);
    expect(on(r, 'buttons')).toBe(true);
  });

  it('Editorial has no card box', () => {
    expect(CARD_DESIGNS.editorial).toMatchObject({ border: 0, radius: 0, padding: 0, shadow: 'none', image_hover: 'second', name_case: 'caps' });
  });

  it('Dark uses the dark scheme and List lays out in a row', () => {
    expect(CARD_DESIGNS.dark.color_scheme).toBe('scheme-3');
    expect(CARD_DESIGNS.list.layout).toBe('row');
    for (const id of ids.filter((i) => i !== 'list')) expect(CARD_DESIGNS[id].layout).toBe('stack');
  });

  it('Boutique shows no button and a second photo on hover; Soft is round and soft', () => {
    expect(CARD_DESIGNS.boutique).toMatchObject({ button_style: 'none', image_hover: 'second', align: 'center', image_shape: 'portrait' });
    expect(CARD_DESIGNS.soft).toMatchObject({ radius: 24, shadow: 'soft', align: 'center' });
  });

  it('Minimal shows its full Add button on hover, Soft has a pill button and Dark an outline one', () => {
    expect(CARD_DESIGNS.minimal).toMatchObject({ button_style: 'full', button_reveal: 'hover' });
    expect(CARD_DESIGNS.soft).toMatchObject({ button_style: 'full', button_shape: 'pill' });
    expect(CARD_DESIGNS.dark).toMatchObject({ button_style: 'full', button_fill: 'outline' });
    for (const id of ['classic', 'royal', 'deal'] as const) {
      expect(CARD_DESIGNS[id]).toMatchObject({ button_fill: 'filled', button_shape: 'rounded', button_reveal: 'always' });
    }
  });

  it('Minimal puts name and price on one line; Grocery has a pill on the photo that becomes a stepper', () => {
    expect(CARD_DESIGNS.minimal.name_price_row).toBe(true);
    expect(nameAndPriceInRow(CARD_DESIGNS.minimal)).toBe(true);
    expect(CARD_DESIGNS.grocery).toMatchObject({ button_style: 'pill_on_photo', after_add: 'stepper', show_mrp: true });
  });
});

describe('resolveCardLook', () => {
  const none = {};

  it('is theme when the store and the section both say theme', () => {
    const look = resolveCardLook(PRODUCT_CARD_DEFAULTS, 'store', none);
    expect(look.design).toBe('theme');
    expect(resolveCardLook(PRODUCT_CARD_DEFAULTS, undefined, none).design).toBe('theme');
    expect(resolveCardLook(PRODUCT_CARD_DEFAULTS, '', none).design).toBe('theme');
  });

  it('uses the store card when the section says store (or something unknown)', () => {
    const store = sanitizeProductCard({ ...CARD_DESIGNS.royal });
    for (const section of ['store', undefined, 'deleted-design', 'theme', 42 as unknown as string]) {
      const look = resolveCardLook(store, section, none);
      expect(look.design).toBe('royal');
      expect(look.radius).toBe(16);
    }
  });

  it('a section design uses that design, keeping the store\'s out-of-stock choices', () => {
    const store = sanitizeProductCard({ ...CARD_DESIGNS.royal, oos_look: 'faded', oos_place: 'end' });
    const look = resolveCardLook(store, 'soft', none);
    expect(look.design).toBe('soft');
    expect(look.radius).toBe(24);
    expect(look.shadow).toBe('soft');
    expect(look.oos_look).toBe('faded');
    expect(look.oos_place).toBe('end');
  });

  it('a section design wins over a theme store', () => {
    const look = resolveCardLook(PRODUCT_CARD_DEFAULTS, 'minimal', none);
    expect(look.design).toBe('minimal');
    expect(look.name_price_row).toBe(true);
  });

  it('under theme, a false switch turns its line off and a true one changes nothing (today\'s meaning)', () => {
    const hidden = resolveCardLook(PRODUCT_CARD_DEFAULTS, 'store', { rating: false, tagline: false, swatches: false });
    expect(on(hidden, 'rating')).toBe(false);
    expect(on(hidden, 'tagline')).toBe(false);
    expect(on(hidden, 'swatches')).toBe(false);
    expect(on(hidden, 'name')).toBe(true);
    const shown = resolveCardLook(PRODUCT_CARD_DEFAULTS, 'store', { rating: true, tagline: true, swatches: true });
    expect(shown.lines).toEqual(PRODUCT_CARD_DEFAULTS.lines);
  });

  it('under a design, rating false hides the rating whatever the design; rating true leaves it to the design', () => {
    for (const design of CARD_DESIGN_IDS) {
      const store = CARD_DESIGNS[design];
      expect(on(resolveCardLook(store, 'store', { rating: false }), 'rating')).toBe(false);
      expect(on(resolveCardLook(PRODUCT_CARD_DEFAULTS, design, { rating: false }), 'rating')).toBe(false);
      expect(on(resolveCardLook(store, 'store', { rating: true }), 'rating')).toBe(on(store, 'rating'));
    }
    // Royal shows the rating, Classic does not; true never adds it to Classic.
    expect(on(resolveCardLook(CARD_DESIGNS.classic, 'store', { rating: true }), 'rating')).toBe(false);
    expect(on(resolveCardLook(CARD_DESIGNS.royal, 'store', { rating: true }), 'rating')).toBe(true);
  });

  it('under a design, tagline and swatches true show that line; false leaves it to the design', () => {
    for (const design of CARD_DESIGN_IDS) {
      const store = CARD_DESIGNS[design];
      const shown = resolveCardLook(store, 'store', { tagline: true, swatches: true });
      expect(on(shown, 'tagline')).toBe(true);
      expect(on(shown, 'swatches')).toBe(true);
      const left = resolveCardLook(store, 'store', { tagline: false, swatches: false });
      expect(on(left, 'tagline')).toBe(on(store, 'tagline'));
      expect(on(left, 'swatches')).toBe(on(store, 'swatches'));
    }
    // Royal's tagline survives a section whose "Show tagline" is off (the section default).
    expect(on(resolveCardLook(PRODUCT_CARD_DEFAULTS, 'royal', { tagline: false }), 'tagline')).toBe(true);
    expect(on(resolveCardLook(CARD_DESIGNS.classic, 'store', { tagline: true }), 'tagline')).toBe(true);
  });

  it('switches never move a line or touch the other lines', () => {
    for (const design of CARD_DESIGN_IDS) {
      const store = CARD_DESIGNS[design];
      const look = resolveCardLook(store, 'store', { rating: false, tagline: true, swatches: true, badges: false });
      expect(look.lines.map((l) => l.id)).toEqual(store.lines.map((l) => l.id));
      for (const id of ['brand', 'name', 'unit', 'price', 'buttons']) expect(on(look, id)).toBe(on(store, id));
    }
  });

  it('badges false sets show_badges false; otherwise badges show', () => {
    expect(resolveCardLook(PRODUCT_CARD_DEFAULTS, 'store', { badges: false }).show_badges).toBe(false);
    expect(resolveCardLook(PRODUCT_CARD_DEFAULTS, 'store', { badges: true }).show_badges).toBe(true);
    expect(resolveCardLook(PRODUCT_CARD_DEFAULTS, 'store', none).show_badges).toBe(true);
    for (const design of CARD_DESIGN_IDS) {
      expect(resolveCardLook(CARD_DESIGNS[design], 'store', { badges: false }).show_badges).toBe(false);
      expect(resolveCardLook(PRODUCT_CARD_DEFAULTS, design, { badges: true }).show_badges).toBe(true);
    }
  });

  it('does not change the store settings or the design tables', () => {
    const before = JSON.stringify([PRODUCT_CARD_DEFAULTS, CARD_DESIGNS.royal]);
    resolveCardLook(CARD_DESIGNS.royal, 'store', { rating: false });
    resolveCardLook(PRODUCT_CARD_DEFAULTS, 'royal', { rating: false });
    expect(JSON.stringify([PRODUCT_CARD_DEFAULTS, CARD_DESIGNS.royal])).toBe(before);
  });
});

describe('cardLookClasses and cardLookVars', () => {
  it('are empty for theme, whatever else is set', () => {
    const odd = resolveCardLook({ ...PRODUCT_CARD_DEFAULTS, radius: 30, image_shape: 'portrait', oos_look: 'faded' }, 'store', {
      rating: false,
    });
    expect(odd.design).toBe('theme');
    expect(cardLookClasses(odd)).toBe('');
    expect(cardLookVars(odd)).toEqual({});
    const plain = resolveCardLook(PRODUCT_CARD_DEFAULTS, undefined, {});
    expect(cardLookClasses(plain)).toBe('');
    expect(cardLookVars(plain)).toEqual({});
  });

  it('give the classes the spec names for Royal', () => {
    const look = resolveCardLook(PRODUCT_CARD_DEFAULTS, 'royal', {});
    const classes = cardLookClasses(look).split(' ');
    expect(classes).toEqual(expect.arrayContaining(['pc-shape-portrait', 'pc-btn-icon_full', 'pc-badge-ribbon']));
    expect(new Set(classes).size).toBe(classes.length);
    expect(classes.every((c) => /^pc-[a-z0-9_-]+$/.test(c))).toBe(true);
  });

  it('give variables for the box measurements', () => {
    const vars = cardLookVars(resolveCardLook(PRODUCT_CARD_DEFAULTS, 'royal', {}));
    expect(vars['--pc-radius']).toBe('16px');
    expect(vars['--pc-border']).toBe('1px');
    expect(vars['--pc-padding']).toBe(`${CARD_DESIGNS.royal.padding}px`);
    expect(vars['--pc-img-padding']).toBe(`${CARD_DESIGNS.royal.image_padding}px`);
    expect(vars['--pc-img-radius']).toBe(`${CARD_DESIGNS.royal.image_radius}px`);
    expect(vars['--pc-img-bg']).toBeUndefined();
    expect(vars['--pc-bg-image']).toBeUndefined();
    for (const v of Object.values(vars)) expect(typeof v).toBe('string');
  });

  it('carry the photo background and the card background picture when set', () => {
    const store = sanitizeProductCard({ ...CARD_DESIGNS.classic, image_bg: '#f4f4f5', background_image: 'https://cdn.example.com/a.jpg' });
    const look = resolveCardLook(store, 'store', {});
    expect(cardLookVars(look)['--pc-img-bg']).toBe('#f4f4f5');
    expect(cardLookVars(look)['--pc-bg-image']).toBe('url("https://cdn.example.com/a.jpg")');
    expect(cardLookClasses(look)).toContain('pc-imgbg');
    expect(cardLookClasses(look)).toContain('pc-bgimg');
  });

  it('keep a picture link from breaking out of the url()', () => {
    const store = { ...CARD_DESIGNS.classic, background_image: 'https://cdn.example.com/a".jpg);x:y' };
    const v = cardLookVars(resolveCardLook(store, 'store', {}))['--pc-bg-image'];
    expect(v.startsWith('url("')).toBe(true);
    expect(v.endsWith('")')).toBe(true);
    expect(v.slice(5, -2)).not.toMatch(/["\\\n]/);
  });

  it('name the button fill, shape and reveal only when they are not the defaults', () => {
    const classes = (over: Partial<ProductCardSettings>) => cardLookClasses(resolveCardLook({ ...CARD_DESIGNS.classic, ...over }, 'store', {})).split(' ');
    const plain = classes({});
    for (const c of ['pc-btn-outline', 'pc-btn-pill', 'pc-btn-reveal-hover']) expect(plain).not.toContain(c);
    expect(classes({ button_fill: 'outline' })).toContain('pc-btn-outline');
    expect(classes({ button_shape: 'pill' })).toContain('pc-btn-pill');
    expect(classes({ button_reveal: 'hover' })).toContain('pc-btn-reveal-hover');
    expect(cardLookClasses(resolveCardLook(CARD_DESIGNS.soft, 'store', {}))).toContain('pc-btn-pill');
    const theme = resolveCardLook({ ...PRODUCT_CARD_DEFAULTS, button_fill: 'outline', button_shape: 'pill', button_reveal: 'hover' }, 'store', {});
    expect(cardLookClasses(theme)).toBe('');
  });

  it('follow the out-of-stock look and the name-price row', () => {
    const look = resolveCardLook({ ...CARD_DESIGNS.minimal, oos_look: 'faded' }, 'store', {});
    const classes = cardLookClasses(look);
    expect(classes).toContain('pc-oos-faded');
    expect(classes).toContain('pc-row-np');
    expect(cardLookClasses(resolveCardLook(CARD_DESIGNS.classic, 'store', {}))).not.toContain('pc-row-np');
  });
});

describe('nameAndPriceInRow', () => {
  const lines = (...ids: Array<[string, boolean]>) => ids.map(([id, onFlag]) => ({ id, on: onFlag })) as ProductCardSettings['lines'];

  it('is true when the switch is on and both name and price are shown, wherever price sits', () => {
    const base = ['brand', 'name', 'unit', 'rating', 'tagline', 'price', 'swatches', 'buttons'] as const;
    const mk = (flags: Record<string, boolean>, order: readonly string[] = base) =>
      withLines(order.map((id) => ({ id, on: flags[id] ?? false })) as ProductCardSettings['lines'], { name_price_row: true });
    expect(nameAndPriceInRow(mk({ name: true, price: true }))).toBe(true);
    expect(nameAndPriceInRow(mk({ name: true, unit: true, price: true }))).toBe(true);
    expect(nameAndPriceInRow(mk({ name: true, unit: false, rating: false, tagline: false, price: true, buttons: true }))).toBe(true);
    expect(nameAndPriceInRow(mk({ brand: true, name: true, price: true }))).toBe(true);
    expect(nameAndPriceInRow(mk({ name: false, price: true }))).toBe(false);
    expect(nameAndPriceInRow(mk({ name: true, price: false, buttons: true }))).toBe(false);
    expect(nameAndPriceInRow(mk({ name: true, price: true }, ['price', 'name', 'brand', 'unit', 'rating', 'tagline', 'swatches', 'buttons']))).toBe(true);
    expect(nameAndPriceInRow({ ...mk({ name: true, price: true }), name_price_row: false })).toBe(false);
    expect(nameAndPriceInRow(withLines(lines(['name', true], ['price', true]), { name_price_row: true }))).toBe(true);
  });
});

describe('line_list setting type', () => {
  const schema: SettingSchema = {
    id: 'lines',
    type: 'line_list',
    label: 'Lines',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ],
  };

  it('is a permutation of the schema options', () => {
    expect(sanitizeSettingValue(schema, [{ id: 'c', on: true }, { id: 'a', on: false }, { id: 'c', on: false }, { id: 'zz', on: true }])).toEqual([
      { id: 'c', on: true },
      { id: 'a', on: false },
      { id: 'b', on: false },
    ]);
  });

  it('drops a value that is not a list', () => {
    expect(sanitizeSettingValue(schema, 'a')).toBeUndefined();
    expect(sanitizeSettingValue(schema, { id: 'a' })).toBeUndefined();
  });
});

describe('theme data', () => {
  it('a theme without product_card gets the defaults', () => {
    const data = sanitizeThemeData({});
    expect(data.settings.product_card).toEqual(PRODUCT_CARD_DEFAULTS);
  });

  it('sanitises product_card inside the theme settings', () => {
    const data = sanitizeThemeData({ settings: { product_card: { design: 'royal', radius: 999, lines: 'bad', oos_place: 'hide' } } });
    expect(data.settings.product_card.design).toBe('royal');
    expect(data.settings.product_card.radius).toBe(32);
    expect(data.settings.product_card.lines).toEqual(PRODUCT_CARD_DEFAULTS.lines);
    expect(data.settings.product_card.oos_place).toBe('hide');
  });

  it('drops a card colour scheme the theme does not have', () => {
    const data = sanitizeThemeData({ settings: { product_card: { color_scheme: 'scheme-3' } } });
    expect(data.settings.product_card.color_scheme).toBe('scheme-3');
    const gone = sanitizeThemeData({ settings: { product_card: { color_scheme: 'scheme-77' } } });
    expect(gone.settings.product_card.color_scheme).toBe('');
  });
});
