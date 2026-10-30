/** Bayesian rating: pull items with few ratings toward the prior. */
export const BAYES_PRIOR = 3.5;
export const BAYES_WEIGHT = 5;

const MAX_LIST_FILTER = 20;

export interface StoreItemsQueryInput {
  businessId: string;
  categoryId?: string | null;
  categoryIds?: string[];
  brands?: string[];
  search?: string | null;
  branchId?: string | null;
  featuredOnly?: boolean;
  discountedOnly?: boolean;
  inStockOnly?: boolean;
  minPrice?: number | null;
  maxPrice?: number | null;
  /** Minimum percentage off MRP. */
  minDiscountPct?: number | null;
  /** Uuids (validated by the caller); results keep this order. */
  ids?: string[];
  /** `name` (default) A-Z, `new` newest first, `bestsellers` most sold on the store first. */
  sort?: StoreItemsSort;
  limit: number;
  offset: number;
}

export type StoreItemsSort =
  | 'name'
  | 'new'
  | 'bestsellers'
  | 'price_asc'
  | 'price_desc'
  | 'discount'
  | 'rating';

const SORTS: StoreItemsSort[] = ['new', 'bestsellers', 'price_asc', 'price_desc', 'discount', 'rating'];

export function parseStoreItemsSort(raw: string | null | undefined): StoreItemsSort {
  return SORTS.includes(raw as StoreItemsSort) ? (raw as StoreItemsSort) : 'name';
}

export interface StoreItemsQuery {
  listSql: string;
  listParams: unknown[];
  countSql: string;
  countParams: unknown[];
  categorySql: string;
  categoryParams: unknown[];
}

function placeholderCount(sql: string): number {
  const matches = sql.match(/\$(\d+)/g);
  if (!matches) return 0;
  return Math.max(...matches.map((m) => parseInt(m.slice(1), 10)));
}

export function assertQueryBinds(sql: string, params: unknown[]): void {
  const expected = placeholderCount(sql);
  if (expected !== params.length) {
    throw new Error(
      `SQL bind mismatch: statement has $${expected || 0} but ${params.length} value(s) were supplied`,
    );
  }
}

export type StoreItemFilterSkip = 'price' | 'category' | 'brand' | 'stock' | 'discount';

function cleanList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_LIST_FILTER);
}

/** Branch-aware stock expressions; `branchIdx` is the bound branch param, if any. */
export function stockExprs(branchIdx: number | null, variantAlias: string) {
  if (!branchIdx) {
    return {
      item: 'COALESCE(i.current_stock, 0)',
      variant: `COALESCE(${variantAlias}.current_stock, 0)`,
    };
  }
  return {
    item: `COALESCE((SELECT bis.quantity FROM branch_item_stock bis
        WHERE bis.business_id = i.business_id AND bis.item_id = i.id
          AND bis.branch_id = $${branchIdx}), i.current_stock, 0)`,
    variant: `COALESCE((SELECT biv.quantity FROM branch_item_variant_stock biv
        WHERE biv.business_id = i.business_id AND biv.item_variant_id = ${variantAlias}.id
          AND biv.branch_id = $${branchIdx}), ${variantAlias}.current_stock, 0)`,
  };
}

/** Units sold through the store (cancelled orders excluded); expects the business id at $1. */
export const STORE_SOLD_JOIN_SQL = `LEFT JOIN (
          SELECT soi.item_id, SUM(soi.quantity) AS sold
          FROM store_order_items soi
          JOIN store_orders so ON so.id = soi.order_id
          WHERE so.business_id = $1 AND so.status <> 'cancelled'
          GROUP BY soi.item_id
        ) sold ON sold.item_id = i.id`;

/** Column list shared by the items list and related-products queries (same row shape). */
export function storeItemSelectSql(parts: {
  stockExpr: string;
  variantStockExpr: string;
  soldSelect: string;
}): string {
  return `SELECT
        i.id, i.name, i.code, i.description,
        i.selling_price::text, i.mrp::text, i.unit,
        i.image_url, i.gallery_urls, i.category_id, c.name AS category_name, i.brand,
        ${parts.stockExpr}::text AS current_stock,
        COALESCE(i.has_variants, false) AS has_variants,
        COALESCE(i.featured_in_store, false) AS featured_in_store,
        i.tax_rate::text,
        COALESCE(i.gst_included, false) AS gst_included,
        i.created_at,
        ${parts.soldSelect} AS sold_count,
        COALESCE((
          SELECT AVG(r.rating)::text FROM store_item_ratings r
          WHERE r.item_id = i.id AND r.business_id = i.business_id
        ), '0') AS rating_avg,
        COALESCE((
          SELECT COUNT(*)::text FROM store_item_ratings r
          WHERE r.item_id = i.id AND r.business_id = i.business_id
        ), '0') AS rating_count,
        COALESCE(
          json_agg(
            json_build_object(
              'id', iv.id,
              'variant_name', iv.variant_name,
              'selling_price', iv.selling_price,
              'current_stock', ${parts.variantStockExpr},
              'attributes', iv.attributes
            ) ORDER BY iv.created_at, iv.id
          ) FILTER (WHERE iv.id IS NOT NULL),
          '[]'::json
        ) AS variants`;
}

export interface StoreItemFilters {
  conditions: string[];
  params: unknown[];
  nextIdx: number;
  /** Set when the filters already bound the branch id (in-stock filter). */
  branchIdx: number | null;
  idsIdx: number | null;
}

/** WHERE conditions and binds shared by the list, count and facet queries. */
export function buildStoreItemFilters(
  input: StoreItemsQueryInput,
  opts: { skip?: StoreItemFilterSkip[] } = {},
): StoreItemFilters {
  const skip = new Set(opts.skip ?? []);
  const conditions: string[] = [
    'i.business_id = $1',
    'i.show_in_store = true',
    '(i.is_active IS NULL OR i.is_active = true)',
    'i.deleted_at IS NULL',
  ];
  const params: unknown[] = [input.businessId];
  let idx = 1;
  let branchIdx: number | null = null;
  let idsIdx: number | null = null;
  const bind = (v: unknown) => {
    idx += 1;
    params.push(v);
    return idx;
  };

  if (input.featuredOnly) {
    conditions.push('i.featured_in_store = true');
  }

  if (input.discountedOnly) {
    conditions.push(
      'i.mrp IS NOT NULL AND i.mrp > i.selling_price AND COALESCE(i.current_stock, 0) > 0',
    );
  }

  if (!skip.has('price')) {
    if (input.minPrice != null && Number.isFinite(input.minPrice) && input.minPrice > 0) {
      conditions.push(`i.selling_price >= $${bind(input.minPrice)}`);
    }
    if (input.maxPrice != null && Number.isFinite(input.maxPrice) && input.maxPrice > 0) {
      conditions.push(`i.selling_price <= $${bind(input.maxPrice)}`);
    }
  }

  if (!skip.has('category')) {
    const categoryIds = cleanList([
      ...(input.categoryIds ?? []),
      ...(input.categoryId ? [input.categoryId] : []),
    ]);
    if (categoryIds.length) {
      conditions.push(`i.category_id = ANY($${bind(categoryIds)})`);
    }
  }

  if (!skip.has('brand')) {
    const brands = cleanList(input.brands);
    if (brands.length) {
      conditions.push(`i.brand = ANY($${bind(brands)})`);
    }
  }

  if (!skip.has('discount')) {
    const pct = input.minDiscountPct;
    if (pct != null && Number.isFinite(pct) && pct > 0) {
      conditions.push(
        `(i.mrp > 0 AND (i.mrp - i.selling_price) / i.mrp * 100 >= $${bind(Math.min(pct, 100))})`,
      );
    }
  }

  if (!skip.has('stock') && input.inStockOnly) {
    if (input.branchId) branchIdx = bind(input.branchId);
    const ex = stockExprs(branchIdx, 'ivs');
    conditions.push(`(CASE WHEN COALESCE(i.has_variants, false)
        THEN EXISTS (SELECT 1 FROM item_variants ivs WHERE ivs.item_id = i.id AND ${ex.variant} > 0)
        ELSE ${ex.item} > 0 END)`);
  }

  if (input.search) {
    const n = bind(`%${input.search}%`);
    conditions.push(`(i.name ILIKE $${n} OR i.code ILIKE $${n})`);
  }

  if (input.ids?.length) {
    idsIdx = bind(input.ids);
    conditions.push(`i.id = ANY($${idsIdx}::uuid[])`);
  }

  return { conditions, params, nextIdx: idx, branchIdx, idsIdx };
}

export function buildStoreItemsQuery(input: StoreItemsQueryInput): StoreItemsQuery {
  const filters = buildStoreItemFilters(input);
  const whereParams = filters.params;
  let paramIdx = filters.nextIdx;

  const listParams = [...whereParams];
  let branchIdx = filters.branchIdx;
  if (input.branchId && !branchIdx) {
    paramIdx += 1;
    listParams.push(input.branchId);
    branchIdx = paramIdx;
  }
  const { item: finalStockExpr, variant: variantStockExpr } = stockExprs(branchIdx, 'iv');

  paramIdx += 1;
  listParams.push(input.limit);
  const limitParam = paramIdx;

  paramIdx += 1;
  listParams.push(input.offset);
  const offsetParam = paramIdx;

  const whereSql = filters.conditions.join(' AND ');
  const sort = input.sort ?? 'name';
  // Units sold through the store (cancelled orders excluded); only joined when ranking by it.
  const soldJoin = sort === 'bestsellers' ? STORE_SOLD_JOIN_SQL : '';
  const soldSelect = sort === 'bestsellers' ? 'COALESCE(sold.sold, 0)::text' : "'0'";
  const ratingJoin =
    sort === 'rating'
      ? `LEFT JOIN (
          SELECT item_id, SUM(rating) AS sum, COUNT(*) AS cnt
          FROM store_item_ratings WHERE business_id = $1 GROUP BY item_id
        ) rs ON rs.item_id = i.id`
      : '';
  const sortOrders: Record<StoreItemsSort, string> = {
    name: 'i.name ASC',
    new: 'i.created_at DESC NULLS LAST, i.name ASC',
    bestsellers: 'COALESCE(sold.sold, 0) DESC, i.name ASC',
    price_asc: 'i.selling_price ASC, i.name ASC',
    price_desc: 'i.selling_price DESC, i.name ASC',
    discount:
      'CASE WHEN i.mrp > 0 THEN (i.mrp - i.selling_price) / i.mrp END DESC NULLS LAST, i.name ASC',
    rating: `(COALESCE(rs.sum, 0) + ${BAYES_PRIOR} * ${BAYES_WEIGHT}) / (COALESCE(rs.cnt, 0) + ${BAYES_WEIGHT}) DESC, COALESCE(rs.cnt, 0) DESC, i.name ASC`,
  };
  // byIds keeps the caller's order regardless of sort.
  const orderSql = filters.idsIdx
    ? `array_position($${filters.idsIdx}::uuid[], i.id)`
    : sortOrders[sort];
  const groupExtra =
    (sort === 'bestsellers' ? ', sold.sold' : '') + (sort === 'rating' ? ', rs.sum, rs.cnt' : '');

  const listSql = `
      ${storeItemSelectSql({
        stockExpr: finalStockExpr,
        variantStockExpr,
        soldSelect,
      })}
      FROM items i
      LEFT JOIN categories c ON c.id = i.category_id
      LEFT JOIN item_variants iv ON iv.item_id = i.id
      ${soldJoin}
      ${ratingJoin}
      WHERE ${whereSql}
      GROUP BY i.id, c.name${groupExtra}
      ORDER BY ${orderSql}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

  const countSql = `
       SELECT COUNT(DISTINCT i.id)::text AS count
       FROM items i
       WHERE ${whereSql}`;

  const categorySql = `
       SELECT c.id, c.name, COUNT(i.id)::int AS item_count
       FROM categories c
       INNER JOIN items i ON i.category_id = c.id
       WHERE i.business_id = $1 AND i.show_in_store = true
         AND (i.is_active IS NULL OR i.is_active = true)
         AND i.deleted_at IS NULL
       GROUP BY c.id, c.name
       ORDER BY c.name`;

  assertQueryBinds(listSql, listParams);
  assertQueryBinds(countSql, whereParams);
  assertQueryBinds(categorySql, [input.businessId]);

  return {
    listSql,
    listParams,
    countSql,
    countParams: whereParams,
    categorySql,
    categoryParams: [input.businessId],
  };
}
