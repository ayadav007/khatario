import { NextRequest, NextResponse } from 'next/server';
import {
  fetchPortalLeaveBalances,
  fetchPortalLeaveInsights,
  fetchPortalLeaveRequests,
} from '@/lib/employee-portal/portal-dashboard';
import { requirePortalSession, requirePortalFeature } from '@/lib/employee-portal/portal-route-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const denied = await requirePortalFeature(auth.session.businessId, 'leaves');
    if (denied) return denied;

    const year = Number(
      request.nextUrl.searchParams.get('year') ?? new Date().getFullYear(),
    );
    const { businessId, employeeId } = auth.session;

    const [balances, requests, insights] = await Promise.all([
      fetchPortalLeaveBalances(businessId, employeeId, year),
      fetchPortalLeaveRequests(businessId, employeeId),
      fetchPortalLeaveInsights(businessId, employeeId, year),
    ]);

    const pending = requests.filter(
      (r) => r.status === 'pending' || r.status === 'partially_approved',
    );
    const past = requests.filter((r) => r.is_past && r.status !== 'pending');

    return NextResponse.json({
      year,
      balances,
      requests,
      pending,
      past,
      insights,
    });
  } catch (error) {
    console.error('[portal/leave-insights GET]', error);
    return NextResponse.json({ error: 'Failed to load leave data' }, { status: 500 });
  }
}
