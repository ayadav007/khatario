import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { getFixedAssetsSummary } from '@/lib/services/depreciation-calculator';
import { getTotalProvisions } from '@/lib/services/provisions-manager';
import { getAllTaxProvisions } from '@/lib/services/tax-provision-calculator';
import { getClosingStockValue } from '@/lib/services/closing-stock-valuator';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/balance-sheet
 * Generate Balance Sheet
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id'); // Optional: Filter by branch
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];
    const financialYear = searchParams.get('financial_year');

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

    // CRITICAL: Support consolidated view (ALL branches) vs branch-specific view
    // If branchIdParam is "ALL" or null/undefined, show consolidated view (admin only)
    // Otherwise, filter by specific branch
    const isConsolidatedView = !branchIdParam || branchIdParam === 'ALL' || branchIdParam === 'all';
    
    let finalBranchId: string | null = null;
    let branchInfo: any = null;
    
    if (!isConsolidatedView) {
      // Branch-specific view: resolve and validate branch
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      try {
        finalBranchId = await resolveBranchId({
          branchId: branchIdParam,
          businessId: businessId,
        });
        
        // Get branch info
        branchInfo = await queryOne(`
          SELECT id, name, branch_code, gstin 
          FROM branches 
          WHERE id = $1 AND business_id = $2 AND is_active = true
        `, [finalBranchId, businessId]);
        
        if (!branchInfo) {
          return NextResponse.json(
            { error: 'Branch not found or inactive' },
            { status: 404 }
          );
        }
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
    } else {
      // Consolidated view: Check if user has permission to view all branches
      // Get user's accessible branches - if they only have access to specific branches, enforce those
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      
      if (accessibleBranchIds.length > 0) {
        // User has branch restrictions - filter by their accessible branches
        finalBranchId = null; // Not a single branch, but multiple
      } else {
        // User has no branch restrictions (admin) - show all branches (no filter)
        finalBranchId = null; // Consolidated view
      }
    }

    // AUTHORIZATION: Check read permission for financial report (PBAC will check branch access, business ownership, accounting access)
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

    // Get Asset accounts
    const assetAccounts = await queryRows(`
      SELECT 
        a.id,
        a.account_code,
        a.account_name,
        ag.group_name as account_group_name,
        ag.group_code,
        a.nature
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.business_id = $1 
        AND a.account_type = 'asset'
        AND a.is_active = true
      ORDER BY ag.group_code, a.account_code
    `, [businessId]);

    // Get Liability accounts
    const liabilityAccounts = await queryRows(`
      SELECT 
        a.id,
        a.account_code,
        a.account_name,
        ag.group_name as account_group_name,
        ag.group_code,
        a.nature
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.business_id = $1 
        AND a.account_type = 'liability'
        AND a.is_active = true
      ORDER BY ag.group_code, a.account_code
    `, [businessId]);

    // Get Capital accounts
    const capitalAccounts = await queryRows(`
      SELECT 
        a.id,
        a.account_code,
        a.account_name,
        ag.group_name as account_group_name,
        a.nature
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.business_id = $1 
        AND a.account_type = 'capital'
        AND a.is_active = true
      ORDER BY a.account_code
    `, [businessId]);

    // Build branch filter for ledger queries
    // For consolidated view, no filter (or filter by user's accessible branches)
    let branchFilter = '';
    let branchFilterParams: any[] = [];
    
    if (!isConsolidatedView && finalBranchId) {
      // Single branch filter
      branchFilter = 'AND lel.branch_id = $4';
      branchFilterParams = [finalBranchId];
    } else if (userId) {
      // Consolidated view: Check user's accessible branches
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      
      if (accessibleBranchIds.length > 0) {
        // User has branch restrictions - filter by their accessible branches
        branchFilter = 'AND lel.branch_id = ANY($4::uuid[])';
        branchFilterParams = [accessibleBranchIds];
      } else {
        // Admin - no branch filter (consolidated view)
        branchFilter = '';
      }
    }

    // Helper function to calculate account balance with branch filter
    const calculateAccountBalance = async (accountId: string, accountNature: string) => {
      // Get opening balance
      const account = await queryOne(`
        SELECT opening_balance, opening_balance_type, nature
        FROM accounts
        WHERE id = $1 AND business_id = $2
      `, [accountId, businessId]);

      let balance = 0;
      if (account?.opening_balance) {
        const openingBalance = parseFloat(account.opening_balance || '0');
        const openingType = account.opening_balance_type;
        const nature = account.nature || accountNature;

        if (nature === 'debit') {
          balance = openingType === 'debit' ? openingBalance : -openingBalance;
        } else {
          balance = openingType === 'credit' ? -openingBalance : openingBalance;
        }
      }

      // Calculate transaction totals with branch filter
      // Note: Inter-branch accounts are handled at the account level, not in SQL filter
      const transactionParams: any[] = [accountId, businessId, asOnDate, ...branchFilterParams];
      const transactions = await queryOne(`
        SELECT 
          COALESCE(SUM(lel.debit), 0) as debit_total,
          COALESCE(SUM(lel.credit), 0) as credit_total
        FROM ledger_entry_lines lel
        JOIN accounts a ON lel.account_id = a.id
        WHERE lel.account_id = $1 
          AND lel.business_id = $2
          AND lel.entry_date <= $3
          ${branchFilter}
      `, transactionParams);

      const debitTotal = parseFloat(transactions?.debit_total || '0');
      const creditTotal = parseFloat(transactions?.credit_total || '0');
      const nature = account?.nature || accountNature;

      if (nature === 'debit') {
        balance = balance + debitTotal - creditTotal;
      } else {
        balance = balance + creditTotal - debitTotal;
      }

      return balance;
    };

    // Calculate balances for assets
    const assetDetails = await Promise.all(
      assetAccounts.map(async (account: any) => {
        const balance = await calculateAccountBalance(account.id, 'debit');
        return {
          ...account,
          balance,
        };
      })
    );

    // Calculate balances for liabilities
    const liabilityDetails = await Promise.all(
      liabilityAccounts.map(async (account: any) => {
        const balance = await calculateAccountBalance(account.id, 'credit');
        return {
          ...account,
          balance,
        };
      })
    );

    // Calculate balances for capital
    const capitalDetails = await Promise.all(
      capitalAccounts.map(async (account: any) => {
        const balance = await calculateAccountBalance(account.id, 'credit');
        return {
          ...account,
          balance,
        };
      })
    );

    // Get Fixed Assets Summary (Gross Block, Depreciation, Net Block)
    let fixedAssetsSummary = null;
    try {
      fixedAssetsSummary = await getFixedAssetsSummary(businessId, asOnDate);
    } catch (error) {
      console.error('Error fetching fixed assets summary:', error);
    }

    // Get Provisions
    let provisionsData = null;
    if (financialYear) {
      try {
        provisionsData = await getTotalProvisions(businessId, financialYear);
      } catch (error) {
        console.error('Error fetching provisions:', error);
      }
    }

    // Get Tax Provisions
    let taxData = null;
    if (financialYear) {
      try {
        taxData = await getAllTaxProvisions(businessId, financialYear);
      } catch (error) {
        console.error('Error fetching tax provisions:', error);
      }
    }

    // Get Closing Stock Value
    let closingStockValue = 0;
    if (financialYear) {
      try {
        closingStockValue = await getClosingStockValue(businessId, financialYear);
      } catch (error) {
        console.error('Error fetching closing stock:', error);
      }
    }

    // Get Retained Earnings
    // Opening Retained Earnings + Current Year Profit
    const fyStart = financialYear 
      ? `${financialYear.split('-')[0]}-04-01`
      : new Date(new Date().getFullYear(), 3, 1).toISOString().split('T')[0];

    // Get opening retained earnings from previous FY
    let openingRetainedEarnings = 0;
    if (financialYear) {
      const previousFY = `${parseInt(financialYear.split('-')[0]) - 1}-${financialYear.split('-')[1].split('-')[0]}`;
      const openingRE = await queryOne(`
        SELECT opening_balance, opening_balance_type
        FROM opening_balances ob
        JOIN accounts a ON ob.account_id = a.id
        JOIN financial_years fy ON ob.financial_year_id = fy.id
        WHERE a.business_id = $1
          AND a.account_code = '3002'
          AND fy.year_code = $2
      `, [businessId, previousFY]);

      if (openingRE) {
        openingRetainedEarnings = parseFloat(openingRE.opening_balance || 0);
        if (openingRE.opening_balance_type === 'debit') {
          openingRetainedEarnings = -openingRetainedEarnings;
        }
      }
    }

    // Current year profit (from P&L)
    const pnlResult = await queryOne(`
      SELECT 
        COALESCE(SUM(CASE WHEN a.account_type = 'income' THEN lel.credit - lel.debit ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN a.account_type = 'expense' THEN lel.debit - lel.credit ELSE 0 END), 0) as total_expenses
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
        AND a.account_type IN ('income', 'expense')
    `, [businessId, fyStart, asOnDate]);

    const currentYearProfit = parseFloat(pnlResult?.total_income || '0') - parseFloat(pnlResult?.total_expenses || '0');
    const retainedEarnings = openingRetainedEarnings + currentYearProfit;

    // Group assets with detailed breakdown
    const currentAssets = assetDetails.filter(asset => 
      asset.group_code?.startsWith('1100') || asset.account_group_name?.toLowerCase().includes('current')
    );
    const fixedAssets = assetDetails.filter(asset => 
      asset.group_code?.startsWith('1200') || asset.account_group_name?.toLowerCase().includes('fixed')
    );
    const investments = assetDetails.filter(asset => 
      asset.group_code?.startsWith('1300') || asset.account_group_name?.toLowerCase().includes('investment')
    );

    // Detailed current assets breakdown
    const inventory = currentAssets.find(a => a.account_code === '1104');
    const receivables = currentAssets.find(a => a.account_code === '1103');
    const prepaidExpenses = currentAssets.find(a => a.account_code === '1105');
    const accruedIncome = currentAssets.find(a => a.account_code === '1106');
    const advancesToSuppliers = currentAssets.find(a => a.account_code === '1107');
    const loansAndAdvances = currentAssets.find(a => a.account_code === '1108');

    // Use closing stock value if available, otherwise use inventory account balance
    const inventoryValue = closingStockValue > 0 ? closingStockValue : (inventory?.balance || 0);

    // Group liabilities with detailed breakdown
    const currentLiabilities = liabilityDetails.filter(liab => 
      liab.group_code?.startsWith('2100') || liab.account_group_name?.toLowerCase().includes('current')
    );
    const longTermLiabilities = liabilityDetails.filter(liab => 
      liab.group_code?.startsWith('2200') || liab.account_group_name?.toLowerCase().includes('long')
    );

    // Detailed current liabilities breakdown
    const payables = currentLiabilities.find(l => l.account_code === '2101');
    const outstandingExpenses = currentLiabilities.find(l => l.account_code === '2104');
    const accruedExpenses = currentLiabilities.find(l => l.account_code === '2105');
    const advancesFromCustomers = currentLiabilities.find(l => l.account_code === '2106');
    const unearnedRevenue = currentLiabilities.find(l => l.account_code === '2107');

    // Calculate totals with detailed breakdown
    // Current Assets: 1104 is always excluded from the sum and added once via
    // inventoryValue (closing stock from valuation, else ledger balance). Skipping
    // only when closingStockValue > 0 would double-count inventory when FY is unset.
    let totalCurrentAssets = currentAssets.reduce((sum, acc) => {
      if (acc.account_code === '1104') {
        return sum;
      }
      return sum + Math.max(0, acc.balance);
    }, 0);
    totalCurrentAssets += Math.max(0, inventoryValue);

    // Fixed Assets: Use summary if available
    const grossBlock = fixedAssetsSummary?.grossBlock || 0;
    const accumulatedDepreciation = fixedAssetsSummary?.accumulatedDepreciation || 0;
    const netBlock = fixedAssetsSummary?.netBlock || 0;
    const totalFixedAssets = netBlock;

    const totalInvestments = investments.reduce((sum, acc) => sum + Math.max(0, acc.balance), 0);
    const totalAssets = totalCurrentAssets + totalFixedAssets + totalInvestments;

    // Current Liabilities: Add provisions and tax
    let totalCurrentLiabilities = currentLiabilities.reduce((sum, acc) => {
      // Exclude provisions and tax accounts (handled separately)
      if (acc.account_code === '2108' || acc.account_code === '2109' || acc.account_code === '2110') {
        return sum;
      }
      return sum + Math.max(0, Math.abs(acc.balance));
    }, 0);

    // Add provisions
    const provisionsTotal = provisionsData?.total || 0;
    totalCurrentLiabilities += provisionsTotal;

    // Add tax liabilities
    const currentTaxPayable = taxData?.current_tax?.balance_amount || 0;
    totalCurrentLiabilities += currentTaxPayable;

    const totalLongTermLiabilities = longTermLiabilities.reduce((sum, acc) => sum + Math.max(0, Math.abs(acc.balance)), 0);
    const totalLiabilities = totalCurrentLiabilities + totalLongTermLiabilities;

    const totalCapital = capitalDetails.reduce((sum, acc) => sum + Math.max(0, Math.abs(acc.balance)), 0);
    const totalEquity = totalCapital + retainedEarnings;
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

    // Compare at 2 dp; 1 paisa strict match fails when (a) assets are whole-rupee lines and
    // (b) equity uses P&L (income/expense) with paisa + GST. Allow 5 paise tolerance.
    const rAssets = Math.round(totalAssets * 100) / 100;
    const rLiabEquity = Math.round(totalLiabilitiesAndEquity * 100) / 100;
    const balanceSheetEps = 0.05;

    return NextResponse.json({
      branch: branchInfo ? {
        id: branchInfo.id,
        name: branchInfo.name,
        branch_code: branchInfo.branch_code,
        gstin: branchInfo.gstin,
      } : null,
      is_consolidated: isConsolidatedView,
      as_on_date: asOnDate,
      financial_year: financialYear,
      assets: {
        current: {
          accounts: currentAssets,
          inventory: inventoryValue,
          receivables: receivables?.balance || 0,
          prepaid_expenses: prepaidExpenses?.balance || 0,
          accrued_income: accruedIncome?.balance || 0,
          advances_to_suppliers: advancesToSuppliers?.balance || 0,
          loans_and_advances: loansAndAdvances?.balance || 0,
          total: totalCurrentAssets,
        },
        fixed: {
          gross_block: grossBlock,
          accumulated_depreciation: accumulatedDepreciation,
          net_block: netBlock,
          assets: fixedAssetsSummary?.assets || [],
          total: totalFixedAssets,
        },
        investments: {
          accounts: investments,
          total: totalInvestments,
        },
        total: totalAssets,
      },
      liabilities: {
        current: {
          accounts: currentLiabilities.filter(l => 
            l.account_code !== '2108' && l.account_code !== '2109' && l.account_code !== '2110'
          ),
          payables: payables?.balance ? Math.abs(payables.balance) : 0,
          outstanding_expenses: outstandingExpenses?.balance ? Math.abs(outstandingExpenses.balance) : 0,
          accrued_expenses: accruedExpenses?.balance ? Math.abs(accruedExpenses.balance) : 0,
          advances_from_customers: advancesFromCustomers?.balance ? Math.abs(advancesFromCustomers.balance) : 0,
          unearned_revenue: unearnedRevenue?.balance ? Math.abs(unearnedRevenue.balance) : 0,
          provisions: {
            total: provisionsTotal,
            by_type: provisionsData?.by_type || {},
            details: provisionsData?.details || [],
          },
          tax_payable: {
            current_tax: currentTaxPayable,
            deferred_tax: taxData?.deferred_tax?.balance_amount || 0,
            total: currentTaxPayable + (taxData?.deferred_tax?.balance_amount || 0),
          },
          total: totalCurrentLiabilities,
        },
        long_term: {
          accounts: longTermLiabilities,
          total: totalLongTermLiabilities,
        },
        total: totalLiabilities,
      },
      equity: {
        capital: {
          accounts: capitalDetails,
          total: totalCapital,
        },
        retained_earnings: {
          opening: openingRetainedEarnings,
          current_year_profit: currentYearProfit,
          dividends: 0, // TODO: Add dividends tracking
          closing: retainedEarnings,
        },
        total: totalEquity,
      },
      deferred_tax: {
        assets: 0, // TODO: Calculate from deferred_tax_details
        liabilities: taxData?.deferred_tax?.balance_amount || 0,
      },
      total_liabilities_and_equity: totalLiabilitiesAndEquity,
      is_balanced: Math.abs(rAssets - rLiabEquity) < balanceSheetEps,
    });
  } catch (error: any) {
    console.error('Error generating balance sheet:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

