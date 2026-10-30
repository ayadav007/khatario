import {
  assertQueryBinds,
  buildStoreItemFilters,
  type StoreItemFilterSkip,
  type StoreItemsQueryInput,
} from '@/lib/store/store-items-query';

export type StoreFacetName = 'price' | 'categories' | 'brands' | 'discount' | 'inStock';
export interface FacetQuery {
  sql: string;
  params: unknown[];
}

const DISCOUNT_BUCKETS = [10, 25, 50] as const;

/** One facet query: the active filters except the facet's own, so its options stay selectable. */
function facet(
  input: StoreItemsQueryInput,
  skip: StoreItemFilterSkip[],
  build: (where: string) => string,
  forceInStock = false,
): FacetQuery {
  const f = buildStoreItemFilters(forceInStock ? { ...input, inStockOnly: true } : input, { skip });
  const sql = build(f.conditions.join(' AND '));
  assertQueryBinds(sql, f.params);
  return { sql, params: f.params };
}

export function buildStoreFacetsQuery(input: StoreItemsQueryInput): Record<StoreFacetName, FacetQuery> {
  const pct = (n: number) =>
    `COUNT(*) FILTER (WHERE i.mrp > 0 AND (i.mrp - i.selling_price) / i.mrp * 100 >= ${n})::int AS d${n}`;
  return {
    price: facet(
      input,
      ['price'],
      (where) => `
        SELECT MIN(i.selling_price)::float8 AS min, MAX(i.selling_price)::float8 AS max
        FROM items i
        WHERE ${where}`,
    ),
    categories: facet(
      input,
      ['category'],
      (where) => `
        SELECT c.id, c.name, COUNT(*)::int AS count
        FROM items i
        JOIN categories c ON c.id = i.category_id
        WHERE ${where}
        GROUP BY c.id, c.name
        ORDER BY c.name`,
    ),
    brands: facet(
      input,
      ['brand'],
      (where) => `
        SELECT i.brand AS name, COUNT(*)::int AS count
        FROM items i
        WHERE ${where} AND i.brand IS NOT NULL AND btrim(i.brand) <> ''
        GROUP BY i.brand
        ORDER BY i.brand`,
    ),
    discount: facet(
      input,
      ['discount'],
      (where) => `
        SELECT ${DISCOUNT_BUCKETS.map(pct).join(', ')}
        FROM items i
        WHERE ${where}`,
    ),
    // Forces the (branch-aware) stock test on, so it counts in-stock items under the other filters.
    inStock: facet(
      input,
      [],
      (where) => `
        SELECT COUNT(*)::int AS count
        FROM items i
        WHERE ${where}`,
      true,
    ),
  };
}

export type StoreFacets = {
  price: { min: number; max: number };
  categories: { id: string; name: string; count: number }[];
  brands: { name: string; count: number }[];
  discount: { pct: 10 | 25 | 50; count: number }[];
  inStock: number;
};

/** Raw rows of each facet query (pg may return numerics as strings). */
export interface StoreFacetRows {
  price: { min: number | string | null; max: number | string | null }[];
  categories: { id: string; name: string; count: number | string }[];
  brands: { name: string; count: number | string }[];
  discount: { d10: number | string; d25: number | string; d50: number | string }[];
  inStock: { count: number | string }[];
}

export function shapeFacets(rows: StoreFacetRows): StoreFacets {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const p = rows.price[0];
  const d = rows.discount[0];
  const brands = rows.brands.map((b) => ({ name: b.name, count: num(b.count) }));
  const discount: StoreFacets['discount'] = d
    ? [
        { pct: 10, count: num(d.d10) },
        { pct: 25, count: num(d.d25) },
        { pct: 50, count: num(d.d50) },
      ]
    : [];
  return {
    price: { min: num(p?.min), max: num(p?.max) },
    categories: rows.categories.map((c) => ({ id: c.id, name: c.name, count: num(c.count) })),
    brands: brands.length < 2 ? [] : brands,
    discount: discount.every((b) => b.count === 0) ? [] : discount,
    inStock: num(rows.inStock[0]?.count),
  };
}
