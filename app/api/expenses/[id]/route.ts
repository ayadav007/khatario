import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { periodGuardResponse } from '@/lib/http/period-guards';
import { ExpenseValidationError, ON_ACCOUNT_MODES } from '@/lib/accounting/expense-posting';
import { parseExpenseTaxFields, type ExpenseCategoryRow } from '@/lib/accounting/expense-fields';
import { deleteExpenseByReversal, repostExpense, type ExpenseRow } from '@/lib/accounting/expense-corrections';

export const dynamic = 'force-dynamic';

async function loadExpense(id: string, businessId: string): Promise<ExpenseRow | null> {
  return db.queryOne<ExpenseRow>(
    `SELECT id, business_id, branch_id, category_id, amount, description,
            to_char(expense_date, 'YYYY-MM-DD') AS expense_date, payment_mode, reference_number,
            cgst_amount, sgst_amount, igst_amount, itc_eligible, is_reverse_charge,
            tds_section, tds_amount, supplier_id
       FROM expenses WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [id, businessId]
  );
}

const gstOf = (e: Pick<ExpenseRow, 'cgst_amount' | 'sgst_amount' | 'igst_amount'>) =>
  Number(e.cgst_amount || 0) + Number(e.sgst_amount || 0) + Number(e.igst_amount || 0);

async function authz(userId: string, action: 'read' | 'update' | 'delete', branchId: string | null) {
  try {
    await authorize(userId, 'expenses', action, branchId ? { branchId } : undefined);
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const businessId = getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);
  if (!businessId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const expense = await loadExpense(id, businessId);
  if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
  const denied = await authz(userId, 'read', expense.branch_id);
  if (denied) return denied;
  return NextResponse.json({ expense });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await request.json();
    const businessId = getBusinessIdFromRequest(request, body);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const old = await loadExpense(id, businessId);
    if (!old) return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
    const denied = await authz(userId, 'update', old.branch_id);
    if (denied) return denied;

    const next: ExpenseRow = {
      ...old,
      category_id: body.category_id !== undefined ? (body.category_id || null) : old.category_id,
      amount: body.amount !== undefined ? String(body.amount) : old.amount,
      description: body.description !== undefined ? body.description : old.description,
      expense_date: body.expense_date ? String(body.expense_date).slice(0, 10) : old.expense_date,
      payment_mode: body.payment_mode !== undefined ? body.payment_mode : old.payment_mode,
      reference_number: body.reference_number !== undefined ? body.reference_number : old.reference_number,
      cgst_amount: body.cgst_amount !== undefined ? String(Number(body.cgst_amount) || 0) : old.cgst_amount,
      sgst_amount: body.sgst_amount !== undefined ? String(Number(body.sgst_amount) || 0) : old.sgst_amount,
      igst_amount: body.igst_amount !== undefined ? String(Number(body.igst_amount) || 0) : old.igst_amount,
      supplier_id: body.supplier_id !== undefined ? (body.supplier_id || null) : old.supplier_id,
    };
    if (!ON_ACCOUNT_MODES.includes(String(next.payment_mode || '').toLowerCase())) next.supplier_id = null;

    const guard = await periodGuardResponse({
      businessId,
      branchId: old.branch_id,
      dates: [old.expense_date, next.expense_date],
      action: 'edit this expense',
      checkGstFiled: gstOf(old) > 0 || gstOf(next) > 0,
    });
    if (guard) return guard;

    let category: ExpenseCategoryRow | null = null;
    if (next.category_id) {
      category = await db.queryOne<ExpenseCategoryRow>(
        `SELECT account_id, COALESCE(itc_blocked, false) AS itc_blocked
           FROM expense_categories WHERE id = $1 AND business_id = $2`,
        [next.category_id, businessId]
      );
      if (!category) return NextResponse.json({ error: 'Invalid category_id for this business' }, { status: 400 });
    }
    if (next.supplier_id) {
      const s = await db.queryOne(`SELECT 1 FROM suppliers WHERE id = $1 AND business_id = $2`, [next.supplier_id, businessId]);
      if (!s) return NextResponse.json({ error: 'Invalid supplier_id for this business' }, { status: 400 });
    }
    const tax = parseExpenseTaxFields(
      {
        itc_eligible: body.itc_eligible ?? old.itc_eligible ?? undefined,
        is_reverse_charge: body.is_reverse_charge ?? old.is_reverse_charge ?? false,
        tds_section: body.tds_section ?? old.tds_section,
        tds_amount: body.tds_amount ?? old.tds_amount,
      },
      category
    );
    next.itc_eligible = tax.itcEligible;
    next.is_reverse_charge = tax.isReverseCharge;
    next.tds_section = tax.tdsSection;
    next.tds_amount = String(tax.tdsAmount);

    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const ok = await repostExpense(client, {
        businessId,
        userId,
        old,
        next,
        tax,
        expenseAccountId: category?.account_id ?? null,
      });
      if (!ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e instanceof ExpenseValidationError) {
        return NextResponse.json({ error: e.message, code: 'EXPENSE_INVALID' }, { status: 400 });
      }
      throw e;
    } finally {
      client.release();
    }

    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id: businessId,
      user_id: userId,
      action_type: 'update',
      module: 'expenses',
      entity_id: id,
      entity_type: 'expense',
      description: `Edited expense dated ${next.expense_date}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: { before: old, after: next },
    });

    return NextResponse.json({ expense: await loadExpense(id, businessId) });
  } catch (error: any) {
    console.error('Error updating expense:', error);
    return NextResponse.json({ error: 'Failed to update expense', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const old = await loadExpense(id, businessId);
    if (!old) return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
    const denied = await authz(userId, 'delete', old.branch_id);
    if (denied) return denied;

    const guard = await periodGuardResponse({
      businessId,
      branchId: old.branch_id,
      dates: [old.expense_date],
      action: 'delete this expense',
      checkGstFiled: gstOf(old) > 0,
    });
    if (guard) return guard;

    const reason = new URL(request.url).searchParams.get('reason');
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const ok = await deleteExpenseByReversal(client, { businessId, userId, old, reason });
      if (!ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id: businessId,
      user_id: userId,
      action_type: 'delete',
      module: 'expenses',
      entity_id: id,
      entity_type: 'expense',
      description: `Deleted expense dated ${old.expense_date} (₹${Number(old.amount).toFixed(2)})`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: { expense: old },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting expense:', error);
    return NextResponse.json({ error: 'Failed to delete expense', details: error.message }, { status: 500 });
  }
}
