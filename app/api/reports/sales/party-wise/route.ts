import { NextRequest, NextResponse } from 'next/server';
import { handleSalesReportError, resolveSalesReportContext, salesByCustomer } from '@/lib/reports/sales-reports';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/sales/party-wise?from_date&to_date[&branch_id]
 * Sales by customer: posted invoices net of credit notes (Zoho "Sales by Customer").
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveSalesReportContext(request);
    if (ctx instanceof NextResponse) return ctx;
    const { customers, totals } = await salesByCustomer(ctx);
    return NextResponse.json({ from_date: ctx.fromDate, to_date: ctx.toDate, branch_id: ctx.branchId, parties: customers, totals });
  } catch (error: any) {
    return handleSalesReportError('party-wise sales report', error);
  }
}
