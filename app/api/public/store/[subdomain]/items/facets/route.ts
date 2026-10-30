import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { storeForPublicApi } from '@/lib/store/engine/preview-access';
import { isUuid } from '@/lib/store/review-http';
import { parseCatalogQuery } from '@/lib/store/query-params';
import { buildStoreFacetsQuery, shapeFacets, type StoreFacetRows } from '@/lib/store/store-facets-query';

export const dynamic = 'force-dynamic';

const EMPTY_FACETS = shapeFacets({ price: [], categories: [], brands: [], discount: [], inStock: [] });

/**
 * GET /api/public/store/{subdomain}/items/facets
 * Filter options (price range, categories, brands, discount steps, in-stock count) for the
 * current filters; each facet ignores its own filter. Same params as /items.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  try {
    const { searchParams } = request.nextUrl;
    const store = await storeForPublicApi(params.subdomain, searchParams);
    if (!store) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }
    const headers = { 'Cache-Control': 'public, max-age=30' };
    if (store.is_demo) return NextResponse.json(EMPTY_FACETS, { headers });

    const parsed = parseCatalogQuery(searchParams);
    const queries = buildStoreFacetsQuery({
      ...parsed,
      businessId: store.business_id,
      branchId: isUuid(searchParams.get('branch_id')) ? searchParams.get('branch_id') : null,
      limit: 0,
      offset: 0,
    });
    const names = Object.keys(queries) as (keyof typeof queries)[];
    const results = await Promise.all(names.map((n) => queryRows(queries[n].sql, queries[n].params)));
    const rows = Object.fromEntries(names.map((n, i) => [n, results[i]])) as unknown as StoreFacetRows;

    return NextResponse.json(shapeFacets(rows), { headers });
  } catch (error) {
    console.error('[store facets]', error);
    return NextResponse.json({ error: 'Failed to load filters' }, { status: 500 });
  }
}
