import { NextRequest, NextResponse } from 'next/server';
import { updateReview } from '@/lib/store/reviews';
import { storeAndShopper, reviewErrorResponse, parseReviewBody, isUuid } from '@/lib/store/review-http';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { subdomain: string; id: string } }) {
  try {
    const { store, customerId } = await storeAndShopper(request, params.subdomain);
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    if (store.is_demo) return NextResponse.json({ error: 'Reviews are not available on a demo store' }, { status: 403 });
    if (!customerId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const parsed = parseReviewBody(body, store.business_id);
    if (!parsed.ok) return parsed.response;
    const review = await updateReview(store.business_id, customerId, params.id, parsed.input);
    return NextResponse.json({ review });
  } catch (e) {
    return reviewErrorResponse(e);
  }
}
