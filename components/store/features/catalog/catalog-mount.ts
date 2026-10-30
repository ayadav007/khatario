import type { StoreFacets } from '@/lib/store/store-facets-query';
import type { CatalogFilterValue } from './catalog-filters';
import type { FilterChipKey } from './ActiveFilterChips';

/** Facets before the first answer: the filter panel can open at once and fill in when they arrive. */
export const EMPTY_FACETS: StoreFacets = {
  price: { min: 0, max: 0 },
  categories: [],
  brands: [],
  discount: [],
  inStock: 0,
};

/**
 * Older links land on the catalog as ?category=<id> or ?offers=1. Rewrites them onto the
 * filter keys (?cat=, ?disc=10, the closest "on offer" step) and keeps every other param.
 * Returns null when there is nothing to rewrite.
 */
export function migrateLandingParams(sp: URLSearchParams): URLSearchParams | null {
  const category = sp.get('category');
  const offers = sp.get('offers');
  if (category == null && offers == null) return null;
  const out = new URLSearchParams(sp.toString());
  out.delete('category');
  out.delete('offers');
  if (category && !out.get('cat')) out.set('cat', category);
  if (offers === '1' && !out.get('disc')) out.set('disc', '10');
  return out;
}

/** The filter change for removing one chip from ActiveFilterChips. */
export function removeFilterChip(
  value: CatalogFilterValue,
  key: FilterChipKey,
  item?: string,
): Partial<CatalogFilterValue> {
  switch (key) {
    case 'cat':
      return { categoryIds: item ? value.categoryIds.filter((id) => id !== item) : [] };
    case 'brand':
      return { brands: item ? value.brands.filter((b) => b !== item) : [] };
    case 'price':
      return { min: null, max: null };
    case 'stock':
      return { inStock: false };
    case 'disc':
      return { disc: null };
  }
}

/**
 * Facets with every selected category and brand listed, so they can always be unticked and their
 * chips named: a search can leave a selected category with no items, and then the facets omit it.
 * Missing ones are added with count 0; category names come from the store's full category list.
 */
export function withSelectedFacets(
  facets: StoreFacets | null,
  value: Pick<CatalogFilterValue, 'categoryIds' | 'brands'>,
  categories: { id: string; name: string }[],
): StoreFacets {
  const base = facets ?? EMPTY_FACETS;
  const missingCats = value.categoryIds
    .filter((id) => !base.categories.some((c) => c.id === id))
    .map((id) => ({ id, name: categories.find((c) => c.id === id)?.name ?? 'Category', count: 0 }));
  const missingBrands = value.brands
    .filter((b) => !base.brands.some((x) => x.name === b))
    .map((name) => ({ name, count: 0 }));
  if (missingCats.length === 0 && missingBrands.length === 0) return base;
  return {
    ...base,
    categories: [...base.categories, ...missingCats],
    brands: [...base.brands, ...missingBrands],
  };
}
