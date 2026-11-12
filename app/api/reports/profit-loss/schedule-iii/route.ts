import { NextRequest, NextResponse } from 'next/server';
import { resolvePlRequestScope } from '@/lib/reports/pl-request-scope';
import { previousFinancialYear } from '@/lib/reports/profit-loss';
import { buildSchedule3, shiftYearBack } from '@/lib/reports/schedule3-pl';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/profit-loss/schedule-iii
 * The Statement of Profit and Loss in the Schedule III layout, for the period and for the same
 * dates one year earlier.
 */
export async function GET(request: NextRequest) {
  try {
    const scope = await resolvePlRequestScope(request);
    if (scope instanceof NextResponse) return scope;

    const base = {
      businessId: scope.businessId,
      branch: scope.branch,
      consolidated: scope.consolidated,
    };
    const previousFrom = shiftYearBack(scope.fromDate);
    const previousTo = shiftYearBack(scope.toDate);

    const current = await buildSchedule3({
      ...base,
      fromDate: scope.fromDate,
      toDate: scope.toDate,
      financialYear: scope.financialYear,
    });
    const previous = await buildSchedule3({
      ...base,
      fromDate: previousFrom,
      toDate: previousTo,
      financialYear: previousFinancialYear(scope.financialYear) ?? null,
    });

    return NextResponse.json({
      period: { from_date: scope.fromDate, to_date: scope.toDate, financial_year: scope.financialYear },
      previous_period: { from_date: previousFrom, to_date: previousTo },
      branch: scope.branchInfo,
      is_consolidated: scope.consolidated,
      current: current.statement,
      previous: previous.statement,
      agreement: { standard_net_profit: current.standard_net_profit, difference: current.difference },
    });
  } catch (error: any) {
    console.error('Error generating Schedule III P&L:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate Schedule III profit and loss' }, { status: 500 });
  }
}
