import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryOne } from '@/lib/db';
import { getTotalProvisions } from '@/lib/services/provisions-manager';
import { getAllTaxProvisions } from '@/lib/services/tax-provision-calculator';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { CREDIT_SECTIONS } from '@/lib/accounting/pl-sections';
import {
  buildProfitAndLoss,
  flattenNodes,
  REPORT_SECTIONS,
  type BranchScope,
  type PlAccountNode,
  type ProfitAndLoss,
} from '@/lib/reports/profit-loss';

export const dynamic = 'force-dynamic';

const r2 = (n: number) => Math.round(n * 100) / 100;

function legacyAccounts(nodes: PlAccountNode[]) {
  return flattenNodes(nodes).map((n) => ({
    id: n.id,
    account_code: n.account_code,
    account_name: n.account_name,
    account_type: n.account_type,
    account_group_name: n.account_group_name,
    is_active: n.is_active,
    amount: n.amount,
  }));
}

/** Movement of one account as an expense (debit − credit), wherever it is placed. */
function expenseAmountOf(pl: ProfitAndLoss, code: string): number {
  for (const key of REPORT_SECTIONS) {
    const node = flattenNodes(pl.sections[key].accounts).find((n) => n.account_code === code);
    if (node) return CREDIT_SECTIONS.has(key) ? -node.amount : node.amount;
  }
  return 0;
}

/**
 * GET /api/reports/profit-loss
 * Profit & Loss in Zoho Books' layout: each income/expense account is reported in its P&L section.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    let fromDate = searchParams.get('from_date');
    let toDate = searchParams.get('to_date');
    const financialYear = searchParams.get('financial_year');
    const includeZero = searchParams.get('include_zero') === 'true';

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
    const accessCheck = await checkEmployeeAccessBoundary(userId, 'portal');
    if (!accessCheck.allowed) {
      return NextResponse.json({ error: accessCheck.reason, code: 'ACCESS_DENIED' }, { status: 403 });
    }

    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // "ALL" or no branch = consolidated view (inter-branch accounts eliminated).
    const isConsolidatedView = !branchIdParam || branchIdParam === 'ALL' || branchIdParam === 'all';

    let finalBranchId: string | null = null;
    let branchInfo: any = null;
    let branchScope: BranchScope = { kind: 'all' };

    if (!isConsolidatedView) {
      const { resolveBranchId, isDefaultBranch } = await import('@/lib/branch-helpers');
      try {
        finalBranchId = await resolveBranchId({ branchId: branchIdParam, businessId });
        branchInfo = await queryOne(
          `SELECT id, name, branch_code, gstin
             FROM branches
            WHERE id = $1 AND business_id = $2 AND is_active = true`,
          [finalBranchId, businessId]
        );
        if (!branchInfo) {
          return NextResponse.json({ error: 'Branch not found or inactive' }, { status: 404 });
        }
        branchScope = {
          kind: 'branches',
          branchIds: [finalBranchId],
          // Business-level lines (opening balances, opening stock) carry no branch and belong to the default branch.
          includeUnbranched: await isDefaultBranch(finalBranchId, businessId),
        };
      } catch (error: any) {
        if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error.code === 'NO_DEFAULT_BRANCH') {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        throw error;
      }
    } else {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      if (accessibleBranchIds.length > 0) {
        branchScope = { kind: 'branches', branchIds: accessibleBranchIds, includeUnbranched: true };
      }
    }

    try {
      await authorize(userId, 'report.financial', 'read', {
        businessId,
        branchId: finalBranchId || undefined,
        resource: {
          business_id: businessId,
          branch_id: finalBranchId || undefined,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
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
      if (!toDate) {
        toDate = now.toISOString().split('T')[0];
      }
    }

    // A P&L is statutory only within one financial year; across 31 March the opening stock no longer
    // matches the purchases, so the report is computed but flagged.
    const warnings: Array<{ code: string; message: string; severity: 'info' | 'warn' | 'error' }> = [];
    {
      const fyOf = (iso: string) => {
        const y = Number(iso.slice(0, 4));
        const m = Number(iso.slice(5, 7));
        return m < 4 ? y - 1 : y;
      };
      const fromFY = fyOf(fromDate);
      const toFY = fyOf(toDate);
      if (fromFY !== toFY) {
        warnings.push({
          code: 'period_crosses_fy_boundary',
          severity: 'warn',
          message:
            `Reporting period (${fromDate} to ${toDate}) crosses a financial-year boundary ` +
            `(FY ${fromFY}-${(fromFY + 1).toString().slice(-2)} to ` +
            `FY ${toFY}-${(toFY + 1).toString().slice(-2)}). ` +
            `Opening Stock is taken as of ${fromDate} − 1 day, but Net Purchases include ` +
            `vouchers from both FYs. Numbers are management-style only and not suitable for ` +
            `statutory filing. For Tally-parity, run two separate P&Ls — one per FY.`,
        });
      }
    }

    const pl = await buildProfitAndLoss({
      businessId,
      fromDate,
      toDate,
      branch: branchScope,
      consolidated: isConsolidatedView,
      financialYear,
      includeZero,
    });
    const cogsData = pl.cogs_detail;

    if (pl.periodic_cogs && cogsData) {
      const hasInventoryActivity =
        (cogsData.purchases?.gross_purchases ?? 0) > 0.01 ||
        (cogsData.openingStock?.value ?? 0) > 0.01 ||
        (cogsData.closingStock?.value ?? 0) > 0.01;
      const closingSrc = cogsData.closingStock?.source;
      if (hasInventoryActivity && closingSrc && closingSrc !== 'snapshot') {
        warnings.push({
          code: 'closing_stock_not_formalized',
          severity: 'warn',
          message:
            'Closing stock for this period is derived from live inventory and purchase history, not from a formal year-end closing snapshot. ' +
            'Gross profit and COGS are management estimates until your CA finalizes physical stock valuation and (where applicable) records a year-end closing entry / snapshot.',
        });
      }
    }

    let provisionsData: Awaited<ReturnType<typeof getTotalProvisions>> | null = null;
    let taxData: Awaited<ReturnType<typeof getAllTaxProvisions>> | null = null;
    if (financialYear) {
      try {
        provisionsData = await getTotalProvisions(businessId, financialYear);
      } catch (error) {
        console.error('Error fetching provisions:', error);
      }
      try {
        taxData = await getAllTaxProvisions(businessId, financialYear);
      } catch (error) {
        console.error('Error fetching tax provisions:', error);
      }
    }

    const s = pl.sections;
    // Like Zoho there is no separate tax section: 5210/5211 sit in Non Operating Expense.
    // The legacy PBT/tax fields are derived for older clients.
    const currentTax = r2(expenseAmountOf(pl, '5210'));
    const deferredTax = r2(expenseAmountOf(pl, '5211'));
    const totalTax = r2(currentTax + deferredTax);
    const taxServiceCurrent = taxData?.current_tax?.provision_amount || 0;
    const taxServiceDeferred = taxData?.deferred_tax?.provision_amount || 0;

    return NextResponse.json({
      branch: branchInfo
        ? { id: branchInfo.id, name: branchInfo.name, branch_code: branchInfo.branch_code, gstin: branchInfo.gstin }
        : null,
      is_consolidated: isConsolidatedView,
      period: { from_date: fromDate, to_date: toDate, financial_year: financialYear },

      sections: REPORT_SECTIONS.map((key) => s[key]),
      gross_profit: pl.gross_profit,
      operating_profit: pl.operating_profit,
      net_profit: pl.net_profit,
      earnings: pl.earnings,
      elimination: pl.elimination,
      inventory_model: pl.inventory_model,
      periodic_cogs: pl.periodic_cogs,
      ledger_check: pl.ledger_check,

      // Legacy shape, derived from the sections above.
      income: {
        sales: { accounts: legacyAccounts(s.operating_income.accounts), total: s.operating_income.total },
        other_income: { accounts: legacyAccounts(s.other_income.accounts), total: s.other_income.total },
        total: r2(s.operating_income.total + s.other_income.total),
      },
      cogs: {
        opening_stock: pl.periodic_cogs?.opening_stock ?? cogsData?.openingStock.value ?? 0,
        purchases: pl.periodic_cogs?.purchases ?? cogsData?.purchases.total ?? 0,
        closing_stock: pl.periodic_cogs?.closing_stock ?? cogsData?.closingStock.value ?? 0,
        total: s.cost_of_goods_sold.total,
        items: cogsData?.openingStock.items || [],
        phase4: cogsData
          ? {
              valuation_method: cogsData.meta.valuation_method,
              inventory_model: pl.inventory_model,
              opening_source: cogsData.openingStock.source,
              opening_as_of: cogsData.openingStock.as_of_date,
              closing_source: cogsData.closingStock.source,
              closing_as_of: cogsData.closingStock.as_of_date,
              purchases_breakdown: {
                gross_purchases_5101: cogsData.purchases.gross_purchases,
                purchase_returns_5102: cogsData.purchases.returns,
                net: cogsData.purchases.total,
                source: 'ledger_5101_minus_5102',
              },
              notes: cogsData.meta.notes,
            }
          : null,
      },
      expenses: {
        direct: { accounts: legacyAccounts(s.cost_of_goods_sold.accounts), total: s.cost_of_goods_sold.total },
        // Depreciation is posted to the ledger (5204) and already inside operating expense.
        indirect: { accounts: legacyAccounts(s.operating_expense.accounts), total: s.operating_expense.total, depreciation: 0 },
        other_expenses: { accounts: legacyAccounts(s.other_expense.accounts), total: s.other_expense.total },
        provisions: {
          total: provisionsData?.total || 0,
          by_type: provisionsData?.by_type || {},
          details: provisionsData?.details || [],
          note: 'Informational schedule only. Provision charges posted to the ledger are already in the P&L.',
        },
        total: r2(s.cost_of_goods_sold.total + s.operating_expense.total + s.other_expense.total),
      },
      profit_before_tax: pl.earnings.profit_before_tax,
      tax: {
        current_tax: currentTax,
        deferred_tax: deferredTax,
        total: totalTax,
        source: 'ledger_5210_5211',
        note: 'Included in Non Operating Expense; shown separately for reference.',
        ledger_breakdown: { current_tax_5210: currentTax, deferred_tax_5211: deferredTax },
        provision_service_estimate: {
          current_tax: taxServiceCurrent,
          deferred_tax: taxServiceDeferred,
          total: taxServiceCurrent + taxServiceDeferred,
          note:
            'Computed by tax-provision-calculator from tax_provisions table. ' +
            'Shown for transparency only — not in the P&L. To affect profit, ' +
            'post a journal voucher to 5210/5211 (or call recordTaxPayment which does so).',
        },
      },
      profit_after_tax: pl.net_profit,
      warnings,
    });
  } catch (error: any) {
    console.error('Error generating profit & loss:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
