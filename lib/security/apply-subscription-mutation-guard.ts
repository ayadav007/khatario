import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { requireSubscriptionMutationAccess } from '@/lib/security/require-subscription-mutation';

/** Guard subscription/billing mutation routes. Returns a response when blocked. */
export async function applySubscriptionMutationGuard(
  request: NextRequest,
  businessId: string,
): Promise<NextResponse | null> {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  return requireSubscriptionMutationAccess(userId, businessId);
}
