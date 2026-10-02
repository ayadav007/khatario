import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { peekChallanNumber } from '@/lib/delivery-challans/challan';
import { resolveGstScheme, resolveSupplierRegistration } from '@/lib/gst/registration';

export const dynamic = 'force-dynamic';

/** GET /api/delivery-challans/next-number — suggested number for a new challan (not reserved). */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const pool = getPool();
    const { number, branchId } = await peekChallanNumber(pool, tenant.businessId, searchParams.get('branch_id'));
    const [registration, scheme] = await Promise.all([
      resolveSupplierRegistration(pool as any, tenant.businessId, branchId),
      resolveGstScheme(pool as any, tenant.businessId, branchId),
    ]);
    return NextResponse.json({
      challan_number: number,
      branch_id: branchId,
      supplier_state_code: registration.stateCode,
      charge_tax: scheme === 'regular',
    });
  } catch (error: any) {
    console.error('Error fetching next challan number:', error);
    return NextResponse.json({ error: 'Failed to get next challan number' }, { status: 500 });
  }
}
