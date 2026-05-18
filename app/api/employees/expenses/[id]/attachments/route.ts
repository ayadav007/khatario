import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { ExpenseAttachment } from '@/types/database';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/employees/expenses/[id]/attachments
 * Get attachments for an expense
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const expenseId = params.id;

    const attachments = await queryRows<ExpenseAttachment>(
      'SELECT * FROM expense_attachments WHERE expense_id = $1 ORDER BY uploaded_at ASC',
      [expenseId]
    );

    return NextResponse.json({ attachments });
  } catch (error: any) {
    console.error('Error fetching attachments:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/expenses/[id]/attachments
 * Add attachment to an expense
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const expenseId = params.id;
    const { searchParams } = new URL(request.url);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const body = await request.json();
    const { file_name, file_url, file_type, file_size } = body;

    if (!file_name || !file_url) {
      return NextResponse.json(
        { error: 'file_name and file_url are required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Verify expense exists and get business_id and employee_id
    const expense = await queryOne<{ id: string; business_id: string; employee_id: string }>(
      `SELECT e.id, e.employee_id, emp.business_id
       FROM employee_expenses e
       INNER JOIN employees emp ON e.employee_id = emp.id
       WHERE e.id = $1`,
      [expenseId]
    );

    if (!expense) {
      return NextResponse.json(
        { error: 'Expense not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Employee self-service - allow if user is employee accessing own expense OR has permission
    const { isEmployee } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(userId);
    
    // If user is employee accessing own expense, allow without subscription feature check
    if (userIsEmployee && userId === expense.employee_id) {
      // Self-service access allowed - no subscription feature check needed
    } else {
      // Portal user or accessing other employee's expense - require subscription feature
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
      [expenseId, file_name, file_url, file_type || null, file_size || null]
    );

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error: any) {
    console.error('Error adding attachment:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

