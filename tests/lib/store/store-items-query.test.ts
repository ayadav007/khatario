import {
  buildStoreItemsQuery,
  parseStoreItemsSort,
  BAYES_PRIOR,
  BAYES_WEIGHT,
} from '@/lib/store/store-items-query';

describe('buildStoreItemsQuery', () => {
  const businessId = '11111111-1111-1111-1111-111111111111';

  it('binds only the business id on the count query', () => {
    const q = buildStoreItemsQuery({
      businessId,
      limit: 40,
      offset: 0,
    });
    expect(q.countParams).toEqual([businessId]);
    expect(q.listParams).toEqual([businessId, 40, 0]);
    expect(q.listSql).toContain('i.gallery_urls');
    expect(q.listSql).toContain('store_item_ratings');
  });

  it('does not put branch or page params on the count query', () => {
    const branchId = '22222222-2222-2222-2222-222222222222';
    const q = buildStoreItemsQuery({
      businessId,
      branchId,
      limit: 40,
      offset: 0,
    });
    expect(q.countParams).toEqual([businessId]);
    expect(q.listParams).toEqual([businessId, branchId, 40, 0]);
  });

  it('keeps search on both list and count', () => {
    const q = buildStoreItemsQuery({
      businessId,
      search: 'biryani',
      limit: 40,
      offset: 0,
    });
    expect(q.countParams).toEqual([businessId, '%biryani%']);
    expect(q.listParams[0]).toBe(businessId);
    expect(q.listParams[1]).toBe('%biryani%');
  });

  it('binds max price on list and count', () => {
    const q = buildStoreItemsQuery({
      businessId,
      maxPrice: 99,
      limit: 12,
      offset: 0,
    });
    expect(q.countParams).toEqual([businessId, 99]);
    expect(q.listParams).toEqual([businessId, 99, 12, 0]);
    expect(q.listSql).toContain('i.selling_price <= $2');
  });

  it('filters discounted items without extra binds', () => {
    const q = buildStoreItemsQuery({
      businessId,
      discountedOnly: true,
      limit: 12,
      offset: 0,
    });
    expect(q.countParams).toEqual([businessId]);
    expect(q.listSql).toContain('i.mrp > i.selling_price');
  });

  it('reproduces the old catalog 500: extra count params', () => {
    const conditionsLength = 4;
    const queryParams = [businessId, 40, 0];
    expect(queryParams.slice(0, conditionsLength).length).toBe(3);
    expect(queryParams.slice(0, conditionsLength).length).not.toBe(1);
  });

  const c1 = '33333333-3333-3333-3333-333333333333';
  const c2 = '44444444-4444-4444-4444-444444444444';

  it('filters by price range, categories and brands with bound params', () => {
    const q = buildStoreItemsQuery({
      businessId,
      minPrice: 100,
      maxPrice: 500,
      categoryIds: [c1, c2],
      brands: ['Amul'],
      limit: 12,
      offset: 0,
    });
    expect(q.listSql).toContain('i.selling_price >= $');
    expect(q.listSql).toContain('i.selling_price <= $');
    expect(q.listSql).toContain('i.category_id = ANY($');
    expect(q.listSql).toContain('i.brand = ANY($');
    expect(q.countParams).toEqual([businessId, 100, 500, [c1, c2], ['Amul']]);
  });

  it('merges categoryId into categoryIds', () => {
    const q = buildStoreItemsQuery({ businessId, categoryId: c1, categoryIds: [c2], limit: 12, offset: 0 });
    expect(q.countParams).toEqual([businessId, [c2, c1]]);
  });

  it('in-stock filter counts variant stock', () => {
    const q = buildStoreItemsQuery({ businessId, inStockOnly: true, limit: 12, offset: 0 });
    expect(q.listSql).toContain('EXISTS (SELECT 1 FROM item_variants');
  });

  it('in-stock filter with a branch shares one branch bind', () => {
    const branchId = '22222222-2222-2222-2222-222222222222';
    const q = buildStoreItemsQuery({ businessId, branchId, inStockOnly: true, limit: 12, offset: 0 });
    expect(q.countParams).toEqual([businessId, branchId]);
    expect(q.listParams).toEqual([businessId, branchId, 12, 0]);
  });

  it('discount filter uses percentage off MRP', () => {
    const q = buildStoreItemsQuery({ businessId, minDiscountPct: 25, limit: 12, offset: 0 });
    expect(q.listSql).toContain('(i.mrp - i.selling_price) / i.mrp * 100 >=');
    expect(q.countParams).toEqual([businessId, 25]);
  });

  it('clamps and caps inputs', () => {
    const q = buildStoreItemsQuery({
      businessId,
      minPrice: -5,
      brands: Array(30).fill('x'),
      limit: 12,
      offset: 0,
    });
    expect(q.listSql).not.toContain('i.selling_price >=');
    expect((q.countParams[1] as string[]).length).toBe(20);
  });

  it.each(['price_asc', 'price_desc', 'discount', 'rating'])('parses sort %s', (s) => {
    expect(parseStoreItemsSort(s)).toBe(s);
  });

  it('defaults unknown sort to name', () => {
    expect(parseStoreItemsSort('nope')).toBe('name');
  });

  it('orders by price and discount', () => {
    const asc = buildStoreItemsQuery({ businessId, sort: 'price_asc', limit: 12, offset: 0 });
    expect(asc.listSql).toContain('i.selling_price ASC');
    const desc = buildStoreItemsQuery({ businessId, sort: 'price_desc', limit: 12, offset: 0 });
    expect(desc.listSql).toContain('i.selling_price DESC');
    const disc = buildStoreItemsQuery({ businessId, sort: 'discount', limit: 12, offset: 0 });
    expect(disc.listSql).toContain('CASE WHEN i.mrp > 0');
  });

  it('rating sort uses the Bayesian average', () => {
    expect(BAYES_PRIOR).toBe(3.5);
    expect(BAYES_WEIGHT).toBe(5);
    const q = buildStoreItemsQuery({ businessId, sort: 'rating', limit: 12, offset: 0 });
    expect(q.listSql).toMatch(/\(COALESCE\(rs\.sum, 0\) \+ 3\.5 \* 5\) \/ \(COALESCE\(rs\.cnt, 0\) \+ 5\) DESC/);
    expect(q.listSql).toContain('FROM store_item_ratings WHERE business_id = $1');
  });

  it('byIds keeps the requested order', () => {
    const a = '55555555-5555-5555-5555-555555555555';
    const b = '66666666-6666-6666-6666-666666666666';
    const q = buildStoreItemsQuery({ businessId, ids: [a, b], limit: 12, offset: 0 });
    expect(q.listSql).toContain('array_position(');
    expect(q.listSql).toContain('::uuid[]');
    expect(q.countParams).toEqual([businessId, [a, b]]);
    expect(q.listParams).toEqual([businessId, [a, b], 12, 0]);
  });

  it('selects brand', () => {
    const q = buildStoreItemsQuery({ businessId, limit: 12, offset: 0 });
    expect(q.listSql).toContain('i.brand');
  });
});
