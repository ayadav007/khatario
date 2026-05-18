import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/dashboard/top-customers
 * Returns top customers by total sales (invoice grand_total)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json({ error: 'business_id required' }, { status: 400 });
    }

    const rows = await queryRows<{
      id: string;
      name: string;
      total_sales: string;
      invoice_count: string;
    }>(
      `SELECT 
        c.id,
        c.name,
        COALESCE(SUM(i.grand_total), 0)::text as total_sales,
        COUNT(i.id)::text as invoice_count
      FROM customers c
      LEFT JOIN invoices i ON i.customer_id = c.id 
        AND i.business_id = c.business_id
        AND i.status = 'final'
        AND i.deleted_at IS NULL
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
      WHERE c.business_id = $1 AND c.is_active = true AND c.deleted_at IS NULL
      GROUP BY c.id, c.name
      HAVING COALESCE(SUM(i.grand_total), 0) > 0
      ORDER BY total_sales DESC
      LIMIT $2`,
      [businessId, limit]
    );

    const topCustomers = rows.map((r) => ({
      id: r.id,
      name: r.name,
      total_sales: Number(r.total_sales),
      invoice_count: parseInt(r.invoice_count, 10),
    }));

    return NextResponse.json({ topCustomers });
  } catch (error: any) {
    console.error('Error fetching top customers:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
