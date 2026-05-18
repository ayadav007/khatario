import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/cash-flow
 * Generate Cash Flow Statement
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
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription report access
    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: businessId,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // AUTHORIZATION: Check read permission for financial report
    try {
      await authorize(userId, 'report.financial', 'read', {
        businessId,
        branchId: finalBranchId,
        resource: {
          business_id: businessId,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Default to current financial year if not provided
    if (!fromDate || !toDate) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const fyStart = new Date(currentYear, 3, 1); // April 1
      const fyEnd = new Date(currentYear + 1, 2, 31); // March 31
      
      if (!fromDate) {
        const startDate = now < fyStart 
          ? new Date(currentYear - 1, 3, 1) 
          : fyStart;
        fromDate = startDate.toISOString().split('T')[0];
      }
      if (!toDate) {
        toDate = now.toISOString().split('T')[0];
      }
    }

    // Get cash and bank accounts
    const cashBankAccounts = await queryRows(`
      SELECT 
        a.id,
        a.account_code,
        a.account_name
      FROM accounts a
      WHERE a.business_id = $1 
        AND a.account_type = 'asset'
        AND (a.account_code LIKE '1101%' OR a.account_code LIKE '1102%' OR a.account_name ILIKE '%cash%' OR a.account_name ILIKE '%bank%')
        AND a.is_active = true
    `, [businessId]);

    // Calculate opening and closing balances for cash/bank accounts
    let openingCashBalance = 0;
    let closingCashBalance = 0;

    for (const account of cashBankAccounts) {
      const opening = await queryOne(`
        SELECT get_account_balance($1, $2, $3, $4) as balance
      `, [account.id, businessId, fromDate, finalBranchId]);
      openingCashBalance += parseFloat(opening?.balance || '0');

      const closing = await queryOne(`
        SELECT get_account_balance($1, $2, $3, $4) as balance
      `, [account.id, businessId, toDate, finalBranchId]);
      closingCashBalance += parseFloat(closing?.balance || '0');
    }

    // Operating Activities: Net Profit + Non-cash items - Changes in working capital
    // Get Net Profit from P&L
    const pnlResult = await queryOne(`
      SELECT 
        COALESCE(SUM(CASE WHEN a.account_type = 'income' THEN lel.credit - lel.debit ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN a.account_type = 'expense' THEN lel.debit - lel.credit ELSE 0 END), 0) as total_expenses
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND lel.branch_id = $4
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
        AND a.account_type IN ('income', 'expense')
    `, [businessId, fromDate, toDate, finalBranchId]);

    const netProfit = parseFloat(pnlResult?.total_income || '0') - parseFloat(pnlResult?.total_expenses || '0');

    // Non-cash items (Depreciation)
    const depreciation = await queryOne(`
      SELECT 
        COALESCE(SUM(lel.debit - lel.credit), 0) as total
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND lel.branch_id = $4
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
        AND (a.account_name ILIKE '%depreciation%' OR a.account_code LIKE '5204%')
    `, [businessId, fromDate, toDate, finalBranchId]);

    // Changes in Working Capital (branch-scoped GL)
    const receivableAcc = await queryOne<{ id: string }>(
      `SELECT id FROM accounts WHERE business_id = $1 AND account_code LIKE '1103%' AND is_active = true LIMIT 1`,
      [businessId]
    );
    let receivablesOpeningBal = 0;
    let receivablesClosingBal = 0;
    if (receivableAcc) {
      const ro = await queryOne(
        `SELECT get_account_balance($1, $2, $3, $4) as balance`,
        [receivableAcc.id, businessId, fromDate, finalBranchId]
      );
      const rc = await queryOne(
        `SELECT get_account_balance($1, $2, $3, $4) as balance`,
        [receivableAcc.id, businessId, toDate, finalBranchId]
      );
      receivablesOpeningBal = parseFloat(ro?.balance || '0');
      receivablesClosingBal = parseFloat(rc?.balance || '0');
    }

    const payableAcc = await queryOne<{ id: string }>(
      `SELECT id FROM accounts WHERE business_id = $1 AND account_code LIKE '2101%' AND is_active = true LIMIT 1`,
      [businessId]
    );
    let payablesOpeningBal = 0;
    let payablesClosingBal = 0;
    if (payableAcc) {
      const po = await queryOne(
        `SELECT get_account_balance($1, $2, $3, $4) as balance`,
        [payableAcc.id, businessId, fromDate, finalBranchId]
      );
      const pc = await queryOne(
        `SELECT get_account_balance($1, $2, $3, $4) as balance`,
        [payableAcc.id, businessId, toDate, finalBranchId]
      );
      payablesOpeningBal = parseFloat(po?.balance || '0');
      payablesClosingBal = parseFloat(pc?.balance || '0');
    }

    const inventoryAcc = await queryOne<{ id: string }>(
      `SELECT id FROM accounts WHERE business_id = $1 AND account_code LIKE '1104%' AND is_active = true LIMIT 1`,
      [businessId]
    );
    let inventoryOpeningBal = 0;
    let inventoryClosingBal = 0;
    if (inventoryAcc) {
      const io = await queryOne(
        `SELECT get_account_balance($1, $2, $3, $4) as balance`,
        [inventoryAcc.id, businessId, fromDate, finalBranchId]
      );
      const ic = await queryOne(
        `SELECT get_account_balance($1, $2, $3, $4) as balance`,
        [inventoryAcc.id, businessId, toDate, finalBranchId]
      );
      inventoryOpeningBal = parseFloat(io?.balance || '0');
      inventoryClosingBal = parseFloat(ic?.balance || '0');
    }

    const receivablesChange = receivablesClosingBal - receivablesOpeningBal;
    const payablesChange = payablesClosingBal - payablesOpeningBal;
    const inventoryChange = inventoryClosingBal - inventoryOpeningBal;

    // Operating cash flow
    const operatingCashFlow = netProfit 
      + parseFloat(depreciation?.total || '0')
      - receivablesChange
      + payablesChange
      - inventoryChange;

    // Investing Activities: Fixed asset purchases/sales
    const fixedAssetPurchases = await queryOne(`
      SELECT 
        COALESCE(SUM(lel.debit - lel.credit), 0) as total
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND lel.branch_id = $4
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
        AND a.account_code LIKE '1201%'
        AND lel.debit > 0
    `, [businessId, fromDate, toDate, finalBranchId]);

    const fixedAssetSales = await queryOne(`
      SELECT 
        COALESCE(SUM(lel.credit - lel.debit), 0) as total
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND lel.branch_id = $4
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
        AND a.account_code LIKE '1201%'
        AND lel.credit > 0
    `, [businessId, fromDate, toDate, finalBranchId]);

    const investingCashFlow = parseFloat(fixedAssetSales?.total || '0') - parseFloat(fixedAssetPurchases?.total || '0');

    // Financing Activities: Capital introduced, loans
    const capitalIntroduced = await queryOne(`
      SELECT 
        COALESCE(SUM(lel.credit - lel.debit), 0) as total
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND lel.branch_id = $4
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
        AND a.account_code LIKE '3001%'
    `, [businessId, fromDate, toDate, finalBranchId]);

    const loansTaken = await queryOne(`
      SELECT 
        COALESCE(SUM(lel.credit - lel.debit), 0) as total
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND lel.branch_id = $4
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
        AND a.account_type = 'liability'
        AND a.account_code LIKE '22%'
    `, [businessId, fromDate, toDate, finalBranchId]);

    const financingCashFlow = parseFloat(capitalIntroduced?.total || '0') + parseFloat(loansTaken?.total || '0');

    // Net cash flow
    const netCashFlow = operatingCashFlow + investingCashFlow + financingCashFlow;
    const calculatedClosingBalance = openingCashBalance + netCashFlow;

    return NextResponse.json({
      period: {
        from_date: fromDate,
        to_date: toDate,
      },
      opening_cash_balance: openingCashBalance,
      operating_activities: {
        net_profit: netProfit,
        depreciation: parseFloat(depreciation?.total || '0'),
        changes_in_working_capital: {
          receivables_increase: receivablesChange > 0 ? receivablesChange : 0,
          receivables_decrease: receivablesChange < 0 ? Math.abs(receivablesChange) : 0,
          payables_increase: payablesChange > 0 ? payablesChange : 0,
          payables_decrease: payablesChange < 0 ? Math.abs(payablesChange) : 0,
          inventory_increase: inventoryChange > 0 ? inventoryChange : 0,
          inventory_decrease: inventoryChange < 0 ? Math.abs(inventoryChange) : 0,
        },
        net_cash_from_operating: operatingCashFlow,
      },
      investing_activities: {
        fixed_asset_purchases: parseFloat(fixedAssetPurchases?.total || '0'),
        fixed_asset_sales: parseFloat(fixedAssetSales?.total || '0'),
        net_cash_from_investing: investingCashFlow,
      },
      financing_activities: {
        capital_introduced: parseFloat(capitalIntroduced?.total || '0'),
        loans_taken: parseFloat(loansTaken?.total || '0'),
        net_cash_from_financing: financingCashFlow,
      },
      net_cash_flow: netCashFlow,
      closing_cash_balance: closingCashBalance,
      calculated_closing_balance: calculatedClosingBalance,
    });
  } catch (error: any) {
    console.error('Error generating cash flow statement:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

