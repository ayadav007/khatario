import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { internalApiFetchFromRequest } from '@/lib/internal-api-fetch';
import { generateProfitLossExcel } from '@/lib/export/profit-loss-excel';

export const dynamic = 'force-dynamic';

/** GET /api/reports/profit-loss/excel — the P&L in the Zoho layout as .xlsx. */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = getBusinessIdFromRequest(req);
    const userId = getUserIdFromRequest(req);
    const branchIdParam = searchParams.get('branch_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

    if (!businessId || !fromDate || !toDate) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }

    const consolidated = !branchIdParam || branchIdParam.toUpperCase() === 'ALL';
    let branchId: string | null = null;
    if (!consolidated) {
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      try {
        branchId = await resolveBranchId({ branchId: branchIdParam, businessId });
      } catch (error: any) {
        if (['BRANCH_NOT_FOUND', 'BRANCH_BUSINESS_MISMATCH', 'BRANCH_INACTIVE'].includes(error.code)) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error.code === 'NO_DEFAULT_BRANCH') {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        throw error;
      }
    }

    try {
      await authorize(userId, 'report.financial', 'export', {
        businessId,
        branchId: branchId ?? undefined,
        resource: { business_id: businessId, branch_id: branchId },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const plQs = new URLSearchParams({
      business_id: businessId,
      user_id: userId,
      from_date: fromDate,
      to_date: toDate,
      branch_id: branchId ?? 'ALL',
    });
    const financialYear = searchParams.get('financial_year');
    if (financialYear) plQs.set('financial_year', financialYear);
    if (searchParams.get('include_zero') === 'true') plQs.set('include_zero', 'true');

    const apiRes = await internalApiFetchFromRequest(req, `/api/reports/profit-loss?${plQs.toString()}`);
    if (!apiRes.ok) {
      const body = await apiRes.json().catch(() => null);
      return NextResponse.json(
        { error: body?.error || body?.message || 'Failed to fetch P&L data' },
        { status: apiRes.status }
      );
    }
    const data = await apiRes.json();

    const business = await db.queryOne<{ name: string }>('SELECT name FROM businesses WHERE id = $1', [businessId]);
    const buffer = await generateProfitLossExcel(data, {
      businessName: business?.name ?? '',
      fromLabel: format(new Date(data.period.from_date), 'dd/MM/yyyy'),
      toLabel: format(new Date(data.period.to_date), 'dd/MM/yyyy'),
    });

    return new NextResponse(buffer as any, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Profit-Loss-${fromDate}-to-${toDate}.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error('Error generating P&L Excel:', error);
    return NextResponse.json({ error: error.message || 'Failed to export P&L' }, { status: 500 });
  }
}
