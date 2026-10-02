import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { calculateCreditMetrics } from '@/lib/credit-utils';
import { buildAgeing, type AgeingPartySummary } from '@/lib/reports/ageing';
import { fetchPartyLedgerDocs, type PartyType } from '@/lib/reports/party-ledger-docs';

const r2 = (n: number) => Math.round(n * 100) / 100;

function agingEntry(partyType: PartyType, s: AgeingPartySummary, creditLimit: number | null) {
  const idKey = partyType === 'customer' ? 'customer_id' : 'supplier_id';
  const nameKey = partyType === 'customer' ? 'customer_name' : 'supplier_name';
  const metrics = calculateCreditMetrics(creditLimit ?? 0, s.total);
  return {
    [idKey]: s.party_id,
    [nameKey]: s.party_name,
    party_id: s.party_id,
    party_name: s.party_name,
    party_phone: s.party_phone,
    total_outstanding: s.total,
    bucket_not_due: s.not_due,
    bucket_0_30: s.age_0_30,
    bucket_31_60: s.age_30_60,
    bucket_61_90: s.age_60_90,
    bucket_90_plus: s.age_90_plus,
    on_account: s.on_account,
    overdue: r2(s.age_0_30 + s.age_30_60 + s.age_60_90 + s.age_90_plus),
    transactions: s.transactions,
    credit_limit: metrics.credit_limit,
    credit_utilization_percent: metrics.credit_utilization_percent,
    credit_status: metrics.credit_status,
  };
}

/**
 * GET /api/reports/aging/receivables | payables
 *   ?as_on_date=YYYY-MM-DD[&branch_id=][&customer_id= | &supplier_id=]
 *
 * Ledger-based: open items come from Accounts Receivable (1103) / Payable (2101) lines up to the
 * date, so the report total equals the control-account balance and the balance sheet. Items are
 * aged from their due date; no branch_id means all branches.
 */
export async function handleAgingReport(request: NextRequest, partyType: PartyType) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];
    const partyId = searchParams.get(partyType === 'customer' ? 'customer_id' : 'supplier_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOnDate)) {
      return NextResponse.json({ error: 'as_on_date must be YYYY-MM-DD' }, { status: 400 });
    }

    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }

    let branchFilter: string | null = null;
    if (branchIdParam && branchIdParam !== 'ALL' && branchIdParam !== 'all') {
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

    const docs = await fetchPartyLedgerDocs({ businessId, partyType, asOfDate: asOnDate, branchId: branchFilter, partyId });
    const { summary, totals } = buildAgeing(docs, asOnDate);

    const partyIds = summary.map((s) => s.party_id).filter((id): id is string => !!id);
    const limits = new Map<string, number>();
    if (partyIds.length > 0) {
      const rows = await queryRows<{ id: string; credit_limit: string | null }>(
        `SELECT id, credit_limit FROM ${partyType === 'customer' ? 'customers' : 'suppliers'}
          WHERE business_id = $1 AND id = ANY($2::uuid[])`,
        [businessId, partyIds]
      );
      for (const r of rows) limits.set(r.id, Number(r.credit_limit) || 0);
    }

    const aging = summary
      .map((s) => agingEntry(partyType, s, s.party_id ? limits.get(s.party_id) ?? 0 : null))
      .sort((a, b) => b.total_outstanding - a.total_outstanding);

    return NextResponse.json({
      party_type: partyType,
      as_on_date: asOnDate,
      branch_id: branchFilter,
      aging_by: 'due_date',
      aging,
      totals: {
        total_outstanding: totals.total,
        bucket_not_due: totals.not_due,
        bucket_0_30: totals.age_0_30,
        bucket_31_60: totals.age_30_60,
        bucket_61_90: totals.age_60_90,
        bucket_90_plus: totals.age_90_plus,
        on_account: totals.on_account,
        overdue: r2(totals.age_0_30 + totals.age_30_60 + totals.age_60_90 + totals.age_90_plus),
      },
      gl_balance: r2(docs.reduce((s, d) => s + d.amount, 0)),
    });
  } catch (error: any) {
    console.error(`Error generating ${partyType === 'customer' ? 'receivables' : 'payables'} aging:`, error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
