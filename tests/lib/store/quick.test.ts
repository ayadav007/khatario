import { cartSavings, couponLabel, couponOutlook, freeDeliveryProgress } from '@/lib/store/quick';
import { applyStorePreset, sanitizeStoreTheme, storePackClass, usesStudioSections } from '@/lib/store/store-theme';
import { resolveStudioSections, toQuickLayout, type StudioContext } from '@/lib/store/studio-layout';
import { sanitizeStudioSections } from '@/lib/store/studio-sections';
import { filterDemoCatalog, themeDemoStore } from '@/lib/store/theme-demo';

const ctx: StudioContext = {
  businessName: 'Quick Mart',
  tagline: 'Groceries fast',
  heroUrl: '',
  categories: [{ id: 'c1', name: 'Fruits' }],
  autoAnnouncement: '',
};

describe('Quick pack', () => {
  it('is a real pack that keeps Studio sections and scope', () => {
    const t = sanitizeStoreTheme({ preset: 'quick' });
    expect(t.pack).toBe('quick');
    expect(usesStudioSections(t)).toBe(true);
    expect(storePackClass(t)).toBe('store-studio store-quick');
    expect(sanitizeStoreTheme({ preset: 'custom', pack: 'quick' }).pack).toBe('quick');
    expect(applyStorePreset('quick').mobile_columns).toBe(3);
  });

  it('starts with an app-style home: rails for bestsellers and deals, then the catalog', () => {
    const sections = resolveStudioSections(sanitizeStoreTheme({ preset: 'quick' }), ctx);
    expect(sections.map((s) => s.type)).toEqual([
      'announcement', 'header', 'hero', 'categories', 'products', 'products', 'usp', 'banner', 'testimonials', 'products', 'footer',
    ]);
    const rails = sections.filter((s) => s.type === 'products');
    expect(rails.map((s) => s.settings.source ?? 'all')).toEqual(['bestsellers', 'discounted', 'all']);
    expect(sanitizeStudioSections(sections)).toHaveLength(sections.length);
  });

  it('rearranges an existing Studio layout into Quick, keeping the merchant content', () => {
    const studio = resolveStudioSections(sanitizeStoreTheme({ preset: 'studio' }), ctx);
    studio.find((s) => s.type === 'hero')!.settings.heading = 'Diwali specials';
    const quick = toQuickLayout(studio);
    const hero = quick.find((s) => s.type === 'hero')!;
    expect(hero.settings).toMatchObject({ heading: 'Diwali specials', layout: 'full', height: 'small' });
    expect(quick.find((s) => s.type === 'categories')!.settings.columns).toBe(8);
    const products = quick.filter((s) => s.type === 'products').map((s) => s.settings.source ?? 'all');
    expect(products).toEqual(['bestsellers', 'discounted', 'all']);
    expect(quick[quick.length - 2].type).toBe('products');
    expect(quick[quick.length - 1].type).toBe('footer');
    // Running it again changes nothing and never duplicates rows or badges.
    expect(toQuickLayout(quick).map((s) => s.id)).toEqual(quick.map((s) => s.id));
  });

  it('does not add rails when the store already has product rows', () => {
    const studio = resolveStudioSections(sanitizeStoreTheme({ preset: 'studio' }), ctx);
    // Added above the footer, where Studio's Add Section puts it.
    const withRow = [
      ...studio.slice(0, -1),
      { id: 'mine', type: 'products' as const, name: 'Mine', enabled: true, settings: { source: 'new' as const } },
      studio[studio.length - 1],
    ];
    const out = toQuickLayout(withRow);
    expect(out.filter((s) => s.type === 'products').map((s) => s.id)).toEqual(['mine', 'products']);
    // The existing row moves up under the categories.
    expect(out.findIndex((s) => s.id === 'mine')).toBe(out.findIndex((s) => s.type === 'categories') + 1);
  });

  it('keeps a saved layout instead of the starting one', () => {
    const theme = sanitizeStoreTheme({ preset: 'quick', studio_sections: [{ id: 'hero', type: 'hero', settings: {} }] });
    expect(resolveStudioSections(theme, ctx)).toHaveLength(1);
  });

  it('keeps the delivery time on the header, clipped', () => {
    const [h] = sanitizeStudioSections([{ id: 'header', type: 'header', settings: { deliveryEta: 'x'.repeat(80) } }]);
    expect(h.settings.deliveryEta).toHaveLength(40);
  });

  it('has a demo store on the grocery catalog', () => {
    const demo = themeDemoStore('theme-quick');
    expect(demo?.store_theme && sanitizeStoreTheme(demo.store_theme).pack).toBe('quick');
    expect(filterDemoCatalog({ pack: 'quick', page: 1, limit: 3 }).items[0].id).toMatch(/^grocery-/);
  });
});

describe('freeDeliveryProgress', () => {
  it('counts down to the threshold', () => {
    expect(freeDeliveryProgress(300, 499)).toEqual({ remaining: 199, ratio: 300 / 499 });
    expect(freeDeliveryProgress(520, 499)).toEqual({ remaining: 0, ratio: 1 });
  });
  it('promises nothing without a single threshold', () => {
    expect(freeDeliveryProgress(300, null)).toBeNull();
    expect(freeDeliveryProgress(300, 0)).toBeNull();
  });
});

describe('cartSavings', () => {
  it('adds MRP savings and ignores lines without one', () => {
    expect(
      cartSavings([
        { price: 40, mrp: 50, quantity: 2 },
        { price: 99, quantity: 1 },
        { price: 60, mrp: 55, quantity: 1 },
      ]),
    ).toBe(20);
  });
});

describe('couponOutlook', () => {
  const coupons = [
    { code: 'FLAT50', discount_type: 'flat' as const, discount_value: 50, min_order_amount: 499 },
    { code: 'TEN', discount_type: 'percent' as const, discount_value: 10, min_order_amount: 0 },
    { code: 'BIG', discount_type: 'flat' as const, discount_value: 100, min_order_amount: 999 },
  ];

  it('ranks usable coupons by saving, then the nearest to unlock', () => {
    const out = couponOutlook(600, coupons);
    expect(out.map((o) => [o.coupon.code, o.saving, o.shortBy])).toEqual([
      ['TEN', 60, 0],
      ['FLAT50', 50, 0],
      ['BIG', 0, 399],
    ]);
  });

  it('never saves more than the cart', () => {
    expect(couponOutlook(30, [{ code: 'X', discount_type: 'flat', discount_value: 50, min_order_amount: 0 }])[0].saving).toBe(30);
  });

  it('labels coupons', () => {
    expect(couponLabel(coupons[0])).toBe('₹50 off');
    expect(couponLabel(coupons[1])).toBe('10% off');
  });
});
