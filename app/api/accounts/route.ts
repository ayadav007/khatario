import { NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { Account } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { withPremiumSubscriptionApi } from '@/lib/security';
import {
  AccountRuleError,
  assertGroupMatchesType,
  setAccountOpeningBalance,
} from '@/lib/accounting/account-rules';
import { isAllowedPlSection, isPlSection, PL_SECTION_LABELS, plSectionFromGroup } from '@/lib/accounting/pl-sections';
import { getClientIP, getUserAgent, logActivity } from '@/lib/activity-logger';
import { hasPlSectionColumn } from '@/lib/accounting/pl-section-column';

export const dynamic = 'force-dynamic';

/**
 * GET /api/accounts
 * List accounts with filters
 */
export const GET = withPremiumSubscriptionApi({}, async (ctx) => {
  try {
    const { searchParams } = new URL(ctx.request.url);
    const businessId = ctx.businessId;
    const userId = ctx.userId;
    const accountType = searchParams.get('account_type');
    const groupId = searchParams.get('group_id');
    const isActive = searchParams.get('is_active');
    const tree = searchParams.get('tree') === 'true';

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
          ag.group_name as account_group_name,
          ag.group_code as account_group_code
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

    const plSectionFilter = searchParams.get('pl_section');
    if (plSectionFilter) {
      if (!isPlSection(plSectionFilter)) {
        return NextResponse.json({ error: `Unknown pl_section ${plSectionFilter}` }, { status: 400 });
      }
      // to_jsonb keeps the query valid on databases without migration 334.
      sql += ` AND to_jsonb(a) ->> 'pl_section' = $${paramIndex}`;
      params.push(plSectionFilter);
      paramIndex++;
    }

    const search = searchParams.get('search')?.trim();
    if (search) {
      sql += ` AND (a.account_code ILIKE $${paramIndex} OR a.account_name ILIKE $${paramIndex} OR ag.group_name ILIKE $${paramIndex})`;
      params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      paramIndex++;
    }

    // Account pickers (journal lines, opening balances, mappings) need every account, so
    // pagination applies only when the caller asks for it.
    if (!searchParams.has('page') && !searchParams.has('limit')) {
      sql += ` ORDER BY a.account_code`;
      const all = await queryRows<Account & { account_group_name: string; account_group_code: string }>(sql, params);
      return NextResponse.json({
        accounts: all,
        pagination: { page: 1, limit: all.length, total: all.length, totalPages: 1 },
      });
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
});

/**
 * POST /api/accounts
 * Create a new account
 */
export const POST = withPremiumSubscriptionApi(
  {
    parseJsonBody: true,
    resolveActingUserId: ({ body, sessionUserId }) => {
      if (body != null && typeof body === 'object') {
        return (body as { created_by?: string }).created_by ?? sessionUserId;
      }
      return sessionUserId;
    },
  },
  async (ctx) => {
    try {
      const body = ctx.body as Record<string, unknown>;
      const {
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
        created_by,
        pl_section,
      } = body as {
        account_code?: string;
        account_name?: string;
        account_type?: string;
        account_group_id?: string;
        parent_account_id?: string;
        nature?: string;
        opening_balance?: number;
        opening_balance_type?: string;
        description?: string;
        sort_order?: number;
        created_by?: string;
        pl_section?: string | null;
      };

      const business_id = ctx.businessId;

      if (!account_code || !account_name || !account_type || !account_group_id || !nature) {
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

      try {
        await assertGroupMatchesType(business_id, account_group_id, account_type);
      } catch (e) {
        if (e instanceof AccountRuleError) {
          return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
        }
        throw e;
      }

      const obAmount = Number(opening_balance) || 0;
      if (obAmount < 0 || (opening_balance_type !== 'debit' && opening_balance_type !== 'credit')) {
        return NextResponse.json(
          { error: 'opening_balance must be non-negative and opening_balance_type debit or credit' },
          { status: 400 }
        );
      }

      // Omitted section = the database default for the group (trigger from migration 334).
      let plSection: string | null = null;
      if (pl_section != null && pl_section !== '') {
        if (!isPlSection(pl_section) || !isAllowedPlSection(account_type, pl_section)) {
          return NextResponse.json(
            { error: `pl_section ${pl_section} is not valid for a ${account_type} account`, code: 'INVALID_PL_SECTION' },
            { status: 400 }
          );
        }
        plSection = pl_section;
      }
      const withSection = plSection !== null && (await hasPlSectionColumn());
      if (plSection !== null && !withSection) {
        const group = await queryOne<{ group_code: string; group_type: string }>(
          'SELECT group_code, group_type FROM account_groups WHERE id = $1',
          [account_group_id]
        );
        if (plSection !== plSectionFromGroup(account_type, group?.group_code, group?.group_type)) {
          return NextResponse.json(
            { error: 'Choosing a P&L section needs database migration 334. Leave the default or run the migration.', code: 'PL_SECTION_UNAVAILABLE' },
            { status: 409 }
          );
        }
      }

      let account = await queryOne<Account>(
        `INSERT INTO accounts (
        business_id, account_code, account_name, account_type, account_group_id,
        parent_account_id, nature, opening_balance, opening_balance_type,
        description, sort_order${withSection ? ', pl_section' : ''}
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10${withSection ? ', $11' : ''})
      RETURNING *`,
        [
          business_id,
          account_code,
          account_name,
          account_type,
          account_group_id,
          parent_account_id || null,
          nature,
          opening_balance_type,
          description || null,
          sort_order,
          ...(withSection ? [plSection] : []),
        ]
      );

      if (account && obAmount > 0) {
        await setAccountOpeningBalance({
          businessId: business_id,
          accountId: account.id,
          amount: obAmount,
          type: opening_balance_type as 'debit' | 'credit',
        });
        account = await queryOne<Account>('SELECT * FROM accounts WHERE id = $1', [account.id]);
      }

      if (account) {
        const section = (account as Account & { pl_section?: string | null }).pl_section;
        await logActivity({
          business_id,
          user_id: created_by,
          action_type: 'create',
          module: 'accounts',
          entity_id: account.id,
          entity_type: 'account',
          description: `Created account ${account.account_code} ${account.account_name}${
            isPlSection(section) ? ` (Profit & Loss: ${PL_SECTION_LABELS[section]})` : ''
          }`,
          ip_address: getClientIP(ctx.request),
          user_agent: getUserAgent(ctx.request),
          metadata: { account_type: account.account_type, account_group_id: account.account_group_id, pl_section: section ?? null },
        });
      }

      return NextResponse.json({ account }, { status: 201 });
    } catch (error: any) {
      console.error('Error creating account:', error);
      return NextResponse.json(
        { error: error.message || 'Internal server error' },
        { status: 500 }
      );
    }
  },
);
