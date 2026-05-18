import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/ledger
 * List ledger entries with filters
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
      await authorize(userId, 'reports', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const accountId = searchParams.get('account_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const voucherType = searchParams.get('voucher_type');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get user's accessible branch IDs if userId provided
    // Note: ledger_entries table may not have branch_id column (it's in ledger_entry_lines)
    // We'll check if the column exists and filter accordingly
    let accessibleBranchIds: string[] = [];
    let branchFilter = '';
    let hasBranchIdColumn = false;
    
    if (userId) {
      try {
        const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
        accessibleBranchIds = await getUserAccessibleBranchIds(userId);
        
        // Check if ledger_entries has branch_id column
        const { queryOne } = await import('@/lib/db');
        const columnCheck = await queryOne(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'ledger_entries' 
          AND column_name = 'branch_id'
          LIMIT 1
        `);
        hasBranchIdColumn = !!columnCheck;
        
        if (hasBranchIdColumn && accessibleBranchIds.length > 0) {
          branchFilter = `AND le.branch_id = ANY($${accessibleBranchIds.length + 1}::uuid[])`;
        } else if (!hasBranchIdColumn) {
          // If ledger_entries doesn't have branch_id, we can't filter by branch
          // The system might be using ledger_entry_lines instead
          console.warn('ledger_entries table does not have branch_id column. Branch filtering skipped.');
        } else {
          // User has no branch access - return empty result
          return NextResponse.json({ 
            entries: [],
            pagination: {
              page: 1,
              limit: 50,
              total: 0,
              totalPages: 0
            }
          });
        }
      } catch (error) {
        console.error('Error fetching user accessible branches:', error);
        // Continue without branch filtering if error
      }
    }

    let sql = `
      SELECT 
        le.*,
        a.account_code,
        a.account_name,
        a.nature as account_nature
      FROM ledger_entries le
      LEFT JOIN accounts a ON le.account_id = a.id
      WHERE le.business_id = $1
        ${branchFilter}
    `;
    const params: any[] = [businessId];
    if (accessibleBranchIds.length > 0) {
      params.push(accessibleBranchIds);
    }
    let paramIndex = params.length + 1;

    if (accountId) {
      sql += ` AND le.account_id = $${paramIndex}`;
      params.push(accountId);
      paramIndex++;
    }

    if (fromDate) {
      sql += ` AND le.entry_date >= $${paramIndex}`;
      params.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      sql += ` AND le.entry_date <= $${paramIndex}`;
      params.push(toDate);
      paramIndex++;
    }

    if (voucherType) {
      sql += ` AND le.voucher_type = $${paramIndex}`;
      params.push(voucherType);
      paramIndex++;
    }

    // Get total count for pagination
    const countParams = params.slice(0, params.length);
    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    // Add pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    sql += ` ORDER BY le.entry_date DESC, le.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const entries = await queryRows(sql, params);

    return NextResponse.json({ 
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching ledger entries:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

