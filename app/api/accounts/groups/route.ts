import { NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { AccountGroup } from '@/types/database';
import { withPremiumSubscriptionApi } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/accounts/groups
 * List account groups
 */
export const GET = withPremiumSubscriptionApi({}, async (ctx) => {
  try {
    const { searchParams } = new URL(ctx.request.url);
    const businessId = ctx.businessId;
    const groupType = searchParams.get('group_type');
    const tree = searchParams.get('tree') === 'true';

    if (tree) {
      // Return hierarchical tree structure
      const groups = await queryRows<AccountGroup>(`
        SELECT * FROM account_groups
        WHERE business_id = $1
        ORDER BY group_code
      `, [businessId]);

      // Build tree structure
      const groupMap = new Map<string, AccountGroup & { children?: AccountGroup[] }>();
      const rootGroups: (AccountGroup & { children?: AccountGroup[] })[] = [];

      groups.forEach(group => {
        groupMap.set(group.id, { ...group, children: [] });
      });

      groups.forEach(group => {
        const groupNode = groupMap.get(group.id)!;
        if (group.parent_group_id) {
          const parent = groupMap.get(group.parent_group_id);
          if (parent) {
            if (!parent.children) parent.children = [];
            parent.children.push(groupNode);
          }
        } else {
          rootGroups.push(groupNode);
        }
      });

      return NextResponse.json({ groups: rootGroups });
    }

    let sql = `
      SELECT * FROM account_groups
      WHERE business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (groupType) {
      sql += ` AND group_type = $${paramIndex}`;
      params.push(groupType);
      paramIndex++;
    }

    sql += ` ORDER BY group_code`;

    const groups = await queryRows<AccountGroup>(sql, params);

    return NextResponse.json({ groups });
  } catch (error: any) {
    console.error('Error fetching account groups:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/accounts/groups
 * Create a new account group
 */
export const POST = withPremiumSubscriptionApi(
  { parseJsonBody: true },
  async (ctx) => {
    try {
      const body = ctx.body as Record<string, unknown>;
      const {
        group_code,
        group_name,
        group_type,
        parent_group_id,
        sort_order = 0,
      } = body as {
        group_code?: string;
        group_name?: string;
        group_type?: string;
        parent_group_id?: string;
        sort_order?: number;
      };

      const business_id = ctx.businessId;

      if (!group_code || !group_name || !group_type) {
        return NextResponse.json(
          { error: 'business_id, group_code, group_name, and group_type are required' },
          { status: 400 }
        );
      }

      // Validate group code uniqueness
      const existing = await queryOne(
        'SELECT id FROM account_groups WHERE business_id = $1 AND group_code = $2',
        [business_id, group_code]
      );

      if (existing) {
        return NextResponse.json(
          { error: 'Group code already exists' },
          { status: 409 }
        );
      }

      const group = await queryOne<AccountGroup>(
        `INSERT INTO account_groups (
        business_id, group_code, group_name, group_type, parent_group_id, sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
        [
          business_id,
          group_code,
          group_name,
          group_type,
          parent_group_id || null,
          sort_order,
        ]
      );

      return NextResponse.json({ group }, { status: 201 });
    } catch (error: any) {
      console.error('Error creating account group:', error);
      return NextResponse.json(
        { error: error.message || 'Internal server error' },
        { status: 500 }
      );
    }
  },
);
