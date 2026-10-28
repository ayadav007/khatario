export interface StoreItemsQueryInput {
  businessId: string;
  categoryId?: string | null;
  search?: string | null;
  branchId?: string | null;
  featuredOnly?: boolean;
  discountedOnly?: boolean;
  maxPrice?: number | null;
  /** `name` (default) A-Z, `new` newest first, `bestsellers` most sold on the store first. */
  sort?: StoreItemsSort;
  limit: number;
  offset: number;
}

export type StoreItemsSort = 'name' | 'new' | 'bestsellers';

export function parseStoreItemsSort(raw: string | null | undefined): StoreItemsSort {
  return raw === 'new' || raw === 'bestsellers' ? raw : 'name';
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

export function buildStoreItemsQuery(input: StoreItemsQueryInput): StoreItemsQuery {
  const conditions: string[] = [
    'i.business_id = $1',
    'i.show_in_store = true',
    '(i.is_active IS NULL OR i.is_active = true)',
    'i.deleted_at IS NULL',
  ];
  const whereParams: unknown[] = [input.businessId];
  let paramIdx = 1;

  if (input.featuredOnly) {
    conditions.push('i.featured_in_store = true');
  }

  if (input.discountedOnly) {
    conditions.push(
      'i.mrp IS NOT NULL AND i.mrp > i.selling_price AND COALESCE(i.current_stock, 0) > 0',
    );
  }

  if (input.maxPrice != null && Number.isFinite(input.maxPrice) && input.maxPrice > 0) {
    paramIdx += 1;
    conditions.push(`i.selling_price <= $${paramIdx}`);
    whereParams.push(input.maxPrice);
  }

  if (input.categoryId) {
    paramIdx += 1;
    conditions.push(`i.category_id = $${paramIdx}`);
    whereParams.push(input.categoryId);
  }

  if (input.search) {
    paramIdx += 1;
    conditions.push(`(i.name ILIKE $${paramIdx} OR i.code ILIKE $${paramIdx})`);
    whereParams.push(`%${input.search}%`);
  }

  const listParams = [...whereParams];
  let finalStockExpr = 'COALESCE(i.current_stock, 0)';
  let variantStockExpr = 'COALESCE(iv.current_stock, 0)';
  if (input.branchId) {
    paramIdx += 1;
    listParams.push(input.branchId);
    finalStockExpr = `COALESCE((SELECT bis.quantity FROM branch_item_stock bis
        WHERE bis.business_id = i.business_id AND bis.item_id = i.id
          AND bis.branch_id = $${paramIdx}), i.current_stock, 0)`;
    variantStockExpr = `COALESCE((SELECT biv.quantity FROM branch_item_variant_stock biv
        WHERE biv.business_id = i.business_id AND biv.item_variant_id = iv.id
          AND biv.branch_id = $${paramIdx}), iv.current_stock, 0)`;
  }

  paramIdx += 1;
  listParams.push(input.limit);
  const limitParam = paramIdx;

  paramIdx += 1;
  listParams.push(input.offset);
  const offsetParam = paramIdx;

  const whereSql = conditions.join(' AND ');
  const sort = input.sort ?? 'name';
  // Units sold through the store (cancelled orders excluded); only joined when ranking by it.
  const soldJoin =
    sort === 'bestsellers'
      ? `LEFT JOIN (
          SELECT soi.item_id, SUM(soi.quantity) AS sold
          FROM store_order_items soi
          JOIN store_orders so ON so.id = soi.order_id
          WHERE so.business_id = $1 AND so.status <> 'cancelled'
          GROUP BY soi.item_id
        ) sold ON sold.item_id = i.id`
      : '';
  const soldSelect = sort === 'bestsellers' ? 'COALESCE(sold.sold, 0)::text' : "'0'";
  const orderSql =
    sort === 'bestsellers'
      ? 'COALESCE(sold.sold, 0) DESC, i.name ASC'
      : sort === 'new'
        ? 'i.created_at DESC NULLS LAST, i.name ASC'
        : 'i.name ASC';

  const listSql = `
      SELECT
        i.id, i.name, i.code, i.description,
        i.selling_price::text, i.mrp::text, i.unit,
        i.image_url, i.gallery_urls, i.category_id, c.name AS category_name,
        ${finalStockExpr}::text AS current_stock,
        COALESCE(i.has_variants, false) AS has_variants,
        COALESCE(i.featured_in_store, false) AS featured_in_store,
        i.tax_rate::text,
        COALESCE(i.gst_included, false) AS gst_included,
        i.created_at,
        ${soldSelect} AS sold_count,
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
              'current_stock', ${variantStockExpr},
              'attributes', iv.attributes
            )
          ) FILTER (WHERE iv.id IS NOT NULL),
          '[]'::json
        ) AS variants
      FROM items i
      LEFT JOIN categories c ON c.id = i.category_id
      LEFT JOIN item_variants iv ON iv.item_id = i.id
      ${soldJoin}
      WHERE ${whereSql}
      GROUP BY i.id, c.name${sort === 'bestsellers' ? ', sold.sold' : ''}
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
