import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/dashboard/low-stock
 * Returns items at or below minimum stock level
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const limit = Math.min(parseInt(searchParams.get('limit') || '5', 10), 20);

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

    const items = await queryRows<{
      id: string;
      name: string;
      current_stock: number;
      min_stock: number;
      unit: string;
    }>(
      `SELECT id, name, current_stock, min_stock, unit
       FROM items
       WHERE business_id = $1 AND is_active = true
         AND COALESCE(current_stock, 0) <= COALESCE(min_stock, 0)
       ORDER BY current_stock ASC
       LIMIT $2`,
      [businessId, limit]
    );

    return NextResponse.json({
      items: items.map((r) => ({
        id: r.id,
        name: r.name,
        current_stock: Number(r.current_stock || 0),
        min_stock: Number(r.min_stock || 0),
        unit: r.unit || 'PCS',
      })),
    });
  } catch (error: any) {
    console.error('Error fetching low stock:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
