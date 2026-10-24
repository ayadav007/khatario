import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { countApprovedRcmRules } from '@/lib/gst/rcm-catalogue';
import { formRcmNotice, rcmDashboardStatus } from '@/lib/gst/rcm-rules';

export const dynamic = 'force-dynamic';

/** Approved-rule count for the signed-in business. The catalogue is global; the session only authorizes the read. */
export async function GET(request: NextRequest) {
  const businessId = getSessionScopedBusinessId(request);
  const userId = getAuthenticatedUserId(request);
  if (!businessId || !userId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const approvedCount = await countApprovedRcmRules(getPool());
  const dashboard = rcmDashboardStatus(approvedCount);
  return NextResponse.json({
    approvedCount: dashboard.approvedRules,
    purchaseNotice: formRcmNotice('purchase', approvedCount),
    expenseNotice: formRcmNotice('expense', approvedCount),
    dashboard,
  });
}
