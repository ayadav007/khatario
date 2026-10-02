import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/** GST report permission plus GST reports on the plan; returns the error response or null. */
export async function gstComplianceGuard(userId: string, businessId: string): Promise<NextResponse | null> {
  try {
    await authorize(userId, 'report.gst', 'read', { businessId });
    await assertReportAccess(businessId, 'gst');
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    throw error;
  }
}
