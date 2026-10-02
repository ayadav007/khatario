import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { writeChallan } from '@/lib/delivery-challans/challan';
import { authorizeChallan, challanErrorResponse } from '@/lib/delivery-challans/route-helpers';

/**
 * GET /api/delivery-challans
 * Fetch all delivery challans for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;
    const status = searchParams.get('status');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    let query = `
      SELECT 
        dc.*,
        c.name as customer_name,
        i.invoice_number,
        so.order_number as sales_order_number
      FROM delivery_challans dc
      LEFT JOIN customers c ON dc.customer_id = c.id
      LEFT JOIN invoices i ON dc.invoice_id = i.id
      LEFT JOIN sales_orders so ON dc.sales_order_id = so.id
      WHERE dc.business_id = $1
    `;

    const params: any[] = [businessId];

    if (status) {
      query += ` AND dc.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY dc.challan_date DESC, dc.created_at DESC`;

    const result = await pool.query(query, params);

    return NextResponse.json({ deliveryChallans: result.rows });
  } catch (error: any) {
    console.error('Error fetching delivery challans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch delivery challans', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/delivery-challans
 * Create a new delivery challan
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const auth = await authorizeChallan(request, 'create');
    if (!auth.ok) return auth.response;

    await client.query('BEGIN');
    // No stock movement: a challan moves goods without selling them.
    const deliveryChallan = await writeChallan(client, tenant.businessId, {
      ...body,
      created_by: auth.userId,
    });
    await client.query('COMMIT');

    return NextResponse.json({ deliveryChallan }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    return challanErrorResponse(error, 'Failed to create delivery challan');
  } finally {
    client.release();
  }
}

