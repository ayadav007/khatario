import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { cancelScheduledDowngrade } from '@/lib/subscription/lifecycle';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;

    const subscription = await cancelScheduledDowngrade(tenant.businessId);

    return NextResponse.json({
      success: true,
      message: 'Scheduled downgrade has been cancelled',
      subscription,
    });
  } catch (error: any) {
    console.error('Error cancelling scheduled downgrade:', error);

    if (
      error.message?.includes('No active subscription') ||
      error.message?.includes('No scheduled downgrade')
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to cancel scheduled downgrade', details: error.message },
      { status: 500 }
    );
  }
}
