import { NextRequest, NextResponse } from 'next/server';
import { handleReportError, resolveReportContext } from '@/lib/reports/report-context';
import { purchaseSummary, type PurchasePeriod } from '@/lib/reports/purchase-reports';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/purchase/summary?from_date&to_date[&period=day|week|month][&branch_id]
 * Purchases by period: posted bills less purchase returns. No branch_id = all branches.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveReportContext(request);
    if (ctx instanceof NextResponse) return ctx;
    const p = new URL(request.url).searchParams.get('period') || 'day';
    if (!['day', 'week', 'month'].includes(p)) {
      return NextResponse.json({ error: 'period must be day, week or month' }, { status: 400 });
    }
    const result = await purchaseSummary(ctx, p as PurchasePeriod);
    return NextResponse.json({ from_date: ctx.fromDate, to_date: ctx.toDate, branch_id: ctx.branchId, ...result });
  } catch (error: any) {
    return handleReportError('purchase summary report', error);
  }
}
