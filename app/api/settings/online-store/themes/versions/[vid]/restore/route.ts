import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { restoreVersion } from '@/lib/store/engine/themes-repo';
import { isUuid, notFound, repoJson } from '@/lib/store/engine/route-utils';

export const dynamic = 'force-dynamic';

/** D48 Restore as draft: 201 `{ theme }`, a new draft; 404 for an unknown or another business's version, 409 at 20. */
export async function POST(request: NextRequest, { params }: { params: { vid: string } }) {
  if (!isUuid(params.vid)) return notFound();
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch {
    // an empty body is fine: the business and the author come from the session
  }
  const tenant = await requireTenantPermission(request, body.business_id, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;

  try {
    return repoJson(await restoreVersion(tenant.businessId, tenant.userId, params.vid.toLowerCase()), 'theme', 201);
  } catch (error) {
    console.error('themes/versions/[vid]/restore POST:', error);
    return NextResponse.json({ error: 'Failed to restore the version' }, { status: 500 });
  }
}
