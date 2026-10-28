import { pickRule, resolveFromRules, type PriceRule } from '@/lib/pricing/resolve-price';

const rule = (r: Partial<PriceRule>): PriceRule => ({
  price: null,
  discount_percent: null,
  variant_id: null,
  min_qty: 0,
  valid_from: null,
  valid_to: null,
  ...r,
});

describe('pickRule', () => {
  const date = '2026-10-28';

  it('prefers the variant rule, then the biggest slab within qty, then the latest start', () => {
    const rules = [
      rule({ price: 100 }),
      rule({ price: 95, min_qty: 10 }),
      rule({ price: 90, min_qty: 50 }),
      rule({ price: 80, variant_id: 'red' }),
    ];
    expect(pickRule(rules, { qty: 1, date })!.price).toBe(100);
    expect(pickRule(rules, { qty: 10, date })!.price).toBe(95);
    expect(pickRule(rules, { qty: 49, date })!.price).toBe(95);
    expect(pickRule(rules, { qty: 60, date })!.price).toBe(90);
    expect(pickRule(rules, { qty: 60, variantId: 'red', date })!.price).toBe(80);
    expect(pickRule(rules, { qty: 1, variantId: 'blue', date })!.price).toBe(100);
  });

  it('only uses rules valid on the date, and a later start beats an earlier one', () => {
    const rules = [
      rule({ price: 100 }),
      rule({ price: 90, valid_from: '2026-10-01', valid_to: '2026-10-31' }),
      rule({ price: 85, valid_from: '2026-11-01' }),
    ];
    expect(pickRule(rules, { date: '2026-09-30' })!.price).toBe(100);
    expect(pickRule(rules, { date: '2026-10-15' })!.price).toBe(90);
    expect(pickRule(rules, { date: '2026-11-02' })!.price).toBe(85);
    expect(pickRule([rule({ price: 1, valid_to: '2026-01-01' })], { date })).toBeNull();
  });
});

describe('resolveFromRules', () => {
  it('picks customer price, then level, then catalog', () => {
    expect(resolveFromRules({ catalogPrice: 100, partyRule: rule({ price: 90 }), levelRule: rule({ price: 95 }), categoryDiscount: null })).toMatchObject({
      price: 90,
      priceSource: 'party',
    });
    expect(
      resolveFromRules({ catalogPrice: 100, partyRule: null, levelRule: rule({ price: 95 }), levelName: 'Dealer', categoryDiscount: null })
    ).toMatchObject({ price: 95, priceSource: 'level', levelName: 'Dealer' });
    expect(resolveFromRules({ catalogPrice: 100, partyRule: null, levelRule: null, categoryDiscount: null })).toMatchObject({
      price: 100,
      priceSource: 'catalog',
      discountPercent: null,
    });
  });

  it('applies a discount-only customer rule on top of the level or catalog price', () => {
    expect(
      resolveFromRules({ catalogPrice: 100, partyRule: rule({ discount_percent: 5 }), levelRule: rule({ price: 95 }), categoryDiscount: 3 })
    ).toMatchObject({ price: 95, priceSource: 'level', discountPercent: 5, discountSource: 'party' });
  });

  it('uses the category discount before a level discount, and ignores level discount on a customer price', () => {
    expect(
      resolveFromRules({ catalogPrice: 100, partyRule: null, levelRule: rule({ discount_percent: 2 }), categoryDiscount: 7 })
    ).toMatchObject({ price: 100, discountPercent: 7, discountSource: 'category' });
    expect(
      resolveFromRules({ catalogPrice: 100, partyRule: null, levelRule: rule({ discount_percent: 2 }), levelName: 'Retail', categoryDiscount: null })
    ).toMatchObject({ discountPercent: 2, discountSource: 'level', levelName: 'Retail' });
    expect(
      resolveFromRules({ catalogPrice: 100, partyRule: rule({ price: 80 }), levelRule: rule({ discount_percent: 2 }), categoryDiscount: null })
    ).toMatchObject({ price: 80, discountPercent: null });
  });
});
