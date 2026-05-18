import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { getBusinessAddons } from '@/lib/subscription';

/**
 * GET /api/subscriptions/addons/current
 * Get current active add-ons for a business
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;

    const addons = await getBusinessAddons(tenant.businessId);

    return NextResponse.json({
      addons,
    });
  } catch (error: any) {
    console.error('Error fetching current addons:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch current addons' },
      { status: 500 }
    );
  }
}

