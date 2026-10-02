import { NextRequest, NextResponse } from 'next/server';
import {
  handleSalesReportError,
  invoiceDetails,
  INVOICE_STATUSES,
  resolveSalesReportContext,
  type InvoiceStatusFilter,
} from '@/lib/reports/sales-reports';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/sales/invoice-wise?from_date&to_date[&status=all|draft|final|cancelled][&branch_id]
 * Invoice details: every invoice in the period with its status; totals cover posted invoices only.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveSalesReportContext(request);
    if (ctx instanceof NextResponse) return ctx;
    const status = new URL(request.url).searchParams.get('status') || 'all';
    if (status !== 'all' && !(INVOICE_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'status must be all, draft, final or cancelled' }, { status: 400 });
    }
    const { invoices, totals } = await invoiceDetails(ctx, status as InvoiceStatusFilter);
    return NextResponse.json({ from_date: ctx.fromDate, to_date: ctx.toDate, branch_id: ctx.branchId, invoices, totals });
  } catch (error: any) {
    return handleSalesReportError('invoice-wise sales report', error);
  }
}
