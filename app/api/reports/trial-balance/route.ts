import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/trial-balance
 * Generate trial balance report
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
    let branchFilter = ''; // SQL filter for branch_id
    
    if (!isConsolidatedView) {
      // Branch-specific view: resolve and validate branch
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      try {
        finalBranchId = await resolveBranchId({
          branchId: branchIdParam,
          businessId: businessId,
        });
        branchFilter = 'AND branch_id = $4'; // Will be added to queries
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
        branchFilter = `AND branch_id = ANY($4::uuid[])`;
        finalBranchId = null; // Not a single branch, but multiple
      } else {
        // User has no branch restrictions (admin) - show all branches (no filter)
        branchFilter = ''; // No branch filter = consolidated view
      }
    }

    // AUTHORIZATION: Check read permission for financial report
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

    // Get all active accounts
    const accounts = await queryRows(`
      SELECT 
        a.id,
        a.account_code,
        a.account_name,
        a.account_type,
        a.nature,
        a.opening_balance,
        a.opening_balance_type,
        ag.group_name as account_group_name
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.business_id = $1 AND a.is_active = true
      ORDER BY a.account_code
    `, [businessId]);

    // Calculate balance for each account
    const trialBalance = await Promise.all(
      accounts.map(async (account: any) => {
        // Get opening balance
        let openingBalance = 0;
        if (account.opening_balance_type === 'debit') {
          openingBalance = account.nature === 'debit' 
            ? parseFloat(account.opening_balance || '0')
            : -parseFloat(account.opening_balance || '0');
        } else {
          openingBalance = account.nature === 'credit'
            ? -parseFloat(account.opening_balance || '0')
            : parseFloat(account.opening_balance || '0');
        }

        // Get transaction totals up to as_on_date (with branch filter if applicable)
        const transactionParams: any[] = [account.id, businessId, asOnDate];
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
            COALESCE(SUM(debit), 0) as total_debit,
            COALESCE(SUM(credit), 0) as total_credit
          FROM ledger_entry_lines
          WHERE account_id = $1 
            AND business_id = $2
            AND entry_date <= $3
            ${branchFilter}
        `, transactionParams);

        const totalDebit = parseFloat(transactions?.total_debit || '0');
        const totalCredit = parseFloat(transactions?.total_credit || '0');

        // Calculate balance based on account nature
        let balance = openingBalance;
        if (account.nature === 'debit') {
          balance = openingBalance + totalDebit - totalCredit;
        } else {
          balance = openingBalance + totalCredit - totalDebit;
        }

        // Determine debit/credit for trial balance
        let debitAmount = 0;
        let creditAmount = 0;

        if (account.nature === 'debit') {
          // Assets and Expenses: positive balance = debit, negative = credit
          if (balance >= 0) {
            debitAmount = balance;
          } else {
            creditAmount = Math.abs(balance);
          }
        } else {
          // Liabilities, Income, Capital: positive balance = credit, negative = debit
          if (balance >= 0) {
            creditAmount = balance;
          } else {
            debitAmount = Math.abs(balance);
          }
        }

        return {
          account_id: account.id,
          account_code: account.account_code,
          account_name: account.account_name,
          account_type: account.account_type,
          account_group_name: account.account_group_name,
          opening_balance: openingBalance,
          debit: debitAmount,
          credit: creditAmount,
          balance: balance,
        };
      })
    );

    // Calculate totals
    const totals = trialBalance.reduce(
      (acc, entry) => {
        acc.total_debit += entry.debit;
        acc.total_credit += entry.credit;
        return acc;
      },
      { total_debit: 0, total_credit: 0 }
    );

    // Group by account type for summary
    const byType = trialBalance.reduce((acc: any, entry) => {
      if (!acc[entry.account_type]) {
        acc[entry.account_type] = { debit: 0, credit: 0, count: 0 };
      }
      acc[entry.account_type].debit += entry.debit;
      acc[entry.account_type].credit += entry.credit;
      acc[entry.account_type].count += 1;
      return acc;
    }, {});

    return NextResponse.json({
      branch: finalBranchId ? {
        id: finalBranchId,
        // Branch name will be fetched if needed
      } : null,
      is_consolidated: isConsolidatedView,
      as_on_date: asOnDate,
      financial_year: financialYear,
      accounts: trialBalance,
      totals,
      summary_by_type: byType,
      is_balanced: Math.abs(totals.total_debit - totals.total_credit) < 0.01,
    });
  } catch (error: any) {
    console.error('Error generating trial balance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

