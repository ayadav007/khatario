import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { buildAgeing } from '@/lib/reports/ageing';
import { fetchPartyLedgerDocs } from '@/lib/reports/party-ledger-docs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/party/ageing?party_type=customer|supplier&as_of_date=YYYY-MM-DD[&branch_id=]
 * Open items as of the date, aged from due date (or document date). Totals equal the
 * Accounts Receivable (1103) / Accounts Payable (2101) GL balance on that date.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const partyType = searchParams.get('party_type');
    const asOfDate = searchParams.get('as_of_date') || new Date().toISOString().split('T')[0];

    if (!businessId || (partyType !== 'customer' && partyType !== 'supplier')) {
      return NextResponse.json({ error: 'business_id and party_type (customer|supplier) are required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      return NextResponse.json({ error: 'as_of_date must be YYYY-MM-DD' }, { status: 400 });
    }

    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }

    let branchFilter: string | null = null;
    if (branchIdParam) {
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      try {
        branchFilter = await resolveBranchId({ branchId: branchIdParam, businessId });
      } catch (error: any) {
        if (['BRANCH_NOT_FOUND', 'BRANCH_BUSINESS_MISMATCH', 'BRANCH_INACTIVE'].includes(error.code)) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        throw error;
      }
    }

    try {
      await authorize(userId, 'report', 'read', {
        businessId,
        branchId: branchFilter ?? undefined,
        resource: { business_id: businessId, branch_id: branchFilter },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const docs = await fetchPartyLedgerDocs({ businessId, partyType, asOfDate, branchId: branchFilter });

    const { summary, totals } = buildAgeing(docs, asOfDate);
    const glBalance = Math.round(docs.reduce((s, d) => s + d.amount, 0) * 100) / 100;

    return NextResponse.json({
      party_type: partyType,
      as_of_date: asOfDate,
      branch_id: branchFilter,
      summary,
      totals,
      gl_balance: glBalance,
    });
  } catch (error: any) {
    console.error('Error generating ageing report:', error);
    return NextResponse.json({ error: 'Failed to generate report', details: error.message }, { status: 500 });
  }
}
