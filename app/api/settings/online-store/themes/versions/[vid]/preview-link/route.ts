import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { queryOne } from '@/lib/db';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { getVersion } from '@/lib/store/engine/versions-repo';
import { PREVIEW_TTL, signVersionPreview } from '@/lib/store/engine/preview-token';
import { isPreviewPath } from '@/lib/store/engine/preview-path';
import { storePreviewUrl } from '@/lib/store/engine/preview-url';
import { isUuid, notFound } from '@/lib/store/engine/route-utils';

export const dynamic = 'force-dynamic';

/**
 * D47: a 2-hour read-only preview of one published version, `{ url, expires_at }`. The token is a version token bound
 * to this business and this version; the storefront never opens it in editor mode.
 */
export async function POST(request: NextRequest, { params }: { params: { vid: string } }) {
  if (!isUuid(params.vid)) return notFound();
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch {
    // an empty body is fine: the home page is previewed
  }
  const tenant = await requireTenantPermission(request, body.business_id, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  const path = body.path === undefined ? '/' : body.path;
  if (typeof path !== 'string' || !isPreviewPath(path)) {
    return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 });
  }
  try {
    const version = await getVersion(tenant.businessId, params.vid.toLowerCase());
    if (!version) return notFound();
    const settings = await queryOne<{ store_subdomain: string | null }>(
      `SELECT store_subdomain FROM business_settings WHERE business_id = $1`,
      [tenant.businessId],
    );
    const subdomain = settings?.store_subdomain;
    if (!subdomain) return NextResponse.json({ error: 'Set a store URL under Store setup first.' }, { status: 409 });

    const ttl = PREVIEW_TTL.version;
    const now = Date.now();
    const token = signVersionPreview(tenant.businessId, version.id, ttl, now);
    const url = storePreviewUrl(request, subdomain, path, version.id, token);
    return NextResponse.json({ url, expires_at: new Date(now + ttl).toISOString() });
  } catch (error) {
    console.error('themes/versions/[vid]/preview-link POST:', error);
    return NextResponse.json({ error: 'Failed to create preview link' }, { status: 500 });
  }
}
