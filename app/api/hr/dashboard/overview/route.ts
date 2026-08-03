import { NextRequest, NextResponse } from 'next/server';
import {
  getBusinessIdFromRequest,
  getUserIdFromRequest,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { businessHasModule, getBusinessPlatformContext } from '@/lib/business-modules';
import { fetchHrDashboardEnhanced } from '@/lib/hr/dashboard-enhanced';

export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/dashboard/overview
 * Business-wide HR KPIs for the HR home dashboard.
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }

    const platform = await getBusinessPlatformContext(businessId);
    if (!businessHasModule(platform, 'hr')) {
      return NextResponse.json(
        { error: 'HR module is not enabled for this account' },
        { status: 403 },
      );
    }

    try {
      await authorize(userId, 'employees', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const overview = await fetchHrDashboardEnhanced(businessId);
    return NextResponse.json(overview);
  } catch (error: unknown) {
    console.error('[hr/dashboard/overview]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
