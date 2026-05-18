import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { assertExpenseAccountForBusiness } from '@/lib/expense-category-helpers';

/**
 * PATCH /api/expense-categories/[id]
 * Update category name, description, or linked ledger expense account.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    const body = await request.json();
    const { business_id, name, description, account_id } = body;

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    try {
      await assertFeatureAccess(business_id, 'expense_tracking');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const existing = await db.queryOne<{ id: string }>(
      `SELECT id FROM expense_categories WHERE id = $1 AND business_id = $2`,
      [id, business_id]
    );
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    if (account_id !== undefined) {
      const acc = await assertExpenseAccountForBusiness(business_id, account_id);
      if (!acc.ok) return acc.response;
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (name !== undefined) {
      if (!String(name).trim()) {
        return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
      }
      updates.push(`name = $${i++}`);
      values.push(String(name).trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${i++}`);
      values.push(description);
    }
    if (account_id !== undefined) {
      updates.push(`account_id = $${i++}`);
      values.push(account_id || null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(id, business_id);
    const category = await db.queryOne(
      `UPDATE expense_categories SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${i++} AND business_id = $${i}
       RETURNING id, business_id, name, description, account_id, created_at, updated_at`,
      values
    );

    return NextResponse.json({ category });
  } catch (error: any) {
    console.error('Error updating expense category:', error);
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to update category', details: error.message },
      { status: 500 }
    );
  }
}
