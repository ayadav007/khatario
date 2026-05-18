import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { adminUpdateSubscription, getBusinessSubscription } from '@/lib/admin-business-ops';
import { queryOne } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'support', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  try {
    const subscription = await getBusinessSubscription(params.id);
    return NextResponse.json({ subscription });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'support', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  try {
    const business = await queryOne(`SELECT id FROM businesses WHERE id = $1`, [params.id]);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json();
    const subscription = await adminUpdateSubscription({
      businessId: params.id,
      adminId: auth.admin.id,
      planId: body.plan_id,
      status: body.status,
      extendTrialDays:
        body.extend_trial_days != null ? Number(body.extend_trial_days) : undefined,
      trialEndDate: body.trial_end_date,
      billingCycle: body.billing_cycle,
      endDate: body.end_date,
    });

    return NextResponse.json({ subscription });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
