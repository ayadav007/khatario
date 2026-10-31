import { cardBadges } from '@/lib/store/engine/card-badges';

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
