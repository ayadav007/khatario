import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getDefaultPlanBundle } from '@/lib/hr/leave/leave-plan';
import { previewLeaveYearEnd, runLeaveYearEnd } from '@/lib/hr/leave/leave-year-end';
import { getLeaveYear } from '@/lib/hr/leave/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'leave_requests', 'update', { businessId });

    const body = await request.json();
    const previewOnly = body.preview === true;
    const { plan } = await getDefaultPlanBundle(businessId);
    const leaveYear =
      body.leave_year != null
        ? Number(body.leave_year)
        : getLeaveYear(new Date(), plan.calendar_year_start_month) - 1;

    if (previewOnly) {
      const rows = await previewLeaveYearEnd(businessId, leaveYear);
      return NextResponse.json({ preview: rows, leave_year: leaveYear });
    }

    const result = await runLeaveYearEnd(businessId, leaveYear);
    return NextResponse.json({ ok: true, leave_year: leaveYear, ...result });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Year-end processing failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
