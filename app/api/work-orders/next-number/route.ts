import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withPremiumSubscriptionApi } from '@/lib/security';
import { resolveGstScheme, resolveSupplierRegistration } from '@/lib/gst/registration';
import { peekWorkOrderNumber } from '@/lib/work-orders/work-order';
import { workOrderErrorResponse } from '@/lib/work-orders/route-helpers';

export const dynamic = 'force-dynamic';

/** GET /api/work-orders/next-number — suggested number for a new work order (not reserved). */
export const GET = withPremiumSubscriptionApi(
  { module: 'work_orders', action: 'create' },
  async (ctx) => {
    try {
      const pool = getPool();
      const branchParam = new URL(ctx.request.url).searchParams.get('branch_id');
      const { number, branchId } = await peekWorkOrderNumber(pool, ctx.businessId, branchParam);
      const [registration, scheme] = await Promise.all([
        resolveSupplierRegistration(pool as any, ctx.businessId, branchId),
        resolveGstScheme(pool as any, ctx.businessId, branchId),
      ]);
      return NextResponse.json({
        work_order_number: number,
        branch_id: branchId,
        supplier_state_code: registration.stateCode,
        charge_tax: scheme === 'regular',
      });
    } catch (error: any) {
      return workOrderErrorResponse(error, 'Failed to get next work order number');
    }
  },
);
