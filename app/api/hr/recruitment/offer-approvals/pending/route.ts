import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { listPendingOfferApprovalsForUser } from '@/lib/hr/recruitment/offer-approval';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const pending = await listPendingOfferApprovalsForUser(businessId, userId);
    return NextResponse.json({ pending });
  } catch (error) {
    console.error('[offer-approvals/pending GET]', error);
    return NextResponse.json({ error: 'Failed to fetch pending approvals' }, { status: 500 });
  }
}
