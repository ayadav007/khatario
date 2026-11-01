import { NextRequest, NextResponse } from 'next/server';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { RateInputError } from '@/lib/pricing/rate-input';

/**
 * Session, role and plan checks for the party pricing setup APIs. The business always comes from
 * the session, never the request. Returns the ids, or the response to send back.
 */
export async function pricingAuth(
  request: NextRequest,
  action: 'read' | 'update'
): Promise<{ userId: string; businessId: string } | NextResponse> {
  const userId = getUserIdFromRequest(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  try {
    await authorize(userId, 'items', action, { businessId });
    await assertFeatureAccess(businessId, FeatureKeys.PARTY_PRICING);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    throw error;
  }
  return { userId, businessId };
}

export function pricingError(error: unknown, label: string): NextResponse {
  if (error instanceof RateInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if ((error as { code?: string })?.code === '23505') {
    return NextResponse.json({ error: 'That name is already used' }, { status: 409 });
  }
  console.error(`[${label}]`, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
