import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import { queryOne, query } from '@/lib/db';
import { EmployeeExpense } from '@/types/database';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

function tenantBusinessId(request: NextRequest) {
  return getSessionScopedBusinessId(request);
}

/**
 * PATCH /api/employees/expenses/[id]
 * Update expense (approve, reject, reimburse, cancel)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const expenseId = params.id;
    const body = await request.json();
    const businessId = tenantBusinessId(request);

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const { action, approved_by, rejection_reason, reimbursement_reference, updated_by_user_id } = body;

    if (!action || !['approve', 'reject', 'reimburse', 'cancel', 'update'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be approve, reject, reimburse, cancel, or update' },
        { status: 400 }
      );
    }

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    const expense = await queryOne<EmployeeExpense & { business_id: string }>(
      `SELECT e.*, emp.business_id
       FROM employee_expenses e
       INNER JOIN employees emp ON e.employee_id = emp.id
       WHERE e.id = $1 AND emp.business_id = $2`,
      [expenseId, businessId]
    );

    if (!expense) {
      return NextResponse.json(
        { error: 'Expense not found' },
        { status: 404 }
      );
    }

    try {
      await authorize(updated_by_user_id, 'expenses', 'update', {
        businessId,
        resourceId: expenseId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (action === 'update') {
      if (expense.status !== 'pending') {
        return NextResponse.json(
          { error: 'Only pending expenses can be updated' },
          { status: 400 }
        );
      }

      const {
        expense_category_id,
        expense_date,
        amount,
        description,
        payment_mode,
        vendor_name,
        receipt_url,
        is_billable,
        billable_to_customer_id,
        billable_to_project,
      } = body;

      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (expense_category_id !== undefined) {
        updates.push(`expense_category_id = $${paramIndex++}`);
        params.push(expense_category_id || null);
      }
      if (expense_date !== undefined) {
        updates.push(`expense_date = $${paramIndex++}`);
        params.push(expense_date);
      }
      if (amount !== undefined) {
        updates.push(`amount = $${paramIndex++}`);
        params.push(amount);
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        params.push(description);
      }
      if (payment_mode !== undefined) {
        updates.push(`payment_mode = $${paramIndex++}`);
        params.push(payment_mode || null);
      }
      if (vendor_name !== undefined) {
        updates.push(`vendor_name = $${paramIndex++}`);
        params.push(vendor_name || null);
      }
      if (receipt_url !== undefined) {
        updates.push(`receipt_url = $${paramIndex++}`);
        params.push(receipt_url || null);
      }
      if (is_billable !== undefined) {
        updates.push(`is_billable = $${paramIndex++}`);
        params.push(is_billable);
      }
      if (billable_to_customer_id !== undefined) {
        updates.push(`billable_to_customer_id = $${paramIndex++}`);
        params.push(billable_to_customer_id || null);
      }
      if (billable_to_project !== undefined) {
        updates.push(`billable_to_project = $${paramIndex++}`);
        params.push(billable_to_project || null);
      }

      if (updates.length > 0) {
        const idPlaceholder = paramIndex;
        const bizPlaceholder = paramIndex + 1;
        params.push(expenseId, businessId);
        await query(
          `UPDATE employee_expenses ee SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
           WHERE ee.id = $${idPlaceholder}
             AND EXISTS (SELECT 1 FROM employees emp WHERE emp.id = ee.employee_id AND emp.business_id = $${bizPlaceholder})`,
          params
        );
      }
    } else if (action === 'approve') {
      if (expense.status !== 'pending') {
        return NextResponse.json(
          { error: 'Only pending expenses can be approved' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE employee_expenses ee
         SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         FROM employees emp
         WHERE ee.id = $2 AND ee.employee_id = emp.id AND emp.business_id = $3`,
        [approved_by || null, expenseId, businessId]
      );
    } else if (action === 'reject') {
      if (expense.status !== 'pending') {
        return NextResponse.json(
          { error: 'Only pending expenses can be rejected' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE employee_expenses ee
         SET status = 'rejected', approved_by = $1, rejection_reason = $2, rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         FROM employees emp
         WHERE ee.id = $3 AND ee.employee_id = emp.id AND emp.business_id = $4`,
        [approved_by || null, rejection_reason || null, expenseId, businessId]
      );
    } else if (action === 'reimburse') {
      if (expense.status !== 'approved') {
        return NextResponse.json(
          { error: 'Only approved expenses can be reimbursed' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE employee_expenses ee
         SET status = 'reimbursed', reimbursed_at = CURRENT_TIMESTAMP, reimbursement_reference = $1, updated_at = CURRENT_TIMESTAMP
         FROM employees emp
         WHERE ee.id = $2 AND ee.employee_id = emp.id AND emp.business_id = $3`,
        [reimbursement_reference || null, expenseId, businessId]
      );
    } else if (action === 'cancel') {
      if (expense.status === 'reimbursed') {
        return NextResponse.json(
          { error: 'Reimbursed expenses cannot be cancelled' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE employee_expenses ee
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         FROM employees emp
         WHERE ee.id = $1 AND ee.employee_id = emp.id AND emp.business_id = $2`,
        [expenseId, businessId]
      );
    }

    const updated = await queryOne<EmployeeExpense>(
      `SELECT e.* FROM employee_expenses e
       INNER JOIN employees emp ON e.employee_id = emp.id
       WHERE e.id = $1 AND emp.business_id = $2`,
      [expenseId, businessId]
    );

    return NextResponse.json({ expense: updated });
  } catch (error: any) {
    console.error('Error updating expense:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/employees/expenses/[id]
 * Delete an expense (only if pending or cancelled)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const expenseId = params.id;
    const businessId = tenantBusinessId(request);
    const userId = getUserIdFromRequest(request);

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

    const expense = await queryOne<EmployeeExpense & { business_id: string }>(
      `SELECT e.*, emp.business_id
       FROM employee_expenses e
       INNER JOIN employees emp ON e.employee_id = emp.id
       WHERE e.id = $1 AND emp.business_id = $2`,
      [expenseId, businessId]
    );

    if (!expense) {
      return NextResponse.json(
        { error: 'Expense not found' },
        { status: 404 }
      );
    }

    const { isEmployee } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(userId);

    if (userIsEmployee && userId === expense.employee_id) {
      // Self-service — allowed paths below still enforce status rules
    } else {
      try {
        await authorize(userId, 'expenses', 'delete', { businessId, resourceId: expenseId });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }

      try {
        await assertFeatureAccess(expense.business_id, 'expense_tracking');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    if (expense.status === 'approved' || expense.status === 'reimbursed' || expense.status === 'rejected') {
      return NextResponse.json(
        { error: 'Cannot delete approved, reimbursed, or rejected expenses' },
        { status: 400 }
      );
    }

    await query(
      `DELETE FROM employee_expenses ee
       USING employees emp
       WHERE ee.id = $1 AND ee.employee_id = emp.id AND emp.business_id = $2`,
      [expenseId, businessId]
    );

    return NextResponse.json({ message: 'Expense deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting expense:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
