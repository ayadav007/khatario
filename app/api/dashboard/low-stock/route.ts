import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/low-stock
 * Returns items at or below minimum stock level
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const businessId = session.businessId;
    const userId = session.userId;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '5', 10), 20);

    try {
      await authorize(userId, 'dashboard', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
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
