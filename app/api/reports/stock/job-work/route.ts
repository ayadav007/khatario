import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { jobWorkRegister } from '@/lib/stock-custody/job-work';
import { authorizeStockReport } from '@/lib/stock-custody/report-auth';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/reports/stock/job-work?from=&to=&as_of=
 * ITC-04 lists (sent to and received from job workers in the period) and goods still out with
 * their s.143 deadline as of a date.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeStockReport(request);
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const asOf = sp.get('as_of') || new Date().toISOString().slice(0, 10);
  if (!DATE.test(from) || !DATE.test(to) || !DATE.test(asOf) || from > to) {
    return NextResponse.json({ error: 'from, to and as_of must be YYYY-MM-DD, from on or before to' }, { status: 400 });
  }
  try {
    return NextResponse.json({ from, to, as_of: asOf, ...(await jobWorkRegister(getPool(), auth.businessId, { from, to, asOf })) });
  } catch (error: any) {
    console.error('Error building job work register:', error);
    return NextResponse.json({ error: 'Failed to build the job work register', details: error?.message }, { status: 500 });
  }
}
