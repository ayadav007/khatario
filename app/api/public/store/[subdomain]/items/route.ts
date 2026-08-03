import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';

export const dynamic = 'force-dynamic';

interface StoreItem {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  selling_price: number;
  mrp: number | null;
  unit: string;
  image_url: string | null;
  category_id: string | null;
  category_name: string | null;
  current_stock: number;
  has_variants: boolean;
  tax_rate: number;
  variants: Array<{
    id: string;
    variant_name: string;
    selling_price: number;
    current_stock: number;
    attributes: unknown;
  }>;
}

/**
 * GET /api/public/store/{subdomain}/items
 * Returns catalog items for the store. Supports:
 *   ?category_id=...  — filter by category
 *   ?search=...       — search by name/code
 *   ?branch_id=...    — stock from specific branch
 *   ?page=1&limit=40  — pagination
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  try {
    const store = await resolveStoreBySubdomain(params.subdomain);
    if (!store) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    const { searchParams } = request.nextUrl;
    const categoryId = searchParams.get('category_id');
    const search = searchParams.get('search')?.trim();
    const branchId = searchParams.get('branch_id');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '40', 10)));
    const offset = (page - 1) * limit;

    const stockExpr = branchId
      ? `COALESCE((SELECT bis.quantity FROM branch_item_stock bis
          WHERE bis.business_id = i.business_id AND bis.item_id = i.id
            AND bis.branch_id = $${branchId ? 'BRANCH' : 'X'}), i.current_stock, 0)`
      : 'COALESCE(i.current_stock, 0)';

    const conditions: string[] = [
      'i.business_id = $1',
      'i.show_in_store = true',
      '(i.is_active IS NULL OR i.is_active = true)',
    ];
    const queryParams: unknown[] = [store.business_id];
    let paramIdx = 1;

    if (categoryId) {
      paramIdx++;
      conditions.push(`i.category_id = $${paramIdx}`);
      queryParams.push(categoryId);
    }

    if (search) {
      paramIdx++;
      conditions.push(`(i.name ILIKE $${paramIdx} OR i.code ILIKE $${paramIdx})`);
      queryParams.push(`%${search}%`);
    }

    // Build stock expression with proper param index for branch
    let finalStockExpr = 'COALESCE(i.current_stock, 0)';
    let variantStockExpr = 'COALESCE(iv.current_stock, 0)';
    if (branchId) {
      paramIdx++;
      queryParams.push(branchId);
      finalStockExpr = `COALESCE((SELECT bis.quantity FROM branch_item_stock bis
        WHERE bis.business_id = i.business_id AND bis.item_id = i.id
          AND bis.branch_id = $${paramIdx}), i.current_stock, 0)`;
      variantStockExpr = `COALESCE((SELECT biv.quantity FROM branch_item_variant_stock biv
        WHERE biv.business_id = i.business_id AND biv.item_variant_id = iv.id
          AND biv.branch_id = $${paramIdx}), iv.current_stock, 0)`;
    }

    paramIdx++;
    queryParams.push(limit);
    const limitParam = paramIdx;

    paramIdx++;
    queryParams.push(offset);
    const offsetParam = paramIdx;

    const sql = `
      SELECT
        i.id, i.name, i.code, i.description,
        i.selling_price::text, i.mrp::text, i.unit,
        i.image_url, i.category_id, c.name AS category_name,
        ${finalStockExpr}::text AS current_stock,
        COALESCE(i.has_variants, false) AS has_variants,
        i.tax_rate::text,
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
      WHERE ${conditions.join(' AND ')}
      GROUP BY i.id, c.name
      ORDER BY i.name ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const rows = await queryRows<Record<string, unknown>>(sql, queryParams);

    const items: StoreItem[] = rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      code: (r.code as string) ?? null,
      description: (r.description as string) ?? null,
      selling_price: parseFloat(r.selling_price as string) || 0,
      mrp: r.mrp ? parseFloat(r.mrp as string) : null,
      unit: (r.unit as string) || 'PCS',
      image_url: (r.image_url as string) ?? null,
      category_id: (r.category_id as string) ?? null,
      category_name: (r.category_name as string) ?? null,
      current_stock: parseFloat(r.current_stock as string) || 0,
      has_variants: r.has_variants as boolean,
      tax_rate: parseFloat(r.tax_rate as string) || 0,
      variants: Array.isArray(r.variants) ? r.variants : [],
    }));

    // Get categories for this store
    const categories = await queryRows<{ id: string; name: string }>(
      `SELECT DISTINCT c.id, c.name
       FROM categories c
       INNER JOIN items i ON i.category_id = c.id
       WHERE i.business_id = $1 AND i.show_in_store = true
         AND (i.is_active IS NULL OR i.is_active = true)
       ORDER BY c.name`,
      [store.business_id],
    );

    // Total count for pagination
    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT i.id)::text AS count
       FROM items i
       WHERE ${conditions.join(' AND ')}`,
      queryParams.slice(0, conditions.length),
    );

    return NextResponse.json({
      items,
      categories,
      total: parseInt(countRow?.count ?? '0', 10),
      page,
      limit,
    });
  } catch (error) {
    console.error('[store items]', error);
    return NextResponse.json(
      { error: 'Failed to load items' },
      { status: 500 },
    );
  }
}
