import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { buildStoreItemsQuery } from '@/lib/store/store-items-query';

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

    const q = buildStoreItemsQuery({
      businessId: store.business_id,
      categoryId,
      search,
      branchId,
      limit,
      offset,
    });

    const rows = await queryRows<Record<string, unknown>>(q.listSql, q.listParams);

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

    const categories = await queryRows<{ id: string; name: string }>(
      q.categorySql,
      q.categoryParams,
    );

    const countRow = await queryOne<{ count: string }>(q.countSql, q.countParams);

    return NextResponse.json({
      items,
      categories,
      total: parseInt(countRow?.count ?? '0', 10),
      page,
      limit,
    });
  } catch (error) {
    console.error('[store items]', error);
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'Failed to load items',
        ...(process.env.NODE_ENV !== 'production' ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
