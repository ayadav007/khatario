import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { listVersions } from '@/lib/store/engine/versions-repo';

export const dynamic = 'force-dynamic';

/** D45, D46: the business's published versions, newest first, with the author's name; no data and no user ids. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // D53: reading needs the online-store settings permission; a query business_id is only compared, never used.
  const tenant = await requireTenantPermission(request, searchParams.get('business_id'), 'settings', 'read');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  try {
    return NextResponse.json({ versions: await listVersions(tenant.businessId) });
  } catch (error) {
    console.error('themes/versions GET:', error);
    return NextResponse.json({ error: 'Failed to load the version history' }, { status: 500 });
  }
}
