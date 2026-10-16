import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { businessHasWebAccess } from '@/lib/subscription/web-access';

export const dynamic = 'force-dynamic';

/** GET /api/subscriptions/web-access — { allowed } for the signed-in business (Free = phone app only). */
export async function GET(request: NextRequest) {
  const tenant = requireTenantBusinessId(request, request.nextUrl.searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  try {
    const allowed = await businessHasWebAccess(tenant.businessId);
    return NextResponse.json({ allowed });
  } catch (error) {
    console.error('Error checking web access:', error);
    // Never lock a business out of the website because the check failed.
    return NextResponse.json({ allowed: true });
  }
}
