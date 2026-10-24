import { NextRequest, NextResponse } from 'next/server';
import { handleReportError, resolveReportContext } from '@/lib/reports/report-context';
import { purchasesByItem } from '@/lib/reports/purchase-reports';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/purchase/item-wise?from_date&to_date[&branch_id]
 * Purchases by item, net of returned quantity and value (Zoho "Purchases by Item"). No branch_id = all branches.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveReportContext(request);
    if (ctx instanceof NextResponse) return ctx;
    const result = await purchasesByItem(ctx);
    return NextResponse.json({ from_date: ctx.fromDate, to_date: ctx.toDate, branch_id: ctx.branchId, ...result });
  } catch (error: any) {
    return handleReportError('item-wise purchase report', error);
  }
}
