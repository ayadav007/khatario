import {
  assertQueryBinds,
  buildStoreItemFilters,
  outOfStockSql,
  stockExprs,
  storeItemSelectSql,
  STORE_SOLD_JOIN_SQL,
  type StoreItemsOutOfStock,
} from '@/lib/store/store-items-query';

export interface RelatedQueryInput {
  businessId: string;
  itemId: string;
  categoryId: string | null;
  brand: string | null;
  limit?: number;
  /** When set, stock is read from this branch (same as the items list). */
  branchId?: string | null;
  /** Where out-of-stock products go, as in the items list: `stay` (default, query unchanged), `end` or `hide`. */
  outOfStock?: StoreItemsOutOfStock;
}

/**
 * Related products: same category first, then same brand, then everything else by
 * units sold on the store. Same visibility rules, row shape and out-of-stock place as the items list.
 */
export function buildRelatedQuery(input: RelatedQueryInput): { sql: string; params: unknown[] } {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 8), 1), 24);
  const outOfStock = input.outOfStock ?? 'stay';
  const filters = buildStoreItemFilters({
    businessId: input.businessId,
    limit,
    offset: 0,
    outOfStock,
    branchId: input.branchId,
  });
  const params = [...filters.params];
  const bind = (v: unknown) => {
    params.push(v);
    return params.length;
  };
  const itemIdx = bind(input.itemId);
  const categoryIdx = bind(input.categoryId);
  const brandIdx = bind(input.brand);
  const limitIdx = bind(limit);
  // `hide` already bound the branch for its filter; the stock columns share that bind.
  const branchIdx = filters.branchIdx ?? (input.branchId ? bind(input.branchId) : null);
  const stock = stockExprs(branchIdx, 'iv');

  const where = [...filters.conditions, `i.id <> $${itemIdx}::uuid`].join(' AND ');
  const rank = `CASE
          WHEN $${categoryIdx}::uuid IS NOT NULL AND i.category_id = $${categoryIdx}::uuid THEN 0
          WHEN $${brandIdx}::text IS NOT NULL AND i.brand = $${brandIdx}::text THEN 1
          ELSE 2
        END`;
  const endSql = outOfStock === 'end' ? `CASE WHEN ${outOfStockSql(branchIdx)} THEN 1 ELSE 0 END, ` : '';

  const sql = `
      ${storeItemSelectSql({
        stockExpr: stock.item,
        variantStockExpr: stock.variant,
        soldSelect: 'COALESCE(sold.sold, 0)::text',
      })}
      FROM items i
      LEFT JOIN categories c ON c.id = i.category_id
      LEFT JOIN item_variants iv ON iv.item_id = i.id
      ${STORE_SOLD_JOIN_SQL}
      WHERE ${where}
      GROUP BY i.id, c.name, sold.sold
      ORDER BY ${endSql}${rank}, COALESCE(sold.sold, 0) DESC, i.name ASC
      LIMIT $${limitIdx}
    `;

  assertQueryBinds(sql, params);
  return { sql, params };
}
