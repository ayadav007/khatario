import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import {
  declineSelfServeTrialExtension,
  grantSelfServeTrialExtension,
  shouldOfferTrialExtension,
  TRIAL_EXTENSION_DAYS,
  getTrialExtensionState,
} from '@/lib/subscription/trial-extension';

/**
 * GET /api/subscriptions/trial-extension?business_id=
 * Whether the one-time extend modal should be shown.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;

    const sub = await getTrialExtensionState(tenant.businessId);
    if (!sub) {
      return NextResponse.json({ show_modal: false, extension_days: TRIAL_EXTENSION_DAYS });
    }

    return NextResponse.json({
      show_modal: shouldOfferTrialExtension(sub),
      extension_days: TRIAL_EXTENSION_DAYS,
      trial_end_date: sub.trial_end_date,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/subscriptions/trial-extension
 * Body: { business_id, action: 'extend' | 'decline' }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;

    const action = body.action as string;
    if (action === 'extend') {
      const trialEndDate = await grantSelfServeTrialExtension(tenant.businessId);
      return NextResponse.json({
        success: true,
        trial_end_date: trialEndDate,
        message: `Trial extended by ${TRIAL_EXTENSION_DAYS} days.`,
      });
    }

    if (action === 'decline') {
      await declineSelfServeTrialExtension(tenant.businessId);
      return NextResponse.json({
        success: true,
        message: 'You are now on the Free plan.',
      });
    }

    return NextResponse.json({ error: 'action must be extend or decline' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
