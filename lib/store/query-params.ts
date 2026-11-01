import { parseStoreItemsSort, type StoreItemsQueryInput } from '@/lib/store/store-items-query';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 20;
const DISCOUNT_STEPS = [10, 25, 50];

function list(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, MAX_LIST);
}

function positive(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(999999, n) : null;
}

/**
 * Catalog filter params shared by the items, facets and suggest routes:
 * cat, brand, min, max, stock=1, disc (10|25|50), sort, q, ids. Invalid values are dropped.
 */
export function parseCatalogQuery(sp: URLSearchParams): Partial<StoreItemsQueryInput> {
  const out: Partial<StoreItemsQueryInput> = {};

  const categoryIds = list(sp.get('cat')).filter((v) => UUID_RE.test(v));
  if (categoryIds.length) out.categoryIds = categoryIds;

  const brands = list(sp.get('brand'));
  if (brands.length) out.brands = brands;

  const min = positive(sp.get('min'));
  if (min != null) out.minPrice = min;
  const max = positive(sp.get('max'));
  if (max != null) out.maxPrice = max;

  if (sp.get('stock') === '1') out.inStockOnly = true;

  const disc = Number(sp.get('disc'));
  if (DISCOUNT_STEPS.includes(disc)) out.minDiscountPct = disc;

  const sortRaw = sp.get('sort');
  const sort = parseStoreItemsSort(sortRaw);
  if (sortRaw && sort !== 'name') out.sort = sort;

  const q = sp.get('q')?.trim();
  if (q) out.search = q;

  const ids = list(sp.get('ids')).filter((v) => UUID_RE.test(v));
  if (ids.length) out.ids = ids;

  return out;
}
