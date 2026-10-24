import { NextRequest, NextResponse } from 'next/server';
import { handleSalesReportError, resolveSalesReportContext, salesByItem } from '@/lib/reports/sales-reports';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/sales/item-wise?from_date&to_date[&branch_id]
 * Sales by item: invoiced quantity/value less credit-note returns, excluding GST (Zoho "Sales by Item").
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveSalesReportContext(request);
    if (ctx instanceof NextResponse) return ctx;
    const { items, totals } = await salesByItem(ctx);
    return NextResponse.json({ from_date: ctx.fromDate, to_date: ctx.toDate, branch_id: ctx.branchId, items, totals });
  } catch (error: any) {
    return handleSalesReportError('item-wise sales report', error);
  }
}
