import {
  cardBadgeList,
  cardBadgeRow,
  cardDiscount,
  cardOutOfStock,
  cardRating,
  cardUnits,
  designedCardRoot,
  isDesignedCard,
} from '@/lib/store/engine/card-render';
import { DEFAULT_COLOR_SCHEMES, cardSchemeVars, schemeCssVars } from '@/lib/store/engine/color-schemes';
import { CARD_DESIGNS, PRODUCT_CARD_DEFAULTS, cardLookClasses, cardLookVars, resolveCardLook, type ResolvedCardLook } from '@/lib/store/engine/product-card';

const look = (over: Partial<ResolvedCardLook> = {}): ResolvedCardLook => ({
  ...resolveCardLook(CARD_DESIGNS.classic, undefined, {}),
  ...over,
});

describe('isDesignedCard', () => {
  it('is false off the engine and for Theme\'s own, true for any design', () => {
    expect(isDesignedCard(undefined)).toBe(false);
    expect(isDesignedCard(null)).toBe(false);
    expect(isDesignedCard(resolveCardLook(PRODUCT_CARD_DEFAULTS, undefined, {}))).toBe(false);
    expect(isDesignedCard(resolveCardLook(PRODUCT_CARD_DEFAULTS, 'royal', {}))).toBe(true);
  });
});

describe('cardUnits', () => {
  it('lists only the lines that are on, in their order', () => {
    expect(cardUnits(look())).toEqual(['name', 'unit', 'price', 'buttons']);
    expect(cardUnits(CARD_DESIGNS.royal as ResolvedCardLook)).toEqual(['tagline', 'name', 'rating', 'price', 'buttons']);
  });

  it('joins name and price into one unit when they share a row', () => {
    expect(cardUnits(CARD_DESIGNS.minimal as ResolvedCardLook)).toEqual(['name-price', 'buttons']);
  });

  it('keeps them apart when price does not follow name', () => {
    const lines = [
      { id: 'name' as const, on: true },
      { id: 'unit' as const, on: true },
      { id: 'price' as const, on: true },
    ];
    expect(cardUnits(look({ name_price_row: true, lines }))).toEqual(['name', 'unit', 'price']);
  });
});

describe('cardDiscount', () => {
  it('is nothing without a discount or with style none', () => {
    expect(cardDiscount('text', 100, 100, 0)).toBeNull();
    expect(cardDiscount('none', 80, 100, 20)).toBeNull();
  });

  it('gives the percent for text and pill, the amount saved for save', () => {
    expect(cardDiscount('text', 80, 100, 20)).toEqual({ kind: 'percent', percent: 20 });
    expect(cardDiscount('pill', 80, 100, 20)).toEqual({ kind: 'percent', percent: 20 });
    expect(cardDiscount('save', 80, 100, 20)).toEqual({ kind: 'save', amount: 20 });
  });

  it('save needs an MRP above the price', () => {
    expect(cardDiscount('save', 80, null, 20)).toBeNull();
    expect(cardDiscount('save', 100, 100, 20)).toBeNull();
  });
});

describe('cardRating', () => {
  it('is absent without ratings', () => {
    expect(cardRating('stars', 0, 3)).toBeNull();
    expect(cardRating('stars', 4.5, 0)).toBeNull();
  });

  it('stars draws stars only, number the figure, count stars with the review count', () => {
    expect(cardRating('stars', 4.5, 12)).toMatchObject({ stars: true, number: null, count: null });
    expect(cardRating('number', 4.46, 12)).toMatchObject({ stars: false, number: '4.5', count: null });
    expect(cardRating('count', 4.5, 12)).toMatchObject({ stars: true, number: null, count: 12 });
  });

  it('gives the fill percent and a spoken label', () => {
    const r = cardRating('stars', 4, 1)!;
    expect(r.percent).toBe(80);
    expect(r.label).toBe('Rated 4 out of 5, 1 review');
    expect(cardRating('count', 4.5, 12)!.label).toBe('Rated 4.5 out of 5, 12 reviews');
    expect(cardRating('stars', 4.46, 7)!.label).toBe('Rated 4.5 out of 5, 7 reviews');
  });
});

describe('cardBadgeRow', () => {
  const extra = [{ label: 'New', tone: 'new' as const }];
  const row = (over: Partial<ResolvedCardLook>, input: Partial<Parameters<typeof cardBadgeRow>[1]> = {}) =>
    cardBadgeRow(look(over), { off: 20, badges: extra, hideDiscountBadge: false, discount: null, ...input });

  it('keeps the "% OFF" badge when the price line shows no discount', () => {
    expect(row({ discount_style: 'none' }).badges.map((b) => b.label)).toEqual(['20% OFF', 'New']);
  });

  it('drops the "% OFF" badge when the price line shows the discount, keeping the MRP strike', () => {
    const pct = row({}, { discount: { kind: 'percent', percent: 20 } });
    expect(pct.badges.map((b) => b.label)).toEqual(['New']);
    expect(pct.struck).toBe(true);
    const save = row({}, { discount: { kind: 'save', amount: 20 } });
    expect(save.badges.map((b) => b.label)).toEqual(['New']);
  });

  it('keys on the shown discount, not the style: save without an MRP keeps the badge', () => {
    const discount = cardDiscount('save', 80, null, 20);
    expect(discount).toBeNull();
    expect(row({ discount_style: 'save' }, { discount }).badges.map((b) => b.label)).toEqual(['20% OFF', 'New']);
  });

  it('a product\'s own badge still replaces the discount badge, and the shape limit still applies', () => {
    const own = [{ label: 'Handmade', tone: 'hot' as const }];
    expect(row({}, { badges: own, hideDiscountBadge: true }).badges).toEqual(own);
    expect(row({ badge_shape: 'ribbon', discount_style: 'none' }).badges.map((b) => b.label)).toEqual(['20% OFF']);
    expect(row({ show_badges: false }).badges).toEqual([]);
  });
});

describe('cardBadgeList', () => {
  const two = [
    { label: '20% OFF', tone: 'sale' as const },
    { label: 'New', tone: 'new' as const },
  ];

  it('shows two pill badges, one ribbon or corner badge', () => {
    expect(cardBadgeList(look({ badge_shape: 'pill' }), two)).toEqual(two);
    expect(cardBadgeList(look({ badge_shape: 'ribbon' }), two)).toEqual([two[0]]);
    expect(cardBadgeList(look({ badge_shape: 'corner' }), two)).toEqual([two[0]]);
  });

  it('shows none when the section turned badges off', () => {
    expect(cardBadgeList(look({ show_badges: false }), two)).toEqual([]);
  });
});

describe('cardOutOfStock', () => {
  it('changes nothing for a product in stock', () => {
    for (const oos_look of ['label', 'faded', 'soldout_button'] as const) {
      expect(cardOutOfStock(look({ oos_look }), false, true)).toEqual({ label: false, button: 'normal' });
    }
  });

  it('label keeps today\'s photo label and button; faded drops the button; soldout_button swaps it', () => {
    expect(cardOutOfStock(look({ oos_look: 'label' }), true, true)).toEqual({ label: true, button: 'normal' });
    expect(cardOutOfStock(look({ oos_look: 'faded' }), true, true)).toEqual({ label: false, button: 'none' });
    expect(cardOutOfStock(look({ oos_look: 'soldout_button' }), true, true)).toEqual({ label: false, button: 'soldout' });
  });

  it('soldout_button falls back to the label when the card has no button', () => {
    const label = { label: true, button: 'normal' };
    expect(cardOutOfStock(look({ oos_look: 'soldout_button' }), true, false)).toEqual(label);
    expect(cardOutOfStock(look({ oos_look: 'soldout_button', button_style: 'none' }), true, true)).toEqual(label);
    const noButtons = CARD_DESIGNS.boutique.lines;
    expect(cardOutOfStock(look({ oos_look: 'soldout_button', button_style: 'full', lines: noButtons }), true, true)).toEqual(label);
  });
});

describe('designedCardRoot', () => {
  it('carries pc-on, the look classes and the variables', () => {
    const l = look();
    const root = designedCardRoot(l, DEFAULT_COLOR_SCHEMES, { outOfStock: false, hasAlt: false });
    expect(root.className.split(' ').slice(0, 2)).toEqual(['product', 'pc-on']);
    expect(root.className).toContain(cardLookClasses(l));
    expect(root.style).toEqual(cardLookVars(l));
  });

  it('marks a boxed card (border, shadow or own scheme) apart from a plain one', () => {
    const cls = (over: Partial<ResolvedCardLook>) => designedCardRoot(look(over), [], { outOfStock: false, hasAlt: false }).className.split(' ');
    expect(cls({ border: 1, shadow: 'none' })).toContain('pc-box');
    expect(cls({ border: 0, shadow: 'soft' })).toContain('pc-box');
    expect(cls({ border: 0, shadow: 'none', color_scheme: 'scheme-3' })).toContain('pc-box');
    expect(cls({ border: 0, shadow: 'none' })).toContain('pc-plain');
  });

  it('adds hasAlt and pc-out when they apply', () => {
    const c = designedCardRoot(look(), [], { outOfStock: true, hasAlt: true }).className.split(' ');
    expect(c).toContain('hasAlt');
    expect(c).toContain('pc-out');
  });

  it('puts the card scheme variables on the root; an unknown scheme gives none', () => {
    const dark = designedCardRoot(look({ color_scheme: 'scheme-3' }), DEFAULT_COLOR_SCHEMES, { outOfStock: false, hasAlt: false });
    expect(dark.style['--c-card']).toBe(DEFAULT_COLOR_SCHEMES[2].card);
    expect(dark.style['--st-card']).toBe(DEFAULT_COLOR_SCHEMES[2].card);
    const gone = designedCardRoot(look({ color_scheme: 'scheme-9' }), DEFAULT_COLOR_SCHEMES, { outOfStock: false, hasAlt: false });
    expect(Object.keys(gone.style).some((k) => k.startsWith('--c-') || k === '--st-card')).toBe(false);
  });
});

describe('cardSchemeVars', () => {
  it('paints like a chosen section scheme: Studio names plus the --c-* names', () => {
    const s = DEFAULT_COLOR_SCHEMES[2];
    const v = cardSchemeVars('scheme-3', DEFAULT_COLOR_SCHEMES);
    expect(v).toMatchObject(schemeCssVars(s, false));
    expect(v).toMatchObject({ '--text': s.text, '--st-card': s.card, '--primary': s.accent, '--paper': s.background });
    expect(v['--on-primary']).toBeTruthy();
  });

  it('is empty for no scheme or one the theme does not have', () => {
    expect(cardSchemeVars('', DEFAULT_COLOR_SCHEMES)).toEqual({});
    expect(cardSchemeVars('scheme-9', DEFAULT_COLOR_SCHEMES)).toEqual({});
  });
});

describe('client safety', () => {
  it('card-render and color-schemes load with sanitize-html and pg throwing', () => {
    jest.isolateModules(() => {
      for (const m of ['sanitize-html', 'pg']) {
        jest.doMock(m, () => {
          throw new Error('server-only');
        });
      }
      expect(typeof require('@/lib/store/engine/card-render').designedCardRoot).toBe('function');
      expect(typeof require('@/lib/store/engine/color-schemes').cardSchemeVars).toBe('function');
    });
  });
});
