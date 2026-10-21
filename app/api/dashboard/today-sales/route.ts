import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/today-sales
 * Get invoices created today (same logic as dashboard)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const businessId = session.businessId;
    const userId = session.userId;

    try {
      await authorize(userId, 'dashboard', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { accountOutstandingStoreOrders } = await import('@/lib/store/fulfill-paid-order');
    await accountOutstandingStoreOrders(businessId, userId).catch((err) => {
      console.error('[store invoice]', err);
    });

    // Use the same SQL logic as dashboard overview
    const invoices = await queryRows(
      `SELECT 
        i.*,
        c.name as customer_name,
        c.phone as customer_phone
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        AND i.invoice_date = CURRENT_DATE 
        AND i.status != 'cancelled'
      ORDER BY i.invoice_date DESC, i.created_at DESC`,
      [businessId]
    );

    return NextResponse.json({ invoices });
  } catch (error: any) {
    console.error('Error fetching today sales:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

