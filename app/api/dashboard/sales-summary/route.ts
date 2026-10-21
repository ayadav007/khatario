import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { format, startOfMonth, endOfMonth, startOfDay } from 'date-fns';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/sales-summary
 * Returns today's and this month's sales (excludes proforma)
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

    const today = format(startOfDay(new Date()), 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');

    const [todaySales, monthSales] = await Promise.all([
      queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(grand_total), 0) as total
         FROM invoices
         WHERE business_id = $1
           AND deleted_at IS NULL
           AND status = 'final'
           AND (document_type IS NULL OR document_type != 'proforma_invoice')
           AND DATE(invoice_date) = $2`,
        [businessId, today]
      ),
      queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(grand_total), 0) as total
         FROM invoices
         WHERE business_id = $1
           AND deleted_at IS NULL
           AND status = 'final'
           AND (document_type IS NULL OR document_type != 'proforma_invoice')
           AND DATE(invoice_date) >= $2 AND DATE(invoice_date) <= $3`,
        [businessId, monthStart, monthEnd]
      ),
    ]);

    return NextResponse.json({
      today_sales: Number(todaySales?.total || 0),
      month_sales: Number(monthSales?.total || 0),
    });
  } catch (error: any) {
    console.error('Error fetching sales summary:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
