import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { cancelSubscription } from '@/lib/subscription/lifecycle';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;

    const { reason } = body;
    const subscription = await cancelSubscription(tenant.businessId, reason);

    return NextResponse.json({
      success: true,
      message: 'Subscription cancellation scheduled at end of billing period',
      subscription,
    });
  } catch (error: any) {
    console.error('Error cancelling subscription:', error);

    if (error.message?.includes('No active subscription')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to cancel subscription', details: error.message },
      { status: 500 }
    );
  }
}
