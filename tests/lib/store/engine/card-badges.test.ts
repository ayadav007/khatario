import { cardBadges, tileBadges } from '@/lib/store/engine/card-badges';

describe('cardBadges', () => {
  it('a custom badge replaces every automatic badge, including the discount', () => {
    expect(
      cardBadges({ customBadge: 'Pure Katan Silk', highlight: 'Bestseller', createdAt: new Date().toISOString(), discountPct: 20 }),
    ).toEqual({ badges: [{ label: 'Pure Katan Silk', tone: 'hot' }], hideDiscount: true });
  });

  it('without a custom badge the automatic badges are as before', () => {
    const r = cardBadges({ customBadge: null, highlight: 'Bestseller', createdAt: new Date().toISOString(), discountPct: 20 });
    expect(r).toEqual({
      badges: [
        { label: 'Bestseller', tone: 'hot' },
        { label: 'New', tone: 'new' },
      ],
      hideDiscount: false,
    });
  });

  it('a blank custom badge is ignored and an old item has no New badge', () => {
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    expect(cardBadges({ customBadge: '  ', createdAt: old, discountPct: 0 })).toEqual({ badges: [], hideDiscount: false });
  });
});

describe('tileBadges', () => {
  const hot = [{ label: 'Pure Katan Silk', tone: 'hot' as const }];

  it('puts the % OFF badge first and strikes the MRP when there is a discount', () => {
    expect(tileBadges(20, hot)).toEqual({ badges: [{ label: '20% OFF', tone: 'sale' }, ...hot], struck: true });
  });

  it('hideDiscountBadge drops only the % OFF badge; the MRP stays struck through', () => {
    const r = tileBadges(20, hot, true);
    expect(r.badges).toEqual(hot);
    expect(r.struck).toBe(true);
  });

  it('with no discount there is no % OFF badge and nothing struck', () => {
    expect(tileBadges(0, hot)).toEqual({ badges: hot, struck: false });
  });
});
