import { NextRequest, NextResponse } from 'next/server';
import { moderateReview } from '@/lib/store/reviews';
import { reviewErrorResponse, isUuid } from '@/lib/store/review-http';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';

export const dynamic = 'force-dynamic';

const ACTIONS = ['hide', 'publish', 'reply', 'delete_reply'] as const;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const { searchParams } = new URL(request.url);
  const tenant = await requireTenantPermission(request, body?.business_id ?? searchParams.get('business_id'), 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  const action = ACTIONS.find((a) => a === body?.action);
  if (!action) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  try {
    const review = await moderateReview(tenant.businessId, params.id, action, body?.reply);
    return NextResponse.json({ review });
  } catch (e) {
    return reviewErrorResponse(e);
  }
}
