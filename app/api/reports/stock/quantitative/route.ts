import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { quantitativeDetails } from '@/lib/reports/stock-audit-reports';
import { authorizeStockReport } from '@/lib/stock-custody/report-auth';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/reports/stock/quantitative?from=&to= — Form 3CD clause 35(a) quantity details. */
export async function GET(request: NextRequest) {
  const auth = await authorizeStockReport(request);
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  if (!DATE.test(from) || !DATE.test(to) || from > to) {
    return NextResponse.json({ error: 'from and to must be YYYY-MM-DD, from on or before to' }, { status: 400 });
  }
  try {
    const rows = await quantitativeDetails(getPool(), auth.businessId, from, to);
    return NextResponse.json({ from, to, rows });
  } catch (error: any) {
    console.error('Error building quantitative details:', error);
    return NextResponse.json({ error: 'Failed to build quantitative details', details: error?.message }, { status: 500 });
  }
}
