import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { queryOne, query } from '@/lib/db';
import { Account } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/accounts/[id]
 * Get account details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const accountId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const includeBalance = searchParams.get('include_balance') === 'true';
    const asOnDate = searchParams.get('as_on_date');

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

    const account = await queryOne<Account & { account_group_name: string }>(`
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

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'settings', 'read', { businessId: account.business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Calculate current balance if requested
    if (includeBalance) {
      const dateFilter = asOnDate ? `AND entry_date <= $3` : '';
      const params = asOnDate ? [accountId, businessId, asOnDate] : [accountId, businessId];

      const balanceResult = await queryOne<{ balance: number }>(`
        SELECT 
          COALESCE(SUM(
            CASE 
              WHEN a.nature = 'debit' THEN (le.debit - le.credit)
              ELSE (le.credit - le.debit)
            END
          ), 0) + 
          CASE 
            WHEN a.opening_balance_type = 'debit' THEN a.opening_balance
            ELSE -a.opening_balance
          END as balance
        FROM accounts a
        LEFT JOIN ledger_entries le ON le.account_id = a.id AND le.business_id = $2 ${dateFilter}
        WHERE a.id = $1 AND a.business_id = $2
        GROUP BY a.id, a.opening_balance, a.opening_balance_type
      `, params);

      account.current_balance = parseFloat(balanceResult?.balance?.toString() || '0');
    }

    return NextResponse.json({ account });
  } catch (error: any) {
    console.error('Error fetching account:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/accounts/[id]
 * Update account
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const accountId = params.id;
    const body = await request.json();
    const { business_id: _ignoredClientBiz, user_id, updated_by, ...updates } = body;
    const userId = getUserIdFromRequest(request, body) || updated_by;
    const business_id = getSessionScopedBusinessId(request);

    if (!business_id) {
      return NextResponse.json(
        { error: 'business scope is required', code: 'TENANT_SCOPE_REQUIRED' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id or updated_by is required for authorization' },
        { status: 400 }
      );
    }

    // Check if account exists and belongs to business
    const accountBeforeCheck = await queryOne(
      'SELECT id, business_id FROM accounts WHERE id = $1 AND business_id = $2',
      [accountId, business_id]
    );

    if (!accountBeforeCheck) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission
    try {
      await authorize(userId, 'settings', 'update', { businessId: business_id, resourceId: accountId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get account details including is_system flag
    const existing = await queryOne(
      'SELECT id, is_system FROM accounts WHERE id = $1 AND business_id = $2',
      [accountId, business_id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Prevent editing system accounts (except description and sort_order)
    if (existing.is_system) {
      const allowedFields = ['description', 'sort_order', 'is_active'];
      const updateKeys = Object.keys(updates);
      const invalidFields = updateKeys.filter(key => !allowedFields.includes(key));
      
      if (invalidFields.length > 0) {
        return NextResponse.json(
          { error: `Cannot update system account fields: ${invalidFields.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // Check if account has transactions (prevent deleting account_code if used)
    if (updates.account_code && updates.account_code !== existing.account_code) {
      const hasTransactions = await queryOne(
        'SELECT COUNT(*) as count FROM ledger_entries WHERE account_id = $1',
        [accountId]
      );

      if (parseInt(hasTransactions?.count || '0') > 0) {
        return NextResponse.json(
          { error: 'Cannot change account code for account with transactions' },
          { status: 400 }
        );
      }
    }

    // Build dynamic UPDATE query
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramIndex}`);
        updateValues.push(value);
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(accountId, business_id);

    const account = await queryOne<Account>(
      `UPDATE accounts
       SET ${updateFields.join(', ')}
       WHERE id = $${paramIndex} AND business_id = $${paramIndex + 1}
       RETURNING *`,
      updateValues
    );

    return NextResponse.json({ account });
  } catch (error: any) {
    console.error('Error updating account:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/accounts/[id]
 * Delete account (soft delete - set is_active = false)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const accountId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

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

    // Check if account exists
    const existing = await queryOne(
      'SELECT id, is_system, business_id FROM accounts WHERE id = $1 AND business_id = $2',
      [accountId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check delete permission
    try {
      await authorize(userId, 'settings', 'delete', { businessId: existing.business_id, resourceId: accountId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Prevent deleting system accounts
    if (existing.is_system) {
      return NextResponse.json(
        { error: 'Cannot delete system account' },
        { status: 400 }
      );
    }

    // Check if account has transactions
    const hasTransactions = await queryOne(
      'SELECT COUNT(*) as count FROM ledger_entries WHERE account_id = $1',
      [accountId]
    );

    if (parseInt(hasTransactions?.count || '0') > 0) {
      // Soft delete - set is_active = false
      await query(
        'UPDATE accounts SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2',
        [accountId, businessId]
      );
      return NextResponse.json({ message: 'Account deactivated (has transactions)' });
    }

    // Hard delete if no transactions
    await query('DELETE FROM accounts WHERE id = $1 AND business_id = $2', [accountId, businessId]);

    return NextResponse.json({ message: 'Account deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting account:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

