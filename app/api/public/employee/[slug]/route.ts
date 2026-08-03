import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessByPortalSlug } from '@/lib/employee-portal/resolve-business';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { getHrPortalSettings } from '@/lib/hr/hr-portal-settings';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const business = await resolveBusinessByPortalSlug(params.slug);
  if (!business) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const portalEnabled = await hasFeatureAccess(business.id, 'hr_employee_portal');
  const portalSettings = await getHrPortalSettings(business.id);

  return NextResponse.json({
    business: {
      id: business.id,
      name: business.name,
      logo_url: business.logo_url,
      portal_slug: business.portal_slug,
    },
    portal_enabled: portalEnabled,
    kiosk_enabled: portalSettings.kiosk_enabled,
  });
}
