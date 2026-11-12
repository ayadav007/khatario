import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { calculateCreditMetrics } from '@/lib/credit-utils';
import { buildAgeing, type AgeingPartySummary } from '@/lib/reports/ageing';
import { fetchPartyLedgerDocs, type PartyType } from '@/lib/reports/party-ledger-docs';
import { customerReceivableAccountMap, receivableAccountFilter } from '@/lib/accounting/receivable-accounts';
import { parseReceivableAccountId, receivableAccountErrorResponse } from '@/lib/customers/receivable-account-request';

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

    let aging: Array<ReturnType<typeof agingEntry> & Record<string, unknown>> = summary
      .map((s) => agingEntry(partyType, s, s.party_id ? limits.get(s.party_id) ?? 0 : null))
      .sort((a, b) => b.total_outstanding - a.total_outstanding);

    let reportTotals = {
      total_outstanding: totals.total,
      bucket_not_due: totals.not_due,
      bucket_0_30: totals.age_0_30,
      bucket_31_60: totals.age_30_60,
      bucket_61_90: totals.age_60_90,
      bucket_90_plus: totals.age_90_plus,
      on_account: totals.on_account,
      overdue: r2(totals.age_0_30 + totals.age_30_60 + totals.age_60_90 + totals.age_90_plus),
    };

    // Receivables can be split over accounts under Accounts Receivable (Domestic Debtors,
    // Foreign Debtors, ...). Each customer is shown under the account they post to today.
    let byAccount: Array<{
      account_id: string | null;
      account_code: string | null;
      account_name: string | null;
      total_outstanding: number;
      overdue: number;
    }> = [];
    if (partyType === 'customer') {
      const accounts = await customerReceivableAccountMap(businessId, partyIds);
      aging = aging.map((row) => {
        const accountId = (row.party_id && accounts.byCustomer.get(row.party_id as string)) || accounts.controlAccountId;
        const account = accountId ? accounts.accounts.get(accountId) : undefined;
        return {
          ...row,
          receivable_account_id: accountId ?? null,
          receivable_account_code: account?.account_code ?? null,
          receivable_account_name: account?.account_name ?? null,
        };
      });

      const accountFilter = searchParams.get('receivable_account_id');
      if (accountFilter) {
        try {
          const accountId = parseReceivableAccountId(accountFilter);
          if (accountId) {
            const keep = await receivableAccountFilter(businessId, accountId);
            aging = aging.filter((row) =>
              keep.includesUnassigned
                ? row.receivable_account_id === accounts.controlAccountId
                : keep.accountIds.includes(row.receivable_account_id as string)
            );
            const sumOf = (key: keyof typeof reportTotals) => r2(aging.reduce((s, row) => s + (Number(row[key]) || 0), 0));
            reportTotals = {
              total_outstanding: sumOf('total_outstanding'),
              bucket_not_due: sumOf('bucket_not_due'),
              bucket_0_30: sumOf('bucket_0_30'),
              bucket_31_60: sumOf('bucket_31_60'),
              bucket_61_90: sumOf('bucket_61_90'),
              bucket_90_plus: sumOf('bucket_90_plus'),
              on_account: sumOf('on_account'),
              overdue: sumOf('overdue'),
            };
          }
        } catch (error) {
          const refused = receivableAccountErrorResponse(error);
          if (refused) return refused;
          throw error;
        }
      }

      const groups = new Map<string, (typeof byAccount)[number]>();
      for (const row of aging) {
        const key = (row.receivable_account_id as string | null) ?? '';
        const group = groups.get(key) ?? {
          account_id: (row.receivable_account_id as string | null) ?? null,
          account_code: (row.receivable_account_code as string | null) ?? null,
          account_name: (row.receivable_account_name as string | null) ?? null,
          total_outstanding: 0,
          overdue: 0,
        };
        group.total_outstanding = r2(group.total_outstanding + row.total_outstanding);
        group.overdue = r2(group.overdue + row.overdue);
        groups.set(key, group);
      }
      byAccount = [...groups.values()].sort((a, b) =>
        String(a.account_code ?? '').localeCompare(String(b.account_code ?? ''), undefined, { numeric: true })
      );
    }

    return NextResponse.json({
      party_type: partyType,
      as_on_date: asOnDate,
      branch_id: branchFilter,
      aging_by: 'due_date',
      aging,
      totals: reportTotals,
      ...(partyType === 'customer' ? { by_account: byAccount } : {}),
      // The whole receivable (or payable) ledger, whatever account filter is applied.
      gl_balance: r2(docs.reduce((s, d) => s + d.amount, 0)),
    });
  } catch (error: any) {
    console.error(`Error generating ${partyType === 'customer' ? 'receivables' : 'payables'} aging:`, error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
