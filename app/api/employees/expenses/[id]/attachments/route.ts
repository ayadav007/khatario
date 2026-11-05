import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { ExpenseAttachment } from '@/types/database';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { loadAccessibleExpense } from '@/lib/hr/expense-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/expenses/[id]/attachments
 * Attachments of one expense. Business users need `expenses` read; a portal employee may only
 * list their own expense. The expense is loaded inside the caller's business only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const access = await loadAccessibleExpense(request, params.id, 'read', 'e.id, e.employee_id');
    if (!access.ok) return access.response;

    const attachments = await queryRows<ExpenseAttachment>(
      'SELECT * FROM expense_attachments WHERE expense_id = $1 ORDER BY uploaded_at ASC',
      [access.expense.id]
    );

    return NextResponse.json({ attachments });
  } catch (error: any) {
    console.error('Error fetching attachments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/employees/expenses/[id]/attachments
 * Add an attachment. A portal employee may attach to their own expense without the plan
 * feature; a business user needs `expenses` update and the `expense_tracking` feature.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const access = await loadAccessibleExpense(request, params.id, 'update', 'e.id, e.employee_id');
    if (!access.ok) return access.response;
    const { actor, expense } = access;

    const body = await request.json();
    const { file_name, file_url, file_type, file_size } = body;

    if (!file_name || !file_url) {
      return NextResponse.json(
        { error: 'file_name and file_url are required' },
        { status: 400 }
      );
    }

    if (!actor.isPortal) {
      try {
        await assertFeatureAccess(expense.business_id, 'expense_tracking');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    const attachment = await queryOne<ExpenseAttachment>(
      `INSERT INTO expense_attachments (expense_id, file_name, file_url, file_type, file_size)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [expense.id, file_name, file_url, file_type || null, file_size || null]
    );

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error: any) {
    console.error('Error adding attachment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
