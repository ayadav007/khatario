import { NextRequest, NextResponse } from 'next/server';
import { resolvePlRequestScope } from '@/lib/reports/pl-request-scope';
import { CompareInputError, parseCompareRequest } from '@/lib/reports/pl-compare-periods';
import { buildComparison } from '@/lib/reports/profit-loss-compare';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/profit-loss/compare
 * The Profit & Loss of the chosen period beside one to three other periods.
 */
export async function GET(request: NextRequest) {
  try {
    const scope = await resolvePlRequestScope(request);
    if (scope instanceof NextResponse) return scope;

    const params = request.nextUrl.searchParams;
    let parsed;
    try {
      parsed = parseCompareRequest({
        from_date: scope.fromDate,
        to_date: scope.toDate,
        compare: params.get('compare'),
        count: params.get('count'),
        compare_from: params.get('compare_from'),
        compare_to: params.get('compare_to'),
      });
    } catch (error) {
      if (error instanceof CompareInputError) {
        return NextResponse.json({ error: error.message, code: 'INVALID_COMPARE_REQUEST' }, { status: 400 });
      }
      throw error;
    }

    const comparison = await buildComparison({
      businessId: scope.businessId,
      branch: scope.branch,
      consolidated: scope.consolidated,
      periods: parsed.periods,
      includeZero: params.get('include_zero') === 'true',
    });

    return NextResponse.json({
      branch: scope.branchInfo,
      is_consolidated: scope.consolidated,
      compare: parsed.mode,
      ...comparison,
    });
  } catch (error: any) {
    console.error('Error generating Profit & Loss comparison:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate profit and loss comparison' }, { status: 500 });
  }
}
