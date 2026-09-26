import { canEnableStoreFeatured, featuredLimitMessage, MAX_STORE_FEATURED_ITEMS } from '@/lib/store/store-featured';

describe('store featured cap', () => {
  it('allows enabling when under the limit', () => {
    expect(
      canEnableStoreFeatured({ alreadyFeatured: false, currentFeaturedCount: 5 }),
    ).toBe(true);
  });

  it('blocks a seventh featured item', () => {
    expect(
      canEnableStoreFeatured({ alreadyFeatured: false, currentFeaturedCount: MAX_STORE_FEATURED_ITEMS }),
    ).toBe(false);
    expect(featuredLimitMessage()).toMatch(/6 items/);
  });

  it('allows turning an already-featured item off or leaving it on', () => {
    expect(
      canEnableStoreFeatured({ alreadyFeatured: true, currentFeaturedCount: MAX_STORE_FEATURED_ITEMS }),
    ).toBe(true);
  });
});
