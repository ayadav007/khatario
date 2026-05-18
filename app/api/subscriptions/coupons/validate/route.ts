import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { validateCoupon } from '@/lib/subscription/coupons';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;

    const { code, plan_id } = body;
    const billing_cycle =
      body.billing_cycle === 'yearly' ? 'yearly' : 'monthly';

    if (!code || !plan_id) {
      return NextResponse.json(
        { error: 'code and plan_id are required' },
        { status: 400 }
      );
    }

    const result = await validateCoupon(
      code,
      tenant.businessId,
      plan_id,
      billing_cycle,
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error validating coupon:', error);
    return NextResponse.json(
      { error: 'Failed to validate coupon', details: error.message },
      { status: 500 }
    );
  }
}
