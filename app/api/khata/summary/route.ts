import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { getKhataSettings } from '@/lib/khata/service';
import { todayIst } from '@/lib/gst/time-limits';
import { addDays } from '@/lib/khata/cycle';

export const dynamic = 'force-dynamic';

/** GET /api/khata/summary: store khata totals for the dashboard card. */
export async function GET(request: NextRequest) {
  const tenant = await requireTenantPermission(request, request.nextUrl.searchParams.get('business_id'), 'customers', 'read');
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;
  const settings = await getKhataSettings(businessId);
  const today = todayIst();
  const row = await queryOne<{
    open: string;
    requests: string;
    owed: string;
    overdue: string;
    due_week: string;
    pending: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM customers WHERE business_id = $1 AND deleted_at IS NULL AND khata_enabled)::text AS open,
       (SELECT COUNT(*) FROM customers WHERE business_id = $1 AND deleted_at IS NULL
          AND NOT khata_enabled AND khata_requested_at IS NOT NULL)::text AS requests,
       (SELECT COALESCE(SUM(GREATEST(current_balance, 0)), 0) FROM customers
         WHERE business_id = $1 AND deleted_at IS NULL AND khata_enabled)::text AS owed,
       (SELECT COALESCE(SUM(i.balance_amount), 0) FROM invoices i JOIN customers c ON c.id = i.customer_id
         WHERE i.business_id = $1 AND c.khata_enabled AND i.status = 'final' AND i.deleted_at IS NULL
           AND COALESCE(i.balance_amount, 0) > 0.005 AND i.due_date + ($2::int) < $3::date)::text AS overdue,
       (SELECT COALESCE(SUM(i.balance_amount), 0) FROM invoices i JOIN customers c ON c.id = i.customer_id
         WHERE i.business_id = $1 AND c.khata_enabled AND i.status = 'final' AND i.deleted_at IS NULL
           AND COALESCE(i.balance_amount, 0) > 0.005 AND i.due_date BETWEEN $3::date AND $4::date)::text AS due_week,
       (SELECT COUNT(*) FROM store_orders WHERE business_id = $1 AND khata_approval = 'pending'
          AND status <> 'cancelled')::text AS pending`,
    [businessId, settings.graceDays, today, addDays(today, 7)],
  );
  return NextResponse.json({
    open_khatas: Number(row?.open ?? 0),
    khata_requests: Number(row?.requests ?? 0),
    owed: Number(row?.owed ?? 0),
    overdue: Number(row?.overdue ?? 0),
    due_this_week: Number(row?.due_week ?? 0),
    pending_approvals: Number(row?.pending ?? 0),
  });
}
