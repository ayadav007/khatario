import { assertQueryBinds } from '@/lib/store/store-items-query';
import { buildStoreFacetsQuery, shapeFacets, type StoreFacetRows } from '@/lib/store/store-facets-query';

const base = { businessId: 'b1', limit: 20, offset: 0 };

describe('buildStoreFacetsQuery', () => {
  it('each facet ignores its own filter', () => {
    const f = buildStoreFacetsQuery({
      ...base,
      brands: ['Amul'],
      categoryIds: ['c1'],
      minPrice: 10,
      maxPrice: 99,
      minDiscountPct: 10,
      inStockOnly: true,
    });
    expect(f.brands.sql).not.toContain('i.brand = ANY');
    expect(f.categories.sql).toContain('i.brand = ANY');
    expect(f.categories.sql).not.toContain('i.category_id = ANY');
    expect(f.brands.sql).toContain('i.category_id = ANY');
    expect(f.price.sql).not.toContain('i.selling_price >=');
    expect(f.categories.sql).toContain('i.selling_price >=');
    expect(buildStoreFacetsQuery({ ...base, minDiscountPct: 25 }).discount.params).toEqual(['b1']);
    expect(buildStoreFacetsQuery({ ...base, minDiscountPct: 25 }).brands.params).toEqual(['b1', 25]);
    expect(f.brands.sql).toContain('(i.mrp - i.selling_price)');
  });

  it('keeps visibility rules and valid binds in every facet', () => {
    const f = buildStoreFacetsQuery({ ...base, brands: ['Amul'], inStockOnly: true, branchId: 'br1' });
    for (const q of Object.values(f)) {
      expect(q.sql).toContain('i.show_in_store = true');
      expect(q.sql).toContain('i.deleted_at IS NULL');
      expect(q.params[0]).toBe('b1');
      expect(() => assertQueryBinds(q.sql, q.params)).not.toThrow();
    }
  });

  it('in-stock facet counts stock even when the stock filter is off, using the branch', () => {
    const f = buildStoreFacetsQuery({ ...base, branchId: 'br1' });
    expect(f.inStock.params).toContain('br1');
    expect(f.inStock.sql).toContain('branch_item_stock');
    assertQueryBinds(f.inStock.sql, f.inStock.params);
  });
});

describe('shapeFacets', () => {
  const rows = (brands: StoreFacetRows['brands'], discount = [{ d10: 2, d25: 1, d50: 0 }]): StoreFacetRows => ({
    price: [{ min: '5', max: '120.5' }],
    categories: [{ id: 'c', name: 'Dairy', count: 4 }],
    brands,
    discount,
    inStock: [{ count: '7' }],
  });

  it('hides the brand facet with one brand', () => {
    expect(shapeFacets(rows([{ name: 'Amul', count: 3 }])).brands).toEqual([]);
    expect(
      shapeFacets(rows([{ name: 'Amul', count: 3 }, { name: 'Nestle', count: 1 }])).brands,
    ).toHaveLength(2);
  });

  it('shapes buckets, price and stock; hides discount when all zero', () => {
    const s = shapeFacets(rows([]));
    expect(s.price).toEqual({ min: 5, max: 120.5 });
    expect(s.inStock).toBe(7);
    expect(s.discount).toEqual([
      { pct: 10, count: 2 },
      { pct: 25, count: 1 },
      { pct: 50, count: 0 },
    ]);
    expect(shapeFacets(rows([], [{ d10: 0, d25: 0, d50: 0 }])).discount).toEqual([]);
  });

  it('handles empty result sets', () => {
    const s = shapeFacets({ price: [], categories: [], brands: [], discount: [], inStock: [] });
    expect(s).toEqual({ price: { min: 0, max: 0 }, categories: [], brands: [], discount: [], inStock: 0 });
  });
});
