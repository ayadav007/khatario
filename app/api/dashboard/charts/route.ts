import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/dashboard/charts
 * Get chart data for sales and purchases over time
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

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

    if (!businessId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'business_id, start_date, and end_date are required' },
        { status: 400 }
      );
    }

    // Get daily sales data - use invoice_date instead of created_at
    // Only count finalized invoices (not drafts or proforma) as per GST rules
    // Cast DATE to text to ensure proper JSON serialization
    // Use DATE() in WHERE clause to handle timestamp comparisons correctly
    const salesData = await queryRows<{ date: string; total: number }>(
      `SELECT 
        DATE(invoice_date)::text as date,
        COALESCE(SUM(grand_total), 0) as total
      FROM invoices
      WHERE business_id = $1 
        AND deleted_at IS NULL
        AND status = 'final'
        AND (document_type IS NULL OR document_type != 'proforma_invoice')
        AND DATE(invoice_date) >= DATE($2)
        AND DATE(invoice_date) <= DATE($3)
      GROUP BY DATE(invoice_date)
      ORDER BY date ASC`,
      [businessId, startDate, endDate]
    );

    // Get daily purchases data - use bill_date instead of created_at
    // Include all purchases except cancelled (similar to other dashboard endpoints)
    // Use DATE() in WHERE clause to handle timestamp comparisons correctly
    const purchasesData = await queryRows<{ date: string; total: number }>(
      `SELECT 
        DATE(bill_date)::text as date,
        COALESCE(SUM(grand_total), 0) as total
      FROM purchases
      WHERE business_id = $1 
        AND deleted_at IS NULL
        AND status != 'cancelled'
        AND DATE(bill_date) >= DATE($2)
        AND DATE(bill_date) <= DATE($3)
      GROUP BY DATE(bill_date)
      ORDER BY date ASC`,
      [businessId, startDate, endDate]
    );

    // Combine data by date
    const dateMap = new Map<string, { sales: number; purchases: number }>();

    salesData.forEach((row) => {
      dateMap.set(row.date, { sales: Number(row.total), purchases: 0 });
    });

    purchasesData.forEach((row) => {
      const existing = dateMap.get(row.date) || { sales: 0, purchases: 0 };
      existing.purchases = Number(row.total);
      dateMap.set(row.date, existing);
    });

    // Convert to array format
    let chartData = Array.from(dateMap.entries())
      .map(([date, values]) => ({
        date,
        sales: values.sales,
        purchases: values.purchases,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // If no data found, check if there are any invoices/purchases at all for this business
    if (chartData.length === 0) {
      const hasAnyInvoices = await queryRows<{ count: number }>(
        `SELECT COUNT(*) as count FROM invoices 
         WHERE business_id = $1 
           AND deleted_at IS NULL
           AND status = 'final'
           AND (document_type IS NULL OR document_type != 'proforma_invoice')`,
        [businessId]
      );
      const hasAnyPurchases = await queryRows<{ count: number }>(
        `SELECT COUNT(*) as count FROM purchases WHERE business_id = $1 AND deleted_at IS NULL AND status != 'cancelled'`,
        [businessId]
      );

      // Get the actual date range of invoices and purchases
      const invoiceDateRange = await queryRows<{ min_date: string; max_date: string }>(
        `SELECT 
          MIN(DATE(invoice_date))::text as min_date,
          MAX(DATE(invoice_date))::text as max_date
        FROM invoices 
        WHERE business_id = $1 
          AND deleted_at IS NULL
          AND status = 'final'
          AND (document_type IS NULL OR document_type != 'proforma_invoice')`,
        [businessId]
      );
      
      const purchaseDateRange = await queryRows<{ min_date: string; max_date: string }>(
        `SELECT 
          MIN(DATE(bill_date))::text as min_date,
          MAX(DATE(bill_date))::text as max_date
        FROM purchases 
        WHERE business_id = $1 AND deleted_at IS NULL AND status != 'cancelled'`,
        [businessId]
      );

      console.log('[Dashboard Charts] No data in date range, but business has:', {
        totalInvoices: hasAnyInvoices[0]?.count || 0,
        totalPurchases: hasAnyPurchases[0]?.count || 0,
        requestedDateRange: { startDate, endDate },
        actualInvoiceDateRange: invoiceDateRange[0] || null,
        actualPurchaseDateRange: purchaseDateRange[0] || null,
      });
    }

    // Debug logging (can be removed in production)
    console.log('[Dashboard Charts]', {
      businessId,
      startDate,
      endDate,
      salesCount: salesData.length,
      purchasesCount: purchasesData.length,
      chartDataCount: chartData.length,
      sampleSales: salesData.slice(0, 3),
      samplePurchases: purchasesData.slice(0, 3),
      sampleChartData: chartData.slice(0, 3),
    });

    return NextResponse.json({ chartData });
  } catch (error: any) {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    console.error('Error fetching chart data:', {
      message: error.message,
      stack: error.stack,
      businessId,
      startDate,
      endDate,
    });
    return NextResponse.json(
      { 
        error: error.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

