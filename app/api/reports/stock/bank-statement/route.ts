import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { bankStockStatement } from '@/lib/reports/stock-audit-reports';
import { authorizeStockReport } from '@/lib/stock-custody/report-auth';

export const dynamic = 'force-dynamic';

const pct = (v: string | null, fallback: number) => {
  const n = v === null || v === '' ? fallback : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
};

/**
 * GET /api/reports/stock/bank-statement?as_of=&stock_margin=25&debtor_margin=25&debtor_age=90
 * Stock statement for the bank with an indicative drawing power.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeStockReport(request);
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const asOf = sp.get('as_of') || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: 'as_of must be YYYY-MM-DD' }, { status: 400 });
  const age = Number(sp.get('debtor_age') || 90);
  try {
    const statement = await bankStockStatement(getPool(), auth.businessId, asOf, {
      stockMarginPct: pct(sp.get('stock_margin'), 25),
      debtorMarginPct: pct(sp.get('debtor_margin'), 25),
      debtorAgeLimitDays: age === 30 || age === 60 ? age : 90,
    });
    return NextResponse.json(statement);
  } catch (error: any) {
    console.error('Error building bank stock statement:', error);
    return NextResponse.json({ error: 'Failed to build the stock statement', details: error?.message }, { status: 500 });
  }
}
