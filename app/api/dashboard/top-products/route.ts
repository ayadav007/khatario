import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/dashboard/top-products
 * Returns top selling items by revenue (excludes proforma invoices)
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
      total_revenue: string;
      total_qty: string;
    }>(
      `SELECT 
        i.id,
        i.name,
        COALESCE(SUM(ii.quantity * ii.unit_price), 0)::text as total_revenue,
        COALESCE(SUM(ii.quantity), 0)::text as total_qty
      FROM items i
      JOIN invoice_items ii ON ii.item_id = i.id
      JOIN invoices inv ON inv.id = ii.invoice_id
        AND inv.business_id = $1
        AND inv.status = 'final'
        AND inv.deleted_at IS NULL
        AND (inv.document_type IS NULL OR inv.document_type != 'proforma_invoice')
      WHERE i.business_id = $1
      GROUP BY i.id, i.name
      ORDER BY total_revenue DESC
      LIMIT $2`,
      [businessId, limit]
    );

    const topProducts = rows.map((r) => ({
      id: r.id,
      name: r.name,
      total_revenue: Number(r.total_revenue),
      total_qty: parseInt(r.total_qty, 10),
    }));

    return NextResponse.json({ topProducts });
  } catch (error: any) {
    console.error('Error fetching top products:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
