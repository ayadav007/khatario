import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { calculateCOGS } from '@/lib/services/cogs-calculator';
import { getTotalDepreciation } from '@/lib/services/depreciation-calculator';
import { getTotalProvisions } from '@/lib/services/provisions-manager';
import { getAllTaxProvisions } from '@/lib/services/tax-provision-calculator';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/profit-loss
 * Generate enhanced Profit & Loss statement with account-wise breakdown
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const branchIdParam = searchParams.get('branch_id'); // Optional: Filter by branch
    let fromDate = searchParams.get('from_date');
    let toDate = searchParams.get('to_date');
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

    // CRITICAL: Enforce access boundary - reject attendance-only employees
    const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
    const accessCheck = await checkEmployeeAccessBoundary(userId, 'portal');
    if (!accessCheck.allowed) {
      return NextResponse.json(
        { error: accessCheck.reason, code: 'ACCESS_DENIED' },
        { status: 403 }
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
    let branchFilter = ''; // SQL filter for branch_id
    let branchInfo: any = null;
    
    if (!isConsolidatedView) {
      // Branch-specific view: resolve and validate branch
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      try {
        finalBranchId = await resolveBranchId({
          branchId: branchIdParam,
          businessId: businessId,
        });
        branchFilter = 'AND branch_id = $5'; // Will be added to queries
        
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
        branchFilter = `AND branch_id = ANY($5::uuid[])`;
        finalBranchId = null; // Not a single branch, but multiple
      } else {
        // User has no branch restrictions (admin) - show all branches (no filter)
        branchFilter = ''; // No branch filter = consolidated view
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

    // -----------------------------------------------------------------
    // PHASE-4: cross-FY soft warning
    //
    // Indian P&L is statutory only when aligned to one financial year
    // (April 1 → March 31). Sub-year management reports are fine; ranges
    // that straddle 31-March are *computable* but the Opening Stock
    // semantics break (we'd be using one FY's "as of" stock against the
    // other FY's transactions). We compute anyway (Tally parity) but
    // surface a top-level warning so the UI can banner it.
    // -----------------------------------------------------------------
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

    // Get Income accounts (Sales, Other Income)
    const incomeAccounts = await queryRows(`
      SELECT 
        a.id,
        a.account_code,
        a.account_name,
        a.account_type,
        ag.group_name as account_group_name
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.business_id = $1 
        AND a.account_type IN ('income')
        AND a.is_active = true
      ORDER BY a.account_code
    `, [businessId]);

    // Get Expense accounts (Direct and Indirect)
    const expenseAccounts = await queryRows(`
      SELECT 
        a.id,
        a.account_code,
        a.account_name,
        a.account_type,
        ag.group_name as account_group_name,
        ag.group_code
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.business_id = $1 
        AND a.account_type IN ('expense')
        AND a.is_active = true
      ORDER BY ag.group_code, a.account_code
    `, [businessId]);

    // CRITICAL: For branch-specific reports, exclude inter-branch accounts at account level
    // For consolidated view, include inter-branch accounts (they cancel out)
    const interBranchAccountCodes = ['4103', '5103']; // Inter-Branch Sales, Inter-Branch Purchases
    const excludeInterBranch = !isConsolidatedView; // Only exclude for branch-specific views

    // Calculate income for each account
    const incomeDetails = await Promise.all(
      incomeAccounts
        .filter((account: any) => !excludeInterBranch || !interBranchAccountCodes.includes(account.account_code))
        .map(async (account: any) => {
          const transactionParams: any[] = [account.id, businessId, fromDate, toDate];
          if (branchFilter) {
            if (finalBranchId) {
              // Single branch filter
              transactionParams.push(finalBranchId);
            } else {
              // Multiple branches (user's accessible branches)
              const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
              const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
              transactionParams.push(accessibleBranchIds);
            }
          }
          
          const transactions = await queryOne(`
            SELECT 
              COALESCE(SUM(credit - debit), 0) as net_amount
            FROM ledger_entry_lines lel
            JOIN accounts a ON lel.account_id = a.id
            WHERE lel.account_id = $1 
              AND lel.business_id = $2
              AND lel.entry_date >= $3
              AND lel.entry_date <= $4
              ${branchFilter}
          `, transactionParams);

        return {
          ...account,
          amount: parseFloat(transactions?.net_amount || '0'),
        };
      })
    );

    // Calculate expenses for each account
    const expenseDetails = await Promise.all(
      expenseAccounts
        .filter((account: any) => !excludeInterBranch || !interBranchAccountCodes.includes(account.account_code))
        .map(async (account: any) => {
          const transactionParams: any[] = [account.id, businessId, fromDate, toDate];
          if (branchFilter) {
            if (finalBranchId) {
              // Single branch filter
              transactionParams.push(finalBranchId);
            } else {
              // Multiple branches (user's accessible branches)
              const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
              const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
              transactionParams.push(accessibleBranchIds);
            }
          }
          
          const transactions = await queryOne(`
            SELECT 
              COALESCE(SUM(debit - credit), 0) as net_amount
            FROM ledger_entry_lines lel
            JOIN accounts a ON lel.account_id = a.id
            WHERE lel.account_id = $1 
              AND lel.business_id = $2
              AND lel.entry_date >= $3
              AND lel.entry_date <= $4
              ${branchFilter}
          `, transactionParams);

        return {
          ...account,
          amount: parseFloat(transactions?.net_amount || '0'),
        };
      })
    );

    // Calculate COGS (Opening Stock + Purchases - Closing Stock)
    let cogsData = null;
    try {
      // Get previous financial year for opening stock
      const previousFY = financialYear
        ? `${parseInt(financialYear.split('-')[0]) - 1}-${financialYear.split('-')[1].split('-')[0]}`
        : undefined;

      cogsData = await calculateCOGS(
        businessId,
        fromDate,
        toDate,
        financialYear || undefined,
        previousFY
      );
    } catch (error) {
      console.error('Error calculating COGS:', error);
      // Continue without COGS if calculation fails
    }

    // Closing stock reminder (periodic inventory): derived stock ≠ formal year-end close
    if (cogsData && cogsData.meta.inventory_model === 'periodic') {
      const purchasesGross = cogsData.purchases?.gross_purchases ?? 0;
      const openingVal = cogsData.openingStock?.value ?? 0;
      const closingVal = cogsData.closingStock?.value ?? 0;
      const closingSrc = cogsData.closingStock?.source;
      const hasInventoryActivity =
        purchasesGross > 0.01 || openingVal > 0.01 || closingVal > 0.01;
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

    // Get Depreciation
    let depreciationTotal = 0;
    if (financialYear) {
      try {
        depreciationTotal = await getTotalDepreciation(businessId, financialYear);
      } catch (error) {
        console.error('Error fetching depreciation:', error);
      }
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

    // ------------------------------------------------------------------
    // PHASE-1 P&L CLASSIFICATION (single source of truth)
    //
    //   Direct Expenses (cost of revenue):  5101, 5102                       (also COGS via cogs-calculator)
    //   Indirect Expenses (operating):      5201, 5202, 5203                 (Admin, Salaries, Rent)
    //   Depreciation:                       5204                              (own line)
    //   Finance Costs (Interest):           5205                              (own line, "Other Expenses")
    //   Other / Provisions:                 5206, 5207, 5208, 5209           (own line, "Other Expenses")
    //   Tax (current + deferred):           5210, 5211                       (below PBT only)
    //
    // Each account_code appears in EXACTLY ONE bucket so PBT/PAT cannot
    // double-count. The provisions-manager service is no longer subtracted
    // from PBT (its closing-balance semantics double-count what the ledger
    // already has at 5207-5209).
    // ------------------------------------------------------------------

    const directExpenseCodes = new Set(['5101', '5102']);
    const otherExpenseCodes = new Set(['5205', '5206', '5207', '5208', '5209']);
    const depreciationCode = '5204';
    const taxCodes = new Set(['5210', '5211']);

    const directExpenses = expenseDetails.filter((exp: any) =>
      directExpenseCodes.has(exp.account_code) ||
      exp.group_code === '5100' ||
      exp.account_group_name?.toLowerCase().includes('direct')
    );
    const indirectExpenses = expenseDetails.filter((exp: any) =>
      !directExpenses.includes(exp) &&
      exp.account_code !== depreciationCode &&
      !otherExpenseCodes.has(exp.account_code) &&
      !taxCodes.has(exp.account_code)
    );
    const otherExpenses = expenseDetails.filter((exp: any) =>
      otherExpenseCodes.has(exp.account_code)
    );
    const taxExpenses = expenseDetails.filter((exp: any) =>
      taxCodes.has(exp.account_code)
    );

    // Calculate totals
    const totalIncome = incomeDetails.reduce((sum, acc) => sum + acc.amount, 0);
    const totalDirectExpenses = directExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const totalIndirectExpenses = indirectExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const totalOtherExpenses = otherExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const currentTaxFromLedger = taxExpenses
      .filter((exp: any) => exp.account_code === '5210')
      .reduce((sum: number, exp: any) => sum + exp.amount, 0);
    const deferredTaxFromLedger = taxExpenses
      .filter((exp: any) => exp.account_code === '5211')
      .reduce((sum: number, exp: any) => sum + exp.amount, 0);

    // COGS (if calculated)
    const cogs = cogsData?.cogs || 0;
    const openingStock = cogsData?.openingStock.value || 0;
    const purchases = cogsData?.purchases.total || 0;
    const closingStock = cogsData?.closingStock.value || 0;

    // Gross Profit = Sales - COGS (or Sales - Direct Expenses if COGS not available)
    // Note: when COGS is used, totalDirectExpenses (5101 ledger) represents the same
    // purchases that COGS already accounts for - we deliberately avoid subtracting
    // them again. cogsUsed is the canonical "cost of revenue" figure for this period.
    const cogsUsed = cogs > 0 ? cogs : totalDirectExpenses;
    const grossProfit = totalIncome - cogsUsed;

    // Operating Profit = Gross Profit - Indirect Expenses - Depreciation
    const operatingProfit = grossProfit - totalIndirectExpenses - depreciationTotal;

    // Profit Before Tax = Operating Profit - Other Expenses (incl. provisions 5207-5209)
    // provisionsData (from provisions-manager service) is exposed in the response for
    // the schedule, but is NOT subtracted again - 5207-5209 ledger postings already
    // captured the period charge inside totalOtherExpenses.
    const provisionsTotal = provisionsData?.total || 0;
    const profitBeforeTax = operatingProfit - totalOtherExpenses;

    // Tax
    // Single source of truth = ledger postings to 5210/5211 (real entries that
    // actually moved money in the books — manual JVs, year-end provisions, etc.).
    // The tax-provision-calculator service produces a *computed estimate* stored
    // separately in the tax_provisions table; we expose it for transparency in
    // tax_calculation_breakdown but DO NOT use it for PAT math, otherwise we'd
    // double-count whenever both exist (the same risk we just removed for 5207-5209).
    const taxServiceCurrent = taxData?.current_tax?.provision_amount || 0;
    const taxServiceDeferred = taxData?.deferred_tax?.provision_amount || 0;
    const currentTax = currentTaxFromLedger;
    const deferredTax = deferredTaxFromLedger;
    const totalTax = currentTax + deferredTax;

    // Profit After Tax
    const profitAfterTax = profitBeforeTax - totalTax;

    // Group income by category
    const salesIncome = incomeDetails.filter(inc => 
      inc.account_group_name?.toLowerCase().includes('sales')
    );
    const otherIncome = incomeDetails.filter(inc => 
      !salesIncome.includes(inc)
    );

    return NextResponse.json({
      branch: branchInfo ? {
        id: branchInfo.id,
        name: branchInfo.name,
        branch_code: branchInfo.branch_code,
        gstin: branchInfo.gstin,
      } : null,
      is_consolidated: isConsolidatedView,
      period: {
        from_date: fromDate,
        to_date: toDate,
        financial_year: financialYear,
      },
      income: {
        sales: {
          accounts: salesIncome,
          total: salesIncome.reduce((sum, acc) => sum + acc.amount, 0),
        },
        other_income: {
          accounts: otherIncome,
          total: otherIncome.reduce((sum, acc) => sum + acc.amount, 0),
        },
        total: totalIncome,
      },
      cogs: {
        opening_stock: openingStock,
        purchases: purchases,
        closing_stock: closingStock,
        total: cogs,
        items: cogsData?.openingStock.items || [],
        // PHASE-4: surface the new metadata so the report can show which
        // inputs were used (snapshot vs derived, valuation method, gross
        // purchases vs returns netted into the single Purchases line).
        phase4: cogsData
          ? {
              valuation_method: cogsData.meta.valuation_method,
              inventory_model: cogsData.meta.inventory_model,
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
        direct: {
          accounts: directExpenses,
          total: totalDirectExpenses,
        },
        indirect: {
          accounts: indirectExpenses,
          total: totalIndirectExpenses,
          depreciation: depreciationTotal,
        },
        other_expenses: {
          accounts: otherExpenses,
          total: totalOtherExpenses,
        },
        // Provisions schedule is informational only. The period charge is
        // already captured in expenses.other_expenses (5207-5209 ledger).
        provisions: {
          total: provisionsTotal,
          by_type: provisionsData?.by_type || {},
          details: provisionsData?.details || [],
          note:
            'Informational schedule only. Period provisions charge is included ' +
            'in other_expenses (5207-5209) - not double-counted in PBT.',
        },
        // Mirrors what is actually subtracted in PBT:
        //   cogsUsed (= COGS or direct expenses fallback)
        // + indirect expenses + depreciation + other expenses (incl provisions).
        // No double-counting.
        total: cogsUsed + totalIndirectExpenses + totalOtherExpenses + depreciationTotal,
      },
      gross_profit: grossProfit,
      operating_profit: operatingProfit,
      profit_before_tax: profitBeforeTax,
      tax: {
        current_tax: currentTax,
        deferred_tax: deferredTax,
        total: totalTax,
        source: 'ledger_5210_5211',
        ledger_breakdown: {
          current_tax_5210: currentTaxFromLedger,
          deferred_tax_5211: deferredTaxFromLedger,
          line_count: taxExpenses.length,
        },
        provision_service_estimate: {
          current_tax: taxServiceCurrent,
          deferred_tax: taxServiceDeferred,
          total: taxServiceCurrent + taxServiceDeferred,
          note:
            'Computed by tax-provision-calculator from tax_provisions table. ' +
            'Shown for transparency only — NOT subtracted from PBT. To affect PAT, ' +
            'post a journal voucher to 5210/5211 (or call recordTaxPayment which does so).',
        },
      },
      profit_after_tax: profitAfterTax,
      // Legacy field for backward compatibility
      net_profit: profitAfterTax,
      // PHASE-4: top-level warnings (e.g. period crosses FY boundary).
      // The UI should surface these as a banner above the report.
      warnings,
    });
  } catch (error: any) {
    console.error('Error generating profit & loss:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

