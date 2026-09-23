import { isPublicMarketingSurface } from '@/lib/auth/public-surfaces';

describe('isPublicMarketingSurface', () => {
  it('treats every path on a store hostname as public', () => {
    expect(
      isPublicMarketingSurface('/account', 'shalinitraders.staging.khatario.com'),
    ).toBe(true);
    expect(
      isPublicMarketingSurface('/checkout', 'shalinitraders.staging.khatario.com'),
    ).toBe(true);
    expect(isPublicMarketingSurface('/cart', 'shop.khatario.com')).toBe(true);
  });

  it('does not treat merchant /account on the app host as a storefront', () => {
    expect(isPublicMarketingSurface('/account', 'staging.khatario.com')).toBe(false);
    expect(isPublicMarketingSurface('/checkout', 'app.khatario.com')).toBe(false);
  });

  it('keeps marketing and rewritten /store paths public', () => {
    expect(isPublicMarketingSurface('/store/cart', 'staging.khatario.com')).toBe(true);
    expect(isPublicMarketingSurface('/signup', 'staging.khatario.com')).toBe(true);
  });
});
