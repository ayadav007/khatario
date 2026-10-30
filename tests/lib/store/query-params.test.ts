import { parseCatalogQuery } from '@/lib/store/query-params';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('parseCatalogQuery', () => {
  it('drops invalid values and keeps the valid ones', () => {
    const out = parseCatalogQuery(
      new URLSearchParams('cat=a,b&brand=Amul&min=100&max=x&stock=1&disc=33&ids=not-a-uuid'),
    );
    expect(out).toEqual({ brands: ['Amul'], minPrice: 100, inStockOnly: true });
  });

  it('keeps valid uuids in order for cat and ids', () => {
    const out = parseCatalogQuery(
      new URLSearchParams(`cat=${U2},${U1}&ids=${U1},${U2}&disc=25&max=500&sort=price_desc&q=%20atta%20`),
    );
    expect(out).toEqual({
      categoryIds: [U2, U1],
      ids: [U1, U2],
      minDiscountPct: 25,
      maxPrice: 500,
      sort: 'price_desc',
      search: 'atta',
    });
  });
});
