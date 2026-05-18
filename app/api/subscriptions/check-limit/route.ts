import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { checkLimit, type LimitCheckType } from '@/lib/subscription';

/**
 * GET /api/subscriptions/check-limit
 * Check if a business has reached a usage limit
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;

    const limitType = searchParams.get('limit_type') as LimitCheckType;

    if (!limitType) {
      return NextResponse.json({ error: 'limit_type is required' }, { status: 400 });
    }

    const result = await checkLimit(tenant.businessId, limitType);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error checking limit:', error);
    return NextResponse.json(
      { error: 'Failed to check limit', details: error.message },
      { status: 500 }
    );
  }
}

