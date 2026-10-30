import { EMPTY_FACETS, migrateLandingParams, removeFilterChip, withSelectedFacets } from '@/components/store/features/catalog/catalog-mount';
import { EMPTY_CATALOG_FILTERS, type CatalogFilterValue } from '@/components/store/features/catalog/catalog-filters';

const CAT = '11111111-1111-4111-8111-111111111111';

describe('migrateLandingParams', () => {
  it('returns null when there is no old landing param', () => {
    expect(migrateLandingParams(new URLSearchParams('cat=x&nav=Offers'))).toBeNull();
  });

  it('maps ?category= to cat and keeps other params', () => {
    const out = migrateLandingParams(new URLSearchParams(`category=${CAT}&td=abc&nav=Home`));
    expect(out?.get('cat')).toBe(CAT);
    expect(out?.has('category')).toBe(false);
    expect(out?.get('td')).toBe('abc');
    expect(out?.get('nav')).toBe('Home');
  });

  it('maps ?offers=1 to disc=10', () => {
    const out = migrateLandingParams(new URLSearchParams('offers=1'));
    expect(out?.get('disc')).toBe('10');
    expect(out?.has('offers')).toBe(false);
  });

  it('drops offers other than 1 without adding a discount', () => {
    const out = migrateLandingParams(new URLSearchParams('offers=0'));
    expect(out?.toString()).toBe('');
  });

  it('does not override filters already in the URL', () => {
    const out = migrateLandingParams(new URLSearchParams(`category=${CAT}&cat=other&offers=1&disc=50`));
    expect(out?.get('cat')).toBe('other');
    expect(out?.get('disc')).toBe('50');
  });
});

describe('removeFilterChip', () => {
  const value: CatalogFilterValue = {
    ...EMPTY_CATALOG_FILTERS,
    categoryIds: ['a', 'b'],
    brands: ['Amul', 'Tata'],
    min: 10,
    max: 100,
    inStock: true,
    disc: 25,
  };

  it('removes one category or brand', () => {
    expect(removeFilterChip(value, 'cat', 'a')).toEqual({ categoryIds: ['b'] });
    expect(removeFilterChip(value, 'brand', 'Tata')).toEqual({ brands: ['Amul'] });
  });

  it('clears price, stock and discount', () => {
    expect(removeFilterChip(value, 'price')).toEqual({ min: null, max: null });
    expect(removeFilterChip(value, 'stock')).toEqual({ inStock: false });
    expect(removeFilterChip(value, 'disc')).toEqual({ disc: null });
  });
});

describe('withSelectedFacets', () => {
  const facets = {
    ...EMPTY_FACETS,
    price: { min: 5, max: 500 },
    categories: [{ id: 'snacks', name: 'Snacks', count: 3 }],
    brands: [{ name: 'Amul', count: 2 }],
  };
  const storeCategories = [
    { id: 'snacks', name: 'Snacks' },
    { id: 'dairy', name: 'QA Dairy' },
  ];

  it('returns the facets unchanged when every selection is listed', () => {
    const out = withSelectedFacets(facets, { categoryIds: ['snacks'], brands: ['Amul'] }, storeCategories);
    expect(out).toBe(facets);
  });

  it('adds a selected category missing from the facets, named from the store list, with count 0', () => {
    const out = withSelectedFacets(facets, { categoryIds: ['dairy'], brands: [] }, storeCategories);
    expect(out.categories).toEqual([
      { id: 'snacks', name: 'Snacks', count: 3 },
      { id: 'dairy', name: 'QA Dairy', count: 0 },
    ]);
    expect(out.price).toEqual(facets.price);
  });

  it('adds a selected brand missing from the facets with count 0', () => {
    const out = withSelectedFacets(facets, { categoryIds: [], brands: ['Tata'] }, storeCategories);
    expect(out.brands).toEqual([
      { name: 'Amul', count: 2 },
      { name: 'Tata', count: 0 },
    ]);
  });

  it('works before facets load and falls back to "Category" for an unknown id', () => {
    const out = withSelectedFacets(null, { categoryIds: ['gone'], brands: [] }, storeCategories);
    expect(out.categories).toEqual([{ id: 'gone', name: 'Category', count: 0 }]);
    expect(withSelectedFacets(null, { categoryIds: [], brands: [] }, [])).toBe(EMPTY_FACETS);
  });
});
