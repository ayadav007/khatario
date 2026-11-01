import {
  parseCatalogFilters,
  serializeCatalogFilters,
  activeFilterCount,
  clearCatalogFilters,
  toApiParams,
  type CatalogFilterValue,
} from '@/components/store/features/catalog/catalog-filters';
import { parseCatalogQuery } from '@/lib/store/query-params';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

const EMPTY: CatalogFilterValue = {
  categoryIds: [],
  brands: [],
  min: null,
  max: null,
  inStock: false,
  disc: null,
  sort: 'name',
  q: '',
};

const FULL: CatalogFilterValue = {
  categoryIds: [C1, C2],
  brands: ['Acme', 'Foo Bar'],
  min: 100,
  max: 500,
  inStock: true,
  disc: 25,
  sort: 'price_asc',
  q: 'red shirt',
};

describe('catalog filters', () => {
  it('parses an empty query to defaults', () => {
    expect(parseCatalogFilters(new URLSearchParams())).toEqual(EMPTY);
  });

  it('round trips parse -> serialize', () => {
    const sp = serializeCatalogFilters(FULL, new URLSearchParams());
    expect(parseCatalogFilters(sp)).toEqual(FULL);
    const again = serializeCatalogFilters(parseCatalogFilters(sp), new URLSearchParams());
    expect(again.toString()).toBe(sp.toString());
  });

  it('drops non-uuid categories and invalid discount', () => {
    const v = parseCatalogFilters(new URLSearchParams(`cat=nope,${C1}&disc=33`));
    expect(v.categoryIds).toEqual([C1]);
    expect(v.disc).toBeNull();
  });

  it('keeps the studio draft and unknown params', () => {
    const base = new URLSearchParams('draft=abc&utm=x');
    const sp = serializeCatalogFilters({ ...EMPTY, brands: ['Acme'] }, base);
    expect(sp.get('draft')).toBe('abc');
    expect(sp.get('utm')).toBe('x');
    expect(sp.get('brand')).toBe('Acme');
    expect(base.get('brand')).toBeNull(); // base not mutated
  });

  it('clearing all leaves only unknown params', () => {
    const base = serializeCatalogFilters(FULL, new URLSearchParams('draft=abc&utm=x'));
    const sp = serializeCatalogFilters(EMPTY, base);
    expect(Array.from(sp.keys()).sort()).toEqual(['draft', 'utm']);
  });

  it('does not write the default sort', () => {
    const sp = serializeCatalogFilters({ ...EMPTY, sort: 'name', inStock: true }, new URLSearchParams('sort=new'));
    expect(sp.has('sort')).toBe(false);
    expect(sp.get('stock')).toBe('1');
  });

  it('counts active filters (not sort or q)', () => {
    expect(activeFilterCount(EMPTY)).toBe(0);
    expect(activeFilterCount({ ...EMPTY, sort: 'new', q: 'x' })).toBe(0);
    // cat, brand, price (min+max count once), stock, disc
    expect(activeFilterCount(FULL)).toBe(5);
    expect(activeFilterCount({ ...EMPTY, min: 5 })).toBe(1);
  });

  it('clearCatalogFilters resets filter fields but keeps q and sort', () => {
    expect(clearCatalogFilters(FULL)).toEqual({ ...EMPTY, sort: 'price_asc', q: 'red shirt' });
    expect(activeFilterCount(clearCatalogFilters(FULL))).toBe(0);
  });

  it('toApiParams emits only filter keys and round trips through parseCatalogQuery', () => {
    const p = toApiParams(FULL);
    expect(parseCatalogQuery(p)).toEqual({
      categoryIds: [C1, C2],
      brands: ['Acme', 'Foo Bar'],
      minPrice: 100,
      maxPrice: 500,
      inStockOnly: true,
      minDiscountPct: 25,
      sort: 'price_asc',
      search: 'red shirt',
    });
    expect(toApiParams(EMPTY).toString()).toBe('');
  });
});
