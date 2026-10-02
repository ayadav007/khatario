import { NextRequest, NextResponse } from 'next/server';
import { handleReportError, resolveReportContext } from '@/lib/reports/report-context';
import { billDetails, BILL_STATUSES, type BillStatusFilter } from '@/lib/reports/purchase-reports';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/purchase/invoice-wise?from_date&to_date[&status=all|draft|final|cancelled][&branch_id]
 * Bill details: every bill with its status (Zoho "Bill Details"); totals cover posted bills only.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveReportContext(request);
    if (ctx instanceof NextResponse) return ctx;
    const status = new URL(request.url).searchParams.get('status') || 'all';
    if (status !== 'all' && !(BILL_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'status must be all, draft, final or cancelled' }, { status: 400 });
    }
    const result = await billDetails(ctx, status as BillStatusFilter);
    return NextResponse.json({
      from_date: ctx.fromDate,
      to_date: ctx.toDate,
      branch_id: ctx.branchId,
      purchases: result.bills,
      totals: result.totals,
    });
  } catch (error: any) {
    return handleReportError('purchase bill details report', error);
  }
}
