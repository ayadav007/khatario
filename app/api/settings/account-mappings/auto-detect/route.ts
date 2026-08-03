import { NextRequest, NextResponse } from 'next/server';
import { autoDetectAccountMappings } from '@/lib/account-mappings';
import { requireTenantBusinessId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/settings/account-mappings/auto-detect
 * Auto-detect and save account mappings from existing chart of accounts.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const mappings = await autoDetectAccountMappings(business_id);

    return NextResponse.json({
      success: true,
      message: 'Account mappings auto-detected and saved',
      mappings,
    });
  } catch (error: unknown) {
    console.error('Error auto-detecting account mappings:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
