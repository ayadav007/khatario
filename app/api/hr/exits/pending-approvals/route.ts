import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { listPendingExitApprovalsForUser } from '@/lib/hr/exit-approval';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'employees', 'read', { businessId });

    const exits = await listPendingExitApprovalsForUser(businessId, userId);
    return NextResponse.json({ exits });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load pending exit approvals' }, { status: 500 });
  }
}
