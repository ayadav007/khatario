import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { buildCashFlow, type CfAccount, type CfLine } from '@/lib/reports/cash-flow';
import { buildProfitAndLoss, type BranchScope } from '@/lib/reports/profit-loss';

export const dynamic = 'force-dynamic';

const OPENING_VOUCHERS = ['opening_balance', 'opening_stock'];

function lineAmount(lines: CfLine[], label: string) {
  return lines.find((l) => l.label === label)?.amount ?? 0;
}

/**
 * GET /api/reports/cash-flow
 * Indirect-method cash flow statement.
 * branch_id omitted or "ALL" is the whole company.
 * The default branch also includes company lines that have no branch (opening stock,
 * opening balances), so Main Branch plus every other branch equals All Branches.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    let fromDate = searchParams.get('from_date');
    let toDate = searchParams.get('to_date');

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
    let branchFilter: string | null = null;
    let includeUnassigned = false;
    let accessibleBranchIds: string[] | null = null;

    if (!isConsolidatedView) {
      const { resolveBranchId, isDefaultBranch } = await import('@/lib/branch-helpers');
      try {
        branchFilter = await resolveBranchId({ branchId: branchIdParam, businessId });
        includeUnassigned = await isDefaultBranch(branchFilter, businessId);
      } catch (error: any) {
        if (['BRANCH_NOT_FOUND', 'BRANCH_BUSINESS_MISMATCH', 'BRANCH_INACTIVE'].includes(error.code)) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error.code === 'NO_DEFAULT_BRANCH') {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        throw error;
      }
    } else {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const accessible = await getUserAccessibleBranchIds(userId);
      if (accessible.length > 0) accessibleBranchIds = accessible;
    }

    try {
      await authorize(userId, 'report.financial', 'read', {
        businessId,
        branchId: branchFilter ?? undefined,
        resource: { business_id: businessId, branch_id: branchFilter },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    if (!fromDate || !toDate) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const fyStart = new Date(currentYear, 3, 1);
      if (!fromDate) {
        const startDate = now < fyStart ? new Date(currentYear - 1, 3, 1) : fyStart;
        fromDate = startDate.toISOString().split('T')[0];
      }
      if (!toDate) toDate = now.toISOString().split('T')[0];
    }

    const params: any[] = [businessId, fromDate, toDate, OPENING_VOUCHERS];
    let branchClause = '';
    if (branchFilter && includeUnassigned) {
      branchClause = 'AND (lel.branch_id = $5::uuid OR lel.branch_id IS NULL)';
      params.push(branchFilter);
    } else if (branchFilter) {
      branchClause = 'AND lel.branch_id = $5::uuid';
      params.push(branchFilter);
    } else if (accessibleBranchIds) {
      branchClause = 'AND (lel.branch_id = ANY($5::uuid[]) OR lel.branch_id IS NULL)';
      params.push(accessibleBranchIds);
    }

    const rows = await queryRows<{
      account_code: string;
      account_name: string;
      account_type: string;
      group_code: string | null;
      is_cash: boolean;
      opening: string;
      period_debit: string;
      period_credit: string;
    }>(
      `
      WITH lines AS (
        SELECT lel.account_id, lel.debit, lel.credit,
          (lel.entry_date < $2::date OR lel.voucher_type = ANY($4::text[])) AS is_opening,
          lel.voucher_type
        FROM ledger_entry_lines lel
        WHERE lel.business_id = $1
          AND lel.entry_date <= $3::date
          ${branchClause}
      )
      SELECT
        a.account_code,
        a.account_name,
        a.account_type,
        ag.group_code,
        (
          a.account_code LIKE '1101%' OR a.account_code LIKE '1102%' OR a.account_code LIKE '2112%'
          OR EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.business_id = a.business_id AND ba.ledger_account_id = a.id)
          OR (a.account_type = 'asset' AND COALESCE(ag.group_code, '1100') LIKE '1100%'
              AND (a.account_name ILIKE '%cash%' OR a.account_name ILIKE '%bank%')
              AND a.account_name NOT ILIKE '%receivable%')
        ) AS is_cash,
        COALESCE(SUM(CASE WHEN l.is_opening THEN l.debit - l.credit ELSE 0 END), 0) AS opening,
        COALESCE(SUM(CASE WHEN NOT l.is_opening AND l.voucher_type <> 'year_close' THEN l.debit ELSE 0 END), 0) AS period_debit,
        COALESCE(SUM(CASE WHEN NOT l.is_opening AND l.voucher_type <> 'year_close' THEN l.credit ELSE 0 END), 0) AS period_credit
      FROM lines l
      JOIN accounts a ON a.id = l.account_id
      LEFT JOIN account_groups ag ON ag.id = a.account_group_id
      GROUP BY a.id, a.account_code, a.account_name, a.account_type, ag.group_code
      `,
      params
    );

    const accounts: CfAccount[] = rows.map((r) => ({
      code: r.account_code,
      name: r.account_name,
      type: r.account_type,
      groupCode: r.group_code,
      isCash: r.is_cash,
      opening: Number(r.opening) || 0,
      periodDebit: Number(r.period_debit) || 0,
      periodCredit: Number(r.period_credit) || 0,
    }));

    const branchScope: BranchScope = branchFilter
      ? { kind: 'branches', branchIds: [branchFilter], includeUnbranched: includeUnassigned }
      : accessibleBranchIds
        ? { kind: 'branches', branchIds: accessibleBranchIds, includeUnbranched: true }
        : { kind: 'all' };
    const pl = await buildProfitAndLoss({
      businessId,
      fromDate,
      toDate,
      branch: branchScope,
      consolidated: isConsolidatedView,
    });
    const cf = buildCashFlow(accounts, { inventoryAdjustment: pl.ledger_check.inventory_adjustment });
    const wc = cf.operating.workingCapital;
    const receivables = -lineAmount(wc, 'Trade receivables');
    const payables = lineAmount(wc, 'Trade payables');
    const inventory = -lineAmount(wc, 'Inventories');
    const capital = lineAmount(cf.financing.lines, 'Capital introduced (net)') + lineAmount(cf.financing.lines, 'Drawings');

    return NextResponse.json({
      period: { from_date: fromDate, to_date: toDate },
      branch_id: branchFilter,
      opening_cash_balance: cf.openingCash,
      operating_activities: {
        net_profit: cf.netProfit,
        depreciation: lineAmount(cf.operating.adjustments, 'Add: depreciation'),
        adjustments: cf.operating.adjustments,
        working_capital_lines: wc,
        changes_in_working_capital: {
          receivables_increase: receivables > 0 ? receivables : 0,
          receivables_decrease: receivables < 0 ? -receivables : 0,
          payables_increase: payables > 0 ? payables : 0,
          payables_decrease: payables < 0 ? -payables : 0,
          inventory_increase: inventory > 0 ? inventory : 0,
          inventory_decrease: inventory < 0 ? -inventory : 0,
        },
        net_cash_from_operating: cf.operating.total,
      },
      investing_activities: {
        lines: cf.investing.lines,
        fixed_asset_purchases: -lineAmount(cf.investing.lines, 'Purchase of fixed assets'),
        fixed_asset_sales: lineAmount(cf.investing.lines, 'Sale of fixed assets'),
        net_cash_from_investing: cf.investing.total,
      },
      financing_activities: {
        lines: cf.financing.lines,
        capital_introduced: capital,
        loans_taken: lineAmount(cf.financing.lines, 'Long-term borrowings (net)'),
        net_cash_from_financing: cf.financing.total,
      },
      net_cash_flow: cf.netCashFlow,
      closing_cash_balance: cf.closingCash,
      calculated_closing_balance: Math.round((cf.openingCash + cf.netCashFlow) * 100) / 100,
      unreconciled_difference: cf.difference,
    });
  } catch (error: any) {
    console.error('Error generating cash flow statement:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
