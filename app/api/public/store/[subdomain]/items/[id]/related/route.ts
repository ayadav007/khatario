import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { isUuid } from '@/lib/store/review-http';
import { buildRelatedQuery } from '@/lib/store/related-products';
import { mapStoreItemRow } from '@/lib/store/map-store-product';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/store/{subdomain}/items/{id}/related?limit=8&branch_id=...
 * Same category first, then same brand, then best sellers. Never includes the item itself.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { subdomain: string; id: string } },
) {
  try {
    const td = request.nextUrl.searchParams.get('td');
    const store = await resolveStoreBySubdomain(params.subdomain, { allowOffline: Boolean(td) });
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

    if (store.is_demo) return NextResponse.json({ items: [] });

    const { searchParams } = request.nextUrl;
    const limitRaw = parseInt(searchParams.get('limit') ?? '8', 10);
    const limit = Math.min(24, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 8));
    const rawBranch = searchParams.get('branch_id');
    const branchId = isUuid(rawBranch) ? rawBranch : null;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    const item = await queryOne<{ category_id: string | null; brand: string | null }>(
      `SELECT category_id, brand FROM items
        WHERE id = $1 AND business_id = $2 AND show_in_store = true
          AND (is_active IS NULL OR is_active = true) AND deleted_at IS NULL`,
      [params.id, store.business_id],
    );
    if (!item) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const q = buildRelatedQuery({
      businessId: store.business_id,
      itemId: params.id,
      categoryId: item.category_id,
      brand: item.brand,
      limit,
      branchId,
    });
    const rows = await queryRows<Record<string, unknown>>(q.sql, q.params);
    return NextResponse.json({ items: rows.map(mapStoreItemRow) });
  } catch (error) {
    console.error('[store related]', error);
    return NextResponse.json({ error: 'Failed to load related products' }, { status: 500 });
  }
}
