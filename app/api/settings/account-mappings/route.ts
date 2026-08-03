import { NextRequest, NextResponse } from 'next/server';
import { getAccountMappings, updateAccountMappings } from '@/lib/account-mappings';
import { AccountMappings } from '@/lib/account-mappings';

export const dynamic = 'force-dynamic';

import { requireTenantBusinessId } from '@/lib/auth-helpers';

/**
 * GET /api/settings/account-mappings
 * Get account mappings for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    const mappings = await getAccountMappings(businessId);

    return NextResponse.json({ mappings });
  } catch (error: any) {
    console.error('Error fetching account mappings:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/account-mappings
 * Update account mappings for a business
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    const { mappings } = body;

    if (!business_id || !mappings) {
      return NextResponse.json(
        { error: 'business_id and mappings are required' },
        { status: 400 }
      );
    }

    await updateAccountMappings(business_id, mappings as Partial<AccountMappings>);

    return NextResponse.json({ success: true, message: 'Account mappings updated' });
  } catch (error: any) {
    console.error('Error updating account mappings:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

