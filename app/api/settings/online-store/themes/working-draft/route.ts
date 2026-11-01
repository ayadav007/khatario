import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { getOrCreateWorkingDraft } from '@/lib/store/engine/themes-repo';
import { repoJson } from '@/lib/store/engine/route-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch {
    // an empty body is fine: the business comes from the session
  }
  const tenant = await requireTenantPermission(request, body.business_id, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;

  try {
    return repoJson(await getOrCreateWorkingDraft(tenant.businessId, tenant.userId), 'theme');
  } catch (error) {
    console.error('themes working-draft POST:', error);
    return NextResponse.json({ error: 'Failed to open the working draft' }, { status: 500 });
  }
}
