import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { assertExpenseAccountForBusiness } from '@/lib/expense-category-helpers';

export const dynamic = 'force-dynamic';

import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { DEFAULT_EXPENSE_CATEGORIES } from '@/lib/accounting/default-expense-categories';

/**
 * GET /api/expense-categories
 * Fetch all expense categories for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    await db.query(
      `INSERT INTO expense_categories (business_id, name, account_id, itc_blocked)
       SELECT $1, d.name, a.id, d.blocked
         FROM unnest($2::text[], $3::text[], $4::boolean[]) AS d(name, code, blocked)
         LEFT JOIN accounts a ON a.business_id = $1 AND a.account_code = d.code AND a.is_active = true
       WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE business_id = $1)
       ON CONFLICT (business_id, name) DO NOTHING`,
      [
        businessId,
        DEFAULT_EXPENSE_CATEGORIES.map((c) => c[0]),
        DEFAULT_EXPENSE_CATEGORIES.map((c) => c[1]),
        DEFAULT_EXPENSE_CATEGORIES.map((c) => c[2]),
      ]
    );

    const categories = await db.queryRows(`
      SELECT
        ec.id,
        ec.business_id,
        ec.name,
        ec.description,
        ec.account_id,
        COALESCE(ec.itc_blocked, false) AS itc_blocked,
        ec.created_at,
        ec.updated_at,
        a.account_code AS ledger_account_code,
        a.account_name AS ledger_account_name
      FROM expense_categories ec
      LEFT JOIN accounts a
        ON a.id = ec.account_id AND a.business_id = ec.business_id
      WHERE ec.business_id = $1
      ORDER BY ec.name ASC
    `, [businessId]);

    return NextResponse.json({ categories });
  } catch (error: any) {
    console.error('Error fetching expense categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/expense-categories
 * Create a new expense category
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    const { name, description, account_id } = body;
    const itcBlocked = body.itc_blocked === true || body.itc_blocked === 'true';

    if (!business_id || !name) {
      return NextResponse.json(
        { error: 'business_id and name are required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'expense_tracking');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const acc = await assertExpenseAccountForBusiness(business_id, account_id);
    if (!acc.ok) return acc.response;

    const category = await db.queryOne(`
      INSERT INTO expense_categories (business_id, name, description, account_id, itc_blocked)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, business_id, name, description, account_id, itc_blocked, created_at, updated_at
    `, [business_id, String(name).trim(), description ?? null, account_id || null, itcBlocked]);

    return NextResponse.json({ category }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating expense category:', error);
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to create category', details: error.message },
      { status: 500 }
    );
  }
}

