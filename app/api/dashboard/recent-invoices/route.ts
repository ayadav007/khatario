import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/recent-invoices
 * Returns most recent invoices for dashboard widget
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

    const invoices = await queryRows(
      `SELECT 
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.grand_total,
        i.status,
        i.payment_status,
        c.name as customer_name
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      WHERE i.business_id = $1 AND i.status != 'cancelled'
        AND i.deleted_at IS NULL
      ORDER BY i.created_at DESC
      LIMIT $2`,
      [businessId, limit]
    );

    return NextResponse.json({ invoices });
  } catch (error: any) {
    console.error('Error fetching recent invoices:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
