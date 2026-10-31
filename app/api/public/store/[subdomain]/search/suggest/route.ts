import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { storeForPublicApi } from '@/lib/store/engine/preview-access';
import { buildSuggestQuery, type SuggestResult } from '@/lib/store/store-suggest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/store/{subdomain}/search/suggest?q=
 * Up to 6 products and 3 categories matching the text (name, code, brand; prefix and mid-word).
 * A store that is not launched yet answers only for a verified preview (`td`, or an engine theme/version token).
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
    const empty: SuggestResult = { products: [], categories: [] };
    if (store.is_demo) return NextResponse.json(empty, { headers });

    const built = buildSuggestQuery(store.business_id, searchParams.get('q') ?? '');
    if (!built) return NextResponse.json(empty, { headers });

    const [products, categories] = await Promise.all([
      queryRows<SuggestResult['products'][number]>(built.products.sql, built.products.params),
      queryRows<SuggestResult['categories'][number]>(built.categories.sql, built.categories.params),
    ]);
    return NextResponse.json({ products, categories } satisfies SuggestResult, { headers });
  } catch (error) {
    console.error('[store suggest]', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
}
