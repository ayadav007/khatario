import { isPreviewPath, previewPath } from '@/lib/store/engine/preview-path';

const ID = '4b49ddef-59bc-4ec3-94c0-65f615ce32a3';

describe('previewPath', () => {
  it('maps template keys to storefront paths', () => {
    expect(previewPath('home')).toBe('/');
    expect(previewPath('catalog')).toBe('/catalog');
    expect(previewPath('product')).toBeNull();
    expect(previewPath('product', { productId: 'x' })).toBeNull();
    expect(previewPath('product', { productId: ID })).toBe(`/products/${ID}`);
    expect(previewPath('page.sale')).toBe('/pages/sale');
    expect(previewPath('page.cart')).toBeNull();
    expect(previewPath('other')).toBeNull();
  });
});

describe('isPreviewPath', () => {
  it('accepts the exact shapes', () => {
    for (const p of ['/', '/catalog', `/catalog/${ID}`, `/products/${ID}`, '/pages/sale', '/pages/about-us']) {
      expect(isPreviewPath(p)).toBe(true);
    }
  });
  it('rejects everything else', () => {
    const bad = [
      '//evil.com', '/products/x', '/pages/Cart', '/pages/cart', '/catalog/../api', '/catalog?x=1', '/#a',
      `/products/${ID}/`, `/products/${ID.toUpperCase()}`, 'https://evil.com', '', '/pages/..', '/pages//x',
    ];
    for (const p of bad) expect(isPreviewPath(p)).toBe(false);
  });
});
