import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { listOpenCarts } from '@/lib/store/abandoned-carts';

export const dynamic = 'force-dynamic';

/** GET /api/settings/online-store/abandoned-carts: open carts for this business, newest first. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Shopper names and phones: same gate as the enquiries inbox.
  const tenant = await requireTenantPermission(request, searchParams.get('business_id'), 'customers', 'read');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;

  try {
    const [carts, row] = await Promise.all([
      listOpenCarts(tenant.businessId, 100),
      queryOne<{ enabled: boolean; hours: number }>(
        `SELECT COALESCE(store_cart_reminder_enabled, false) AS enabled,
                COALESCE(store_cart_reminder_hours, 3) AS hours
           FROM business_settings WHERE business_id = $1`,
        [tenant.businessId],
      ),
    ]);
    return NextResponse.json({
      carts,
      settings: { enabled: row?.enabled === true, hours: Number(row?.hours ?? 3) },
    });
  } catch (error) {
    console.error('abandoned-carts GET:', error);
    return NextResponse.json({ error: 'Failed to load abandoned carts' }, { status: 500 });
  }
}
