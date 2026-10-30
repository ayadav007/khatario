import { NextRequest, NextResponse } from 'next/server';
import { createReview } from '@/lib/store/reviews';
import { storeAndShopper, reviewErrorResponse, parseReviewBody } from '@/lib/store/review-http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { subdomain: string } }) {
  try {
    const { store, customerId } = await storeAndShopper(request, params.subdomain);
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    if (store.is_demo) return NextResponse.json({ error: 'Reviews are not available on a demo store' }, { status: 403 });
    if (!customerId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const itemId = String(body?.item_id ?? '').trim();
    if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });
    const parsed = parseReviewBody(body, store.business_id);
    if (!parsed.ok) return parsed.response;
    const review = await createReview(store.business_id, customerId, { ...parsed.input, item_id: itemId });
    return NextResponse.json({ review }, { status: 201 });
  } catch (e) {
    return reviewErrorResponse(e);
  }
}
