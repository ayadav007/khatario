import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';

/**
 * GET /api/ledger/account/[accountId]
 * Get account-wise ledger with running balance
 */
export async function GET(
  request: NextRequest,
  { params: routeParams }: { params: { accountId: string } }
) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const accountId = routeParams.accountId;
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // Optional: for branch filtering
    const branchIdParam = searchParams.get('branch_id'); // Optional: 'ALL' for consolidated, or specific branch
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // CRITICAL: Support consolidated view (ALL branches) vs branch-specific view
    const isConsolidatedView = !branchIdParam || branchIdParam === 'ALL' || branchIdParam === 'all';
    
    let finalBranchId: string | null = null;
    let branchFilter = ''; // SQL filter for branch_id
    
    if (!isConsolidatedView && userId) {
      // Branch-specific view: resolve and validate branch
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      try {
        finalBranchId = await resolveBranchId({
          branchId: branchIdParam,
          businessId: businessId,
        });
        branchFilter = 'AND lel.branch_id = $' + (fromDate ? (toDate ? 5 : 4) : (toDate ? 4 : 3));
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
    } else if (userId) {
      // Consolidated view: Check if user has permission to view all branches
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      
      if (accessibleBranchIds.length > 0) {
        // User has branch restrictions - filter by their accessible branches
        branchFilter = 'AND lel.branch_id = ANY($' + (fromDate ? (toDate ? 5 : 4) : (toDate ? 4 : 3)) + '::uuid[])';
        finalBranchId = null; // Not a single branch, but multiple
      } else {
        // User has no branch restrictions (admin) - show all branches (no filter)
        branchFilter = ''; // No branch filter = consolidated view
      }
    }

    // Get account details
    const account = await queryOne(`
      SELECT 
        a.*,
        ag.group_name as account_group_name
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.id = $1 AND a.business_id = $2
    `, [accountId, businessId]);

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Calculate opening balance
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

    // Get ledger entries from ledger_entry_lines (which has branch_id) instead of ledger_entries
    let sql = `
      SELECT 
        lel.id,
        lel.voucher_id,
        lel.voucher_type,
        lel.account_id,
        lel.entry_date,
        lel.debit,
        lel.credit,
        lel.narration,
        lel.reference_number,
        lel.branch_id,
        a.account_code,
        a.account_name
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.account_id = $1 AND lel.business_id = $2
    `;
    const queryParams: any[] = [accountId, businessId];
    let paramIndex = 3;

    if (fromDate) {
      sql += ` AND lel.entry_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      sql += ` AND lel.entry_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    // Add branch filter if applicable
    if (branchFilter) {
      sql += ` ${branchFilter}`;
      if (finalBranchId) {
        queryParams.push(finalBranchId);
      } else if (userId) {
        // Multiple branches (user's accessible branches)
        const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
        const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
        queryParams.push(accessibleBranchIds);
      }
    }

    sql += ` ORDER BY lel.entry_date ASC, lel.created_at ASC`;

    const entries = await queryRows(sql, queryParams);

    // Calculate running balance
    let runningBalance = openingBalance;
    const entriesWithBalance = entries.map((entry: any) => {
      const debit = parseFloat(entry.debit || '0');
      const credit = parseFloat(entry.credit || '0');
      
      if (account.nature === 'debit') {
        runningBalance = runningBalance + debit - credit;
      } else {
        runningBalance = runningBalance + credit - debit;
      }

      return {
        ...entry,
        running_balance: runningBalance,
      };
    });

    return NextResponse.json({
      account,
      opening_balance: openingBalance,
      entries: entriesWithBalance,
      closing_balance: runningBalance,
    });
  } catch (error: any) {
    console.error('Error fetching account ledger:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

