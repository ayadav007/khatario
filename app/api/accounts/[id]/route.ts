import { NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { Account } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { withPremiumSubscriptionApi } from '@/lib/security';
import {
  AccountRuleError,
  assertGroupMatchesType,
  setAccountOpeningBalance,
} from '@/lib/accounting/account-rules';

export const dynamic = 'force-dynamic';

/** Column names come only from these sets; request keys are never used as SQL identifiers otherwise. */
const EDITABLE_FIELDS = new Set([
  'account_name',
  'account_code',
  'account_group_id',
  'parent_account_id',
  'description',
  'sort_order',
  'is_active',
  'opening_balance',
  'opening_balance_type',
]);
const SYSTEM_EDITABLE_FIELDS = new Set(['description', 'sort_order', 'is_active']);

/**
 * GET /api/accounts/[id]
 * Get account details
 */
export const GET = withPremiumSubscriptionApi<{ id: string }>(
  {},
  async (ctx) => {
    try {
      const accountId = ctx.params.id;
      const { searchParams } = new URL(ctx.request.url);
      const businessId = ctx.businessId;
      const userId = ctx.userId;
      const includeBalance = searchParams.get('include_balance') === 'true';
      const asOnDate = searchParams.get('as_on_date');

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
          ), 0) as balance
        FROM accounts a
        LEFT JOIN ledger_entry_lines le ON le.account_id = a.id AND le.business_id = $2 ${dateFilter}
        WHERE a.id = $1 AND a.business_id = $2
        GROUP BY a.id
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
  },
);

/**
 * PATCH /api/accounts/[id]
 * Update account
 */
export const PATCH = withPremiumSubscriptionApi<{ id: string }>(
  {
    parseJsonBody: true,
    resolveActingUserId: ({ body, sessionUserId }) => {
      if (body != null && typeof body === 'object') {
        const b = body as { user_id?: string; updated_by?: string };
        return b.user_id || b.updated_by || sessionUserId;
      }
      return sessionUserId;
    },
  },
  async (ctx) => {
    try {
      const accountId = ctx.params.id;
      const body = ctx.body as Record<string, unknown>;
      const { business_id: _ignoredClientBiz, user_id, updated_by, ...updates } = body;
      const userId = ctx.userId;
      const business_id = ctx.businessId;

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

      const existing = await queryOne<{
        id: string;
        is_system: boolean;
        account_code: string;
        account_type: string;
        account_group_id: string;
        opening_balance: string;
        opening_balance_type: 'debit' | 'credit';
      }>(
        `SELECT id, is_system, account_code, account_type, account_group_id, opening_balance, opening_balance_type
           FROM accounts WHERE id = $1 AND business_id = $2`,
        [accountId, business_id]
      );

      if (!existing) {
        return NextResponse.json(
          { error: 'Account not found' },
          { status: 404 }
        );
      }

      const updateKeys = Object.keys(updates).filter((k) => updates[k] !== undefined);
      const unknown = updateKeys.filter((k) => !EDITABLE_FIELDS.has(k));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `These fields cannot be updated: ${unknown.join(', ')}`, code: 'FIELD_NOT_EDITABLE' },
          { status: 400 }
        );
      }

      if (existing.is_system) {
        const invalid = updateKeys.filter((k) => !SYSTEM_EDITABLE_FIELDS.has(k));
        if (invalid.length > 0) {
          return NextResponse.json(
            { error: `Cannot update system account fields: ${invalid.join(', ')}` },
            { status: 400 }
          );
        }
      }

      if (updates.account_code !== undefined && updates.account_code !== existing.account_code) {
        const hasTransactions = await queryOne(
          `SELECT COUNT(*) as count FROM ledger_entry_lines
            WHERE account_id = $1 AND business_id = $2 AND voucher_type <> 'opening_balance'`,
          [accountId, business_id]
        );
        if (parseInt(hasTransactions?.count || '0') > 0) {
          return NextResponse.json(
            { error: 'Cannot change account code for account with transactions' },
            { status: 400 }
          );
        }
        const dup = await queryOne(
          'SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2 AND id <> $3',
          [business_id, updates.account_code, accountId]
        );
        if (dup) {
          return NextResponse.json({ error: 'Account code already exists' }, { status: 409 });
        }
      }

      const nextGroup = (updates.account_group_id as string | undefined) ?? existing.account_group_id;
      if (updates.account_group_id !== undefined) {
        try {
          await assertGroupMatchesType(business_id, nextGroup, existing.account_type);
        } catch (e) {
          if (e instanceof AccountRuleError) {
            return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
          }
          throw e;
        }
      }

      if (updates.opening_balance !== undefined || updates.opening_balance_type !== undefined) {
        const amount = updates.opening_balance !== undefined
          ? Number(updates.opening_balance)
          : Number(existing.opening_balance || 0);
        const type = (updates.opening_balance_type ?? existing.opening_balance_type ?? 'debit') as string;
        if (!Number.isFinite(amount) || amount < 0 || (type !== 'debit' && type !== 'credit')) {
          return NextResponse.json(
            { error: 'opening_balance must be a non-negative number and opening_balance_type debit or credit' },
            { status: 400 }
          );
        }
        try {
          await setAccountOpeningBalance({ businessId: business_id, accountId, amount, type });
        } catch (e) {
          if (e instanceof AccountRuleError) {
            return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
          }
          throw e;
        }
      }

      const updateFields: string[] = [];
      const updateValues: unknown[] = [];
      let paramIndex = 1;
      for (const key of updateKeys) {
        if (key === 'opening_balance' || key === 'opening_balance_type') continue;
        updateFields.push(`${key} = $${paramIndex}`);
        updateValues.push(updates[key]);
        paramIndex++;
      }

      if (updateFields.length === 0 && updates.opening_balance === undefined && updates.opening_balance_type === undefined) {
        return NextResponse.json(
          { error: 'No fields to update' },
          { status: 400 }
        );
      }

      let account: Account | null;
      if (updateFields.length > 0) {
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        updateValues.push(accountId, business_id);
        account = await queryOne<Account>(
          `UPDATE accounts
         SET ${updateFields.join(', ')}
         WHERE id = $${paramIndex} AND business_id = $${paramIndex + 1}
         RETURNING *`,
          updateValues
        );
      } else {
        account = await queryOne<Account>('SELECT * FROM accounts WHERE id = $1 AND business_id = $2', [accountId, business_id]);
      }

      return NextResponse.json({ account });
    } catch (error: any) {
      console.error('Error updating account:', error);
      return NextResponse.json(
        { error: error.message || 'Internal server error' },
        { status: 500 }
      );
    }
  },
);

/**
 * DELETE /api/accounts/[id]
 * Delete account (soft delete - set is_active = false)
 */
export const DELETE = withPremiumSubscriptionApi<{ id: string }>(
  {},
  async (ctx) => {
    try {
      const accountId = ctx.params.id;
      const businessId = ctx.businessId;
      const userId = ctx.userId;

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
  },
);
