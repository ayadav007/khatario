import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/suppliers/lookup-customer?supplier_business_id=xxx&customer_name=xxx
 * Look up customer business_id from supplier relationship
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const supplierBusinessId = searchParams.get('supplier_business_id');
    const customerName = searchParams.get('customer_name');

    if (!supplierBusinessId || !customerName) {
      return NextResponse.json(
        { error: 'supplier_business_id and customer_name are required' },
        { status: 400 }
      );
    }

    if (supplierBusinessId !== auth.businessId) {
      return NextResponse.json(
        { error: 'You can only look up customers for your own business', code: 'TENANT_MISMATCH' },
        { status: 403 }
      );
    }

    // Find supplier where linked_business_id = supplierBusinessId and business name matches customer_name
    // The supplier.business_id is the customer's business_id
    const result = await queryOne(`
      SELECT s.business_id as customer_business_id
      FROM suppliers s
      JOIN businesses b ON s.business_id = b.id
      WHERE s.linked_business_id = $1
      AND s.deleted_at IS NULL
      AND s.allow_low_stock_access = true
      AND b.name = $2
      LIMIT 1
    `, [supplierBusinessId, customerName]);

    if (result?.customer_business_id) {
      return NextResponse.json({
        customer_business_id: result.customer_business_id
      });
    }

    return NextResponse.json({
      error: 'Customer not found'
    }, { status: 404 });

  } catch (error: any) {
    console.error('Error looking up customer:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to lookup customer' },
      { status: 500 }
    );
  }
}
