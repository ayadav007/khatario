import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { format, startOfMonth, endOfMonth, startOfDay } from 'date-fns';

/**
 * GET /api/dashboard/sales-summary
 * Returns today's and this month's sales (excludes proforma)
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

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
