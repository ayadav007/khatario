import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { loadOrderUpdateSettings } from '@/lib/fulfilment/hub';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import { sanitizeOrderUpdateSettings } from '@/lib/fulfilment/update-settings';

export const dynamic = 'force-dynamic';

/** GET /api/orders/settings — which buyer WhatsApp updates are on, and the dispatch time limit. */
export async function GET(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: await loadOrderUpdateSettings(auth.scope.businessId) });
}

/** PUT /api/orders/settings — owners and staff with settings access only. */
export async function PUT(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const owner = await queryOne<{ is_primary_admin: boolean | null }>(
    `SELECT is_primary_admin FROM users WHERE id = $1 AND business_id = $2`,
    [auth.userId, auth.scope.businessId],
  );
  const { checkUserPermission } = await import('@/lib/permissions');
  const canEdit =
    Boolean(owner?.is_primary_admin) ||
    (await checkUserPermission(auth.userId, 'settings', 'update').catch(() => false));
  if (!canEdit) {
    return NextResponse.json({ error: 'Only the owner or staff with settings access can change this.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const settings = sanitizeOrderUpdateSettings(body?.settings ?? body);
  await query(
    `INSERT INTO business_settings (business_id, order_update_settings) VALUES ($1, $2::jsonb)
     ON CONFLICT (business_id) DO UPDATE
       SET order_update_settings = business_settings.order_update_settings || EXCLUDED.order_update_settings,
           updated_at = NOW()`,
    [auth.scope.businessId, JSON.stringify(settings)],
  );
  return NextResponse.json({ settings });
}
