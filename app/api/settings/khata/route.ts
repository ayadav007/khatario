import { NextRequest, NextResponse } from 'next/server';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { getKhataSettings, saveKhataSettings, type KhataSettings } from '@/lib/khata/service';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/settings/khata: the business's store khata rules and how many khatas are open. */
export async function GET(request: NextRequest) {
  const tenant = await requireTenantPermission(request, request.nextUrl.searchParams.get('business_id'), 'settings', 'read');
  if (!tenant.ok) return tenant.response;
  const settings = await getKhataSettings(tenant.businessId);
  const counts = await queryOne<{ open: string; requested: string }>(
    `SELECT COUNT(*) FILTER (WHERE khata_enabled)::text AS open,
            COUNT(*) FILTER (WHERE NOT khata_enabled AND khata_requested_at IS NOT NULL)::text AS requested
       FROM customers WHERE business_id = $1 AND deleted_at IS NULL`,
    [tenant.businessId],
  );
  return NextResponse.json({
    settings,
    open_khatas: Number(counts?.open ?? 0),
    khata_requests: Number(counts?.requested ?? 0),
  });
}

/** PUT /api/settings/khata { overLimitRule, overdueRule, graceDays, reminderIntervalDays, allowPartPayment, statementsEnabled } */
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Partial<KhataSettings> & { business_id?: string };
  const tenant = await requireTenantPermission(request, body.business_id, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const settings = await saveKhataSettings(tenant.businessId, body);
  return NextResponse.json({ success: true, settings });
}
