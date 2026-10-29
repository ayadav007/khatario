import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { publishTheme } from '@/lib/store/engine/themes-repo';
import { isUuid, notFound, repoJson } from '@/lib/store/engine/route-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return notFound();
  const { searchParams } = new URL(request.url);
  const tenant = await requireTenantPermission(request, searchParams.get('business_id'), 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  try {
    return repoJson(await publishTheme(tenant.businessId, tenant.userId, params.id), 'theme');
  } catch (error) {
    console.error('themes/[id]/publish POST:', error);
    return NextResponse.json({ error: 'Failed to publish theme' }, { status: 500 });
  }
}
