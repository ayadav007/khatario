import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  customerPortalUrl,
  ensureBusinessPortalSlug,
  mergeCustomerSurfaceSettings,
} from '@/lib/customer-surface';

export async function GET(request: NextRequest) {
  const businessId = getSessionScopedBusinessId(request);
  if (!businessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }

  const biz = await queryOne<{ name: string }>(
    `SELECT name FROM businesses WHERE id = $1`,
    [businessId]
  );
  const businessName = biz?.name ?? 'business';

  const slug = await ensureBusinessPortalSlug(businessId, businessName);

  const row = await queryOne<{ customer_surface_settings: unknown }>(
    `SELECT customer_surface_settings FROM business_settings WHERE business_id = $1`,
    [businessId]
  );

  return NextResponse.json({
    settings: mergeCustomerSurfaceSettings(row?.customer_surface_settings),
    portal_slug: slug,
    portal_url: customerPortalUrl(slug),
  });
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getSessionScopedBusinessId(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json();
    const settings = mergeCustomerSurfaceSettings(body.settings ?? body);

    await queryOne(
      `UPDATE business_settings
       SET customer_surface_settings = $2::jsonb
       WHERE business_id = $1`,
      [businessId, JSON.stringify(settings)]
    );

    return NextResponse.json({ settings });
  } catch (error: unknown) {
    console.error('[customer-surface settings]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
