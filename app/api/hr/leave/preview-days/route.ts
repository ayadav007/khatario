import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getDefaultPlanBundle, getLeavePlanTypeRule } from '@/lib/hr/leave/leave-plan';
import { previewLeaveDays } from '@/lib/hr/leave/leave-days';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const leaveTypeId = searchParams.get('leave_type_id');

    if (!startDate || !endDate || !leaveTypeId) {
      return NextResponse.json(
        { error: 'start_date, end_date, and leave_type_id are required' },
        { status: 400 },
      );
    }

    try {
      await authorize(userId, 'leave_requests', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        const { isEmployee } = await import('@/lib/access-boundary');
        if (!(await isEmployee(userId))) return error.toNextResponse();
      } else {
        throw error;
      }
    }

    const { plan } = await getDefaultPlanBundle(businessId);
    const rule = await getLeavePlanTypeRule(plan.id, leaveTypeId);
    if (!rule) {
      return NextResponse.json({ error: 'Leave type not in plan' }, { status: 404 });
    }

    const preview = await previewLeaveDays({
      businessId,
      startDate,
      endDate,
      rule,
    });

    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to preview days';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
