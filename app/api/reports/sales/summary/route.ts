import { NextRequest, NextResponse } from 'next/server';
import {
  handleSalesReportError,
  resolveSalesReportContext,
  salesSummary,
  type SalesPeriod,
} from '@/lib/reports/sales-reports';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/sales/summary?from_date&to_date[&period=day|week|month][&branch_id]
 * Sales by period: invoices less credit notes (Zoho "Sales Summary"). No branch_id = all branches.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveSalesReportContext(request);
    if (ctx instanceof NextResponse) return ctx;
    const p = new URL(request.url).searchParams.get('period') || 'day';
    if (!['day', 'week', 'month'].includes(p)) {
      return NextResponse.json({ error: 'period must be day, week or month' }, { status: 400 });
    }
    const result = await salesSummary(ctx, p as SalesPeriod);
    return NextResponse.json({ from_date: ctx.fromDate, to_date: ctx.toDate, branch_id: ctx.branchId, ...result });
  } catch (error: any) {
    return handleSalesReportError('sales summary report', error);
  }
}
