import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { listReviewsForMerchant, type ReviewStatus } from '@/lib/store/reviews';
import { reviewErrorResponse } from '@/lib/store/review-http';

export const dynamic = 'force-dynamic';

const STATUSES: ReviewStatus[] = ['published', 'pending', 'hidden'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  try {
    const status = STATUSES.find((s) => s === searchParams.get('status'));
    const page = Math.max(1, Math.floor(Number(searchParams.get('page'))) || 1);
    const { reviews, hasMore } = await listReviewsForMerchant({ businessId: tenant.businessId, status, page });
    return NextResponse.json({ reviews, hasMore });
  } catch (e) {
    return reviewErrorResponse(e);
  }
}
