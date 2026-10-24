import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { getFixedAssetsSummary } from '@/lib/services/depreciation-calculator';
import { getTotalProvisions } from '@/lib/services/provisions-manager';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assembleBalanceSheet, financialYearStartFor, type BsAccountRow } from '@/lib/reports/balance-sheet';
import { loadGroupMap } from '@/lib/reports/account-groups';
import { buildProfitAndLoss, type BranchScope } from '@/lib/reports/profit-loss';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/balance-sheet
 * Every asset, liability and capital account at its ledger balance, grouped by its account group.
 * Current-year profit comes from the Profit & Loss engine for the same branch scope, so the two
 * reports always agree.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];
    const financialYear = searchParams.get('financial_year');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
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

    const isConsolidatedView = !branchIdParam || branchIdParam.toLowerCase() === 'all';
    let finalBranchId: string | null = null;
    let includeUnbranched = false;
    let accessibleBranchIds: string[] | null = null;
    let branchInfo: any = null;

    if (!isConsolidatedView) {
      const { resolveBranchId, isDefaultBranch } = await import('@/lib/branch-helpers');
      try {
        finalBranchId = await resolveBranchId({ branchId: branchIdParam, businessId });
        includeUnbranched = await isDefaultBranch(finalBranchId, businessId);
      } catch (error: any) {
        if (['BRANCH_NOT_FOUND', 'BRANCH_BUSINESS_MISMATCH', 'BRANCH_INACTIVE'].includes(error.code)) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error.code === 'NO_DEFAULT_BRANCH') {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        throw error;
      }
      branchInfo = await queryOne(
        `SELECT id, name, branch_code, gstin FROM branches WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [finalBranchId, businessId]
      );
      if (!branchInfo) {
        return NextResponse.json({ error: 'Branch not found or inactive' }, { status: 404 });
      }
    } else {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const accessible = await getUserAccessibleBranchIds(userId);
      if (accessible.length > 0) accessibleBranchIds = accessible;
    }

    try {
      await authorize(userId, 'report.financial', 'read', {
        businessId,
        branchId: finalBranchId || undefined,
        resource: { business_id: businessId, branch_id: finalBranchId || undefined },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    let fyStart = financialYear && /^\d{4}/.test(financialYear) ? `${financialYear.slice(0, 4)}-04-01` : null;
    if (!fyStart) {
      const fy = await queryOne<{ start_date: string }>(
        `SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date FROM financial_years
          WHERE business_id = $1 AND start_date <= $2::date AND end_date >= $2::date
          ORDER BY start_date DESC LIMIT 1`,
        [businessId, asOnDate]
      ).catch(() => null);
      fyStart = fy?.start_date || financialYearStartFor(asOnDate);
    }

    const params: unknown[] = [businessId, asOnDate, fyStart];
    let branchSql = '';
    if (finalBranchId) {
      params.push(finalBranchId);
      branchSql = includeUnbranched ? 'AND (l.branch_id = $4 OR l.branch_id IS NULL)' : 'AND l.branch_id = $4';
    } else if (accessibleBranchIds) {
      params.push(accessibleBranchIds);
      branchSql = 'AND (l.branch_id = ANY($4::uuid[]) OR l.branch_id IS NULL)';
    }

    // A year-close voucher inside the current year is left out: the P&L below still reports that
    // year's profit, and counting the transfer into Retained Earnings as well would double it.
    const rows = await queryRows<any>(
      `SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_group_id, a.nature, a.is_active,
              ag.group_name AS account_group_name,
              COALESCE(SUM(l.debit), 0)::float AS debit,
              COALESCE(SUM(l.credit), 0)::float AS credit,
              COUNT(l.id)::int AS line_count
         FROM accounts a
         LEFT JOIN account_groups ag ON ag.id = a.account_group_id
         LEFT JOIN ledger_entry_lines l
                ON l.account_id = a.id AND l.business_id = a.business_id
               AND l.entry_date <= $2::date
               AND NOT (l.voucher_type = 'year_close' AND l.entry_date >= $3::date)
               ${branchSql}
        WHERE a.business_id = $1 AND a.account_type IN ('asset', 'liability', 'capital')
        GROUP BY a.id, ag.group_name
       HAVING a.is_active = true OR COUNT(l.id) > 0
        ORDER BY a.account_code`,
      params
    );

    const previous = await queryOne<{ profit: string }>(
      `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS profit
         FROM ledger_entry_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.business_id = $1
          AND l.entry_date < $3::date AND l.entry_date <= $2::date
          AND a.account_type IN ('income', 'expense')
          ${branchSql}`,
      params
    );

    const branchScope: BranchScope = finalBranchId
      ? { kind: 'branches', branchIds: [finalBranchId], includeUnbranched }
      : accessibleBranchIds
        ? { kind: 'branches', branchIds: accessibleBranchIds, includeUnbranched: true }
        : { kind: 'all' };
    const pl = await buildProfitAndLoss({
      businessId,
      fromDate: fyStart,
      toDate: asOnDate,
      branch: branchScope,
      consolidated: isConsolidatedView,
      financialYear,
    });

    const groups = await loadGroupMap(businessId);
    const accountRows: BsAccountRow[] = rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
    const bs = assembleBalanceSheet(accountRows, groups, {
      previousYearsProfit: Number(previous?.profit || 0),
      currentYearProfit: pl.net_profit,
      inventoryAdjustment: pl.ledger_check.inventory_adjustment,
    });

    // Register detail is informational; the totals above come from the ledger.
    let fixedAssetRegister = null;
    try {
      fixedAssetRegister = await getFixedAssetsSummary(businessId, asOnDate);
    } catch (error) {
      console.error('Error fetching fixed assets summary:', error);
    }
    let provisionsRegister = null;
    if (financialYear) {
      try {
        provisionsRegister = await getTotalProvisions(businessId, financialYear);
      } catch (error) {
        console.error('Error fetching provisions:', error);
      }
    }

    return NextResponse.json({
      branch: branchInfo
        ? { id: branchInfo.id, name: branchInfo.name, branch_code: branchInfo.branch_code, gstin: branchInfo.gstin }
        : null,
      is_consolidated: isConsolidatedView,
      as_on_date: asOnDate,
      financial_year: financialYear,
      financial_year_start: fyStart,
      inventory_model: pl.inventory_model,
      ...bs,
      registers: {
        fixed_assets: fixedAssetRegister
          ? {
              gross_block: fixedAssetRegister.grossBlock,
              accumulated_depreciation: fixedAssetRegister.accumulatedDepreciation,
              net_block: fixedAssetRegister.netBlock,
              assets: fixedAssetRegister.assets,
            }
          : null,
        provisions: provisionsRegister,
      },
    });
  } catch (error: any) {
    console.error('Error generating balance sheet:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
