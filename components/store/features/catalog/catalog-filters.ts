import { parseStoreItemsSort, type StoreItemsSort } from '@/lib/store/store-items-query';
import { parseCatalogQuery } from '@/lib/store/query-params';

export type CatalogFilterValue = {
  categoryIds: string[];
  brands: string[];
  min: number | null;
  max: number | null;
  inStock: boolean;
  disc: 10 | 25 | 50 | null;
  sort: StoreItemsSort;
  q: string;
};

/** Every URL/API key this module owns; anything else in a URL is left alone. */
const FILTER_KEYS = ['cat', 'brand', 'min', 'max', 'stock', 'disc', 'sort', 'q'] as const;

export const EMPTY_CATALOG_FILTERS: CatalogFilterValue = {
  categoryIds: [],
  brands: [],
  min: null,
  max: null,
  inStock: false,
  disc: null,
  sort: 'name',
  q: '',
};

/** Validation is the server's: same keys, same rules, so the page and the APIs agree. */
export function parseCatalogFilters(sp: URLSearchParams): CatalogFilterValue {
  const parsed = parseCatalogQuery(sp);
  return {
    categoryIds: parsed.categoryIds ?? [],
    brands: parsed.brands ?? [],
    min: parsed.minPrice ?? null,
    max: parsed.maxPrice ?? null,
    inStock: parsed.inStockOnly === true,
    disc: (parsed.minDiscountPct as CatalogFilterValue['disc']) ?? null,
    sort: parseStoreItemsSort(sp.get('sort')),
    q: parsed.search ?? '',
  };
}

/** Writes only non-default filter keys onto a copy of `base`; unknown keys are kept. */
export function serializeCatalogFilters(value: CatalogFilterValue, base: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base.toString());
  for (const key of FILTER_KEYS) out.delete(key);
  if (value.categoryIds.length) out.set('cat', value.categoryIds.join(','));
  if (value.brands.length) out.set('brand', value.brands.join(','));
  if (value.min != null && value.min > 0) out.set('min', String(value.min));
  if (value.max != null && value.max > 0) out.set('max', String(value.max));
  if (value.inStock) out.set('stock', '1');
  if (value.disc != null) out.set('disc', String(value.disc));
  if (value.sort !== 'name') out.set('sort', value.sort);
  const q = value.q.trim();
  if (q) out.set('q', q);
  return out;
}

/** Filters the shopper can clear; sort and the search text are not counted. Min and max count once. */
export function activeFilterCount(value: CatalogFilterValue): number {
  return (
    (value.categoryIds.length ? 1 : 0) +
    (value.brands.length ? 1 : 0) +
    (value.min != null || value.max != null ? 1 : 0) +
    (value.inStock ? 1 : 0) +
    (value.disc != null ? 1 : 0)
  );
}

/** "Clear all": resets the filters but keeps the shopper's search text and sort. */
export function clearCatalogFilters(value: CatalogFilterValue): CatalogFilterValue {
  return { ...EMPTY_CATALOG_FILTERS, sort: value.sort, q: value.q };
}

/** Params for the items / facets / suggest APIs: filter keys only. */
export function toApiParams(value: CatalogFilterValue): URLSearchParams {
  return serializeCatalogFilters(value, new URLSearchParams());
}
