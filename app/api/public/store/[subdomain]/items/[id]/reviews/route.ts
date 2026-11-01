import { NextRequest, NextResponse } from 'next/server';
import { canReview, listReviews, myReview, parseReviewSort, reviewSummary } from '@/lib/store/reviews';
import { queryOne } from '@/lib/db';
import { storeAndShopper, reviewErrorResponse, isUuid } from '@/lib/store/review-http';

export const dynamic = 'force-dynamic';

const EMPTY = { summary: { avg: 0, count: 0, histogram: [0, 0, 0, 0, 0] }, reviews: [], hasMore: false, my_review: null };

export async function GET(
  request: NextRequest,
  { params }: { params: { subdomain: string; id: string } },
) {
  try {
    const { store, customerId } = await storeAndShopper(request, params.subdomain, { enginePreview: true });
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    if (store.is_demo) return NextResponse.json({ ...EMPTY, can_review: { ok: false, reason: 'sign_in' } });
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const visible = await queryOne(
      `SELECT 1 FROM items WHERE id = $1 AND business_id = $2 AND show_in_store = true
         AND (is_active IS NULL OR is_active = true) AND deleted_at IS NULL`,
      [params.id, store.business_id],
    );
    if (!visible) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const sp = request.nextUrl.searchParams;
    const sort = parseReviewSort(sp.get('sort'));
    const page = Math.max(1, Math.floor(Number(sp.get('page'))) || 1);
    // customerId comes only from the store session cookie, so `is_mine` / `my_review` never trust the request.
    const [summary, list, can, mine] = await Promise.all([
      reviewSummary(store.business_id, params.id),
      listReviews({ businessId: store.business_id, itemId: params.id, sort, page, viewerCustomerId: customerId }),
      canReview(store.business_id, customerId, params.id),
      myReview(store.business_id, customerId, params.id),
    ]);
    return NextResponse.json({
      summary,
      reviews: list.reviews,
      hasMore: list.hasMore,
      can_review: can.ok ? { ok: true } : { ok: false, reason: can.reason },
      my_review: mine,
    });
  } catch (e) {
    return reviewErrorResponse(e);
  }
}
