import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { Account, AccountGroup } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/accounts
 * List accounts with filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const accountType = searchParams.get('account_type');
    const groupId = searchParams.get('group_id');
    const isActive = searchParams.get('is_active');
    const tree = searchParams.get('tree') === 'true';

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

    // AUTHORIZATION: Check read permission (accounts are part of settings/accounting)
    try {
      await authorize(userId, 'settings', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (tree) {
      // Return hierarchical tree structure
      const accounts = await queryRows<Account & { account_group_name: string }>(`
        SELECT 
          a.*,
          ag.group_name as account_group_name
        FROM accounts a
        LEFT JOIN account_groups ag ON a.account_group_id = ag.id
        WHERE a.business_id = $1
        ORDER BY a.account_code
      `, [businessId]);

      // Build tree structure
      const accountMap = new Map<string, Account & { children?: Account[] }>();
      const rootAccounts: (Account & { children?: Account[] })[] = [];

      accounts.forEach(acc => {
        accountMap.set(acc.id, { ...acc, children: [] });
      });

      accounts.forEach(acc => {
        const account = accountMap.get(acc.id)!;
        if (acc.parent_account_id) {
          const parent = accountMap.get(acc.parent_account_id);
          if (parent) {
            if (!parent.children) parent.children = [];
            parent.children.push(account);
          }
        } else {
          rootAccounts.push(account);
        }
      });

      return NextResponse.json({ accounts: rootAccounts });
    }

    let sql = `
      SELECT 
        a.*,
        ag.group_name as account_group_name,
        ag.group_code as account_group_code
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (accountType) {
      sql += ` AND a.account_type = $${paramIndex}`;
      params.push(accountType);
      paramIndex++;
    }

    if (groupId) {
      sql += ` AND a.account_group_id = $${paramIndex}`;
      params.push(groupId);
      paramIndex++;
    }

    if (isActive !== null) {
      sql += ` AND a.is_active = $${paramIndex}`;
      params.push(isActive === 'true');
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

    sql += ` ORDER BY a.account_code LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const accounts = await queryRows<Account & { account_group_name: string; account_group_code: string }>(sql, params);

    return NextResponse.json({ 
      accounts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/accounts
 * Create a new account
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      account_code,
      account_name,
      account_type,
      account_group_id,
      parent_account_id,
      nature,
      opening_balance = 0,
      opening_balance_type = 'debit',
      description,
      sort_order = 0,
      created_by, // User ID who created the account
    } = body;

    if (!business_id || !account_code || !account_name || !account_type || !account_group_id || !nature) {
      return NextResponse.json(
        { error: 'business_id, account_code, account_name, account_type, account_group_id, and nature are required' },
        { status: 400 }
      );
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (accounts are part of settings/accounting)
    try {
      await authorize(created_by, 'settings', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Validate account code uniqueness
    const existing = await queryOne(
      'SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2',
      [business_id, account_code]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Account code already exists' },
        { status: 409 }
      );
    }

    // Validate nature matches account type
    const validNatures: Record<string, string[]> = {
      asset: ['debit'],
      liability: ['credit'],
      income: ['credit'],
      expense: ['debit'],
      capital: ['credit'],
    };

    if (!validNatures[account_type]?.includes(nature)) {
      return NextResponse.json(
        { error: `Invalid nature for account type ${account_type}. Expected: ${validNatures[account_type]?.join(' or ')}` },
        { status: 400 }
      );
    }

    const account = await queryOne<Account>(
      `INSERT INTO accounts (
        business_id, account_code, account_name, account_type, account_group_id,
        parent_account_id, nature, opening_balance, opening_balance_type,
        description, sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        business_id,
        account_code,
        account_name,
        account_type,
        account_group_id,
        parent_account_id || null,
        nature,
        opening_balance,
        opening_balance_type,
        description || null,
        sort_order,
      ]
    );

    return NextResponse.json({ account }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating account:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

