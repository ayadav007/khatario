import { assertQueryBinds } from '@/lib/store/store-items-query';

const MAX_Q = 60;
const VISIBLE =
  'i.show_in_store = true AND (i.is_active IS NULL OR i.is_active = true) AND i.deleted_at IS NULL';

/** Escape backslash, `%` and `_` so user text matches literally in ILIKE ... ESCAPE (backslash). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type SuggestResult = {
  products: { id: string; name: string; image_url: string | null; selling_price: number; mrp: number | null }[];
  categories: { id: string; name: string }[];
};

export function buildSuggestQuery(
  businessId: string,
  q: string,
): { products: { sql: string; params: unknown[] }; categories: { sql: string; params: unknown[] } } | null {
  const text = q.trim().slice(0, MAX_Q).trim();
  if (text.length < 2) return null;
  const e = escapeLike(text);

  // $2 prefix, $3 anywhere, $4 start of a later word.
  const productParams = [businessId, `${e}%`, `%${e}%`, `% ${e}%`];
  const productSql = `
      SELECT i.id, i.name, i.image_url, i.selling_price::float8 AS selling_price, i.mrp::float8 AS mrp
      FROM items i
      WHERE i.business_id = $1 AND ${VISIBLE}
        AND (i.name ILIKE $3 ESCAPE '\\' OR i.code ILIKE $3 ESCAPE '\\' OR i.brand ILIKE $3 ESCAPE '\\')
      ORDER BY CASE WHEN i.name ILIKE $2 ESCAPE '\\' OR i.name ILIKE $4 ESCAPE '\\' THEN 0 ELSE 1 END,
        i.name ASC
      LIMIT 6`;

  const categoryParams = [businessId, `%${e}%`];
  const categorySql = `
      SELECT c.id, c.name
      FROM categories c
      WHERE c.name ILIKE $2 ESCAPE '\\'
        AND EXISTS (SELECT 1 FROM items i WHERE i.category_id = c.id AND i.business_id = $1 AND ${VISIBLE})
      ORDER BY c.name
      LIMIT 3`;

  assertQueryBinds(productSql, productParams);
  assertQueryBinds(categorySql, categoryParams);
  return {
    products: { sql: productSql, params: productParams },
    categories: { sql: categorySql, params: categoryParams },
  };
}
