import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { AccountGroup } from '@/types/database';

/**
 * GET /api/accounts/groups
 * List account groups
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const groupType = searchParams.get('group_type');
    const tree = searchParams.get('tree') === 'true';

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

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
}

/**
 * POST /api/accounts/groups
 * Create a new account group
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      group_code,
      group_name,
      group_type,
      parent_group_id,
      sort_order = 0,
    } = body;

    if (!business_id || !group_code || !group_name || !group_type) {
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
}

