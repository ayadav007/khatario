import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { queryOne } from '@/lib/db';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { getTheme } from '@/lib/store/engine/themes-repo';
import { PREVIEW_TTL, signThemePreview } from '@/lib/store/engine/preview-token';
import { isPreviewPath } from '@/lib/store/engine/preview-path';
import { isUuid, notFound } from '@/lib/store/engine/route-utils';
import { storePreviewUrl } from '@/lib/store/engine/preview-url';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return notFound();
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const tenant = await requireTenantPermission(request, body.business_id, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  if (body.kind !== 'editor' && body.kind !== 'share') {
    return NextResponse.json({ error: 'kind must be editor or share' }, { status: 400 });
  }
  const path = body.path === undefined ? '/' : body.path;
  if (typeof path !== 'string' || !isPreviewPath(path)) {
    return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 });
  }
  try {
    const theme = await getTheme(tenant.businessId, params.id);
    if (!theme) return notFound();
    const settings = await queryOne<{ store_subdomain: string | null }>(
      `SELECT store_subdomain FROM business_settings WHERE business_id = $1`,
      [tenant.businessId],
    );
    const subdomain = settings?.store_subdomain;
    if (!subdomain) return NextResponse.json({ error: 'Set a store URL under Store setup first.' }, { status: 409 });

    const ttl = PREVIEW_TTL[body.kind];
    const token = signThemePreview(tenant.businessId, theme.id, ttl);
    const url = storePreviewUrl(request, subdomain, path, theme.id, token);
    return NextResponse.json({ url, expires_at: new Date(Date.now() + ttl).toISOString() });
  } catch (error) {
    console.error('themes/[id]/preview-link POST:', error);
    return NextResponse.json({ error: 'Failed to create preview link' }, { status: 500 });
  }
}
