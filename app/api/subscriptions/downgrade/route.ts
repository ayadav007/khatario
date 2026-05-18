import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { downgradeSubscription } from '@/lib/subscription/lifecycle';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const { target_plan_id, confirmed } = body;

    if (!target_plan_id) {
      return NextResponse.json(
        { error: 'target_plan_id is required' },
        { status: 400 }
      );
    }

    if (!confirmed) {
      const result = await downgradeSubscription(business_id, target_plan_id, {
        confirmed: false,
      });
      return NextResponse.json({
        success: true,
        confirmed: false,
        warnings: result.dataImpact,
        scheduled_date: result.scheduled_date,
      });
    }

    const result = await downgradeSubscription(business_id, target_plan_id, {
      confirmed: true,
    });

    return NextResponse.json({
      success: true,
      confirmed: true,
      scheduled_date: result.scheduled_date,
      dataImpact: result.dataImpact,
      subscription: result.subscription,
      message: result.scheduled_date
        ? `Downgrade scheduled for ${result.scheduled_date}. You'll keep your current plan until then.`
        : 'Downgrade scheduled successfully.',
    });
  } catch (error: any) {
    console.error('Error downgrading subscription:', error);

    if (
      error.message?.includes('No active subscription') ||
      error.message?.includes('not found or inactive') ||
      error.message?.includes('not a lower tier')
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to downgrade subscription', details: error.message },
      { status: 500 }
    );
  }
}
