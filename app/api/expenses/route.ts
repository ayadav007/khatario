import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { postExpenseVoucher, ExpenseValidationError, type ExpenseSplit } from '@/lib/accounting/expense-posting';
import { parseExpenseTaxFields, type ExpenseCategoryRow } from '@/lib/accounting/expense-fields';
import { periodGuardResponse } from '@/lib/http/period-guards';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { FeatureKeys } from '@/lib/featureKeys';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { enforceAccess, enforceAccessErrorResponse, isPrimaryAdminForBusiness } from '@/lib/enforce-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/expenses
 * Fetch all expenses for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const categoryId = searchParams.get('category_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

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

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'expenses', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      return NextResponse.json({ expenses: [] });
    }

    const isAdmin = await isPrimaryAdminForBusiness(userId, businessId).catch(() => false);

    let whereClause = 'WHERE e.business_id = $1';
    const queryParams: any[] = [businessId];
    let paramIndex = 2;

    if (!isAdmin) {
      if (accessibleBranchIds.length === 0) {
        return NextResponse.json({ expenses: [] });
      }
      whereClause += ` AND e.branch_id = ANY($${paramIndex}::uuid[])`;
      queryParams.push(accessibleBranchIds);
      paramIndex++;
    }

    if (categoryId) {
      whereClause += ` AND e.category_id = $${paramIndex}`;
      queryParams.push(categoryId);
      paramIndex++;
    }

    if (fromDate) {
      whereClause += ` AND e.expense_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      whereClause += ` AND e.expense_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    const expenses = await db.queryRows(`
      SELECT 
        e.id, e.business_id, e.category_id, e.amount,
        e.description, e.expense_date, e.payment_mode,
        e.reference_number, e.created_at,
        COALESCE(e.cgst_amount, 0)::float AS cgst_amount,
        COALESCE(e.sgst_amount, 0)::float AS sgst_amount,
        COALESCE(e.igst_amount, 0)::float AS igst_amount,
        COALESCE(e.itc_eligible, true) AS itc_eligible,
        COALESCE(e.is_reverse_charge, false) AS is_reverse_charge,
        e.tds_section,
        COALESCE(e.tds_amount, 0)::float AS tds_amount,
        e.supplier_id, e.branch_id,
        ec.name AS category_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      ${whereClause}
      ORDER BY e.expense_date DESC, e.created_at DESC
    `, queryParams);

    return NextResponse.json({ expenses });
  } catch (error: any) {
    console.error('Error fetching expenses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch expenses', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/expenses
 * Create a new expense
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      branch_id, // MANDATORY: Branch (accounting entity) that incurred this expense
      category_id: rawCategoryId,
      amount,
      description,
      expense_date,
      payment_mode,
      reference_number,
      created_by,
      /** When payment_mode is on_account, optional supplier to increase “amount you owe” (matches Payment Out). */
      supplier_id: rawSupplierId,
      /** Optional: GST on B2B expense bill (ITC). Taxable expense = amount − (cgst+sgst+igst). */
      cgst_amount: rawCgst,
      sgst_amount: rawSgst,
      igst_amount: rawIgst,
    } = body;

    const category_id =
      rawCategoryId && String(rawCategoryId).trim() ? String(rawCategoryId).trim() : null;

    const isOnAccount = ['on_account', 'pay_later', 'unpaid', 'credit'].includes(
      String(payment_mode || '').toLowerCase()
    );
    const supplier_id =
      rawSupplierId && String(rawSupplierId).trim() ? String(rawSupplierId).trim() : null;

    const cgstAmt = Math.max(0, Number(rawCgst) || 0);
    const sgstAmt = Math.max(0, Number(rawSgst) || 0);
    const igstAmt = Math.max(0, Number(rawIgst) || 0);
    const expenseGstTotal = cgstAmt + sgstAmt + igstAmt;
    if (expenseGstTotal > Number(amount)) {
      return NextResponse.json(
        { error: 'GST amounts cannot exceed the expense total amount' },
        { status: 400 }
      );
    }
    const intraComponents = (cgstAmt > 0 ? 1 : 0) + (sgstAmt > 0 ? 1 : 0);
    if (intraComponents === 1) {
      return NextResponse.json(
        {
          error:
            'For intra-state GST, enter both CGST and SGST (or leave all GST fields empty).',
        },
        { status: 400 }
      );
    }
    if (igstAmt > 0 && intraComponents > 0) {
      return NextResponse.json(
        {
          error: 'Enter either IGST (inter-state) or CGST+SGST (intra-state), not both.',
        },
        { status: 400 }
      );
    }

    if (isOnAccount && supplier_id) {
      const s = await db.queryOne<{ id: string }>(
        `SELECT id FROM suppliers WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [supplier_id, business_id]
      );
      if (!s) {
        return NextResponse.json(
          { error: 'Invalid supplier_id for this business (or supplier is inactive)' },
          { status: 400 }
        );
      }
    }

    if (!business_id || !amount || !expense_date) {
      return NextResponse.json(
        { error: 'business_id, amount, and expense_date are required' },
        { status: 400 }
      );
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branch_id,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // AUTHORIZATION: Check create permission with branch context
    try {
      await authorize(created_by, 'expenses', 'create', { branchId: finalBranchId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId: created_by,
        branchId: finalBranchId,
        feature: FeatureKeys.EXPENSE_TRACKING,
        limitType: 'expenses',
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    // CRITICAL: Check period lock BEFORE creating expense
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(business_id, finalBranchId, expense_date, 'expense');
    } catch (error: any) {
      return NextResponse.json(
        { 
          error: error.message || 'Period is locked',
          code: 'PERIOD_LOCKED'
        },
        { status: 403 }
      );
    }

    // CRITICAL: Validate backdated entry
    const { validateBackdate, hasBackdateApprovalPermission } = await import('@/lib/backdate-controls');
    const backdateValidation = validateBackdate(expense_date, 365, 30);
    
    if (backdateValidation.isBackdated) {
      if (backdateValidation.error) {
        return NextResponse.json(
          { 
            error: backdateValidation.error,
            code: 'BACKDATE_EXCEEDS_LIMIT',
            days_backdated: backdateValidation.daysBackdated
          },
          { status: 400 }
        );
      }
      
      if (backdateValidation.requiresApproval && created_by) {
        const hasApproval = await hasBackdateApprovalPermission(created_by, backdateValidation.daysBackdated);
        
        if (!hasApproval) {
          return NextResponse.json(
            { 
              error: `Backdated expenses > 30 days require approval. Expense date is ${backdateValidation.daysBackdated} days old.`,
              code: 'BACKDATE_APPROVAL_REQUIRED',
              days_backdated: backdateValidation.daysBackdated
            },
            { status: 403 }
          );
        }
      }
    }

    const gstGuard = await periodGuardResponse({
      businessId: business_id,
      branchId: finalBranchId,
      dates: [expense_date],
      action: 'record this expense',
      checkGstFiled: expenseGstTotal > 0,
    });
    if (gstGuard) return gstGuard;

    let category: ExpenseCategoryRow | null = null;
    if (category_id) {
      category = await db.queryOne<ExpenseCategoryRow>(
        `SELECT account_id, COALESCE(itc_blocked, false) AS itc_blocked
           FROM expense_categories WHERE id = $1 AND business_id = $2`,
        [category_id, business_id]
      );
      if (!category) {
        return NextResponse.json({ error: 'Invalid category_id for this business' }, { status: 400 });
      }
    }
    const tax = parseExpenseTaxFields(body, category);

    let expense: any;
    let split: ExpenseSplit;
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO expenses (
           business_id, branch_id, category_id, amount, description,
           expense_date, payment_mode, reference_number, created_by,
           cgst_amount, sgst_amount, igst_amount,
           itc_eligible, is_reverse_charge, tds_section, tds_amount, supplier_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          business_id, finalBranchId, category_id || null, amount, description,
          expense_date, payment_mode, reference_number, created_by,
          cgstAmt, sgstAmt, igstAmt,
          tax.itcEligible, tax.isReverseCharge, tax.tdsSection, tax.tdsAmount,
          isOnAccount ? supplier_id : null,
        ]
      );
      expense = ins.rows[0];
      split = await postExpenseVoucher(client, {
        businessId: business_id,
        branchId: finalBranchId,
        expenseId: expense.id,
        expenseDate: expense_date,
        expenseAccountId: category?.account_id ?? null,
        paymentMode: payment_mode,
        description: description ?? null,
        reference: reference_number ?? null,
        amount: Number(amount),
        cgst: cgstAmt,
        sgst: sgstAmt,
        igst: igstAmt,
        ...tax,
      });
      if (isOnAccount && supplier_id) {
        await client.query(
          `UPDATE suppliers
           SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND business_id = $3`,
          [split.paymentCredit, supplier_id, business_id]
        );
      }
      await client.query('COMMIT');
    } catch (ledgerError: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Error creating expense:', ledgerError);
      const validation = ledgerError instanceof ExpenseValidationError;
      return NextResponse.json(
        {
          error:
            ledgerError?.message ||
            'Could not post this expense to the ledger. Fix the issue below and try again.',
          code: validation ? 'EXPENSE_INVALID' : 'LEDGER_POST_FAILED',
        },
        { status: validation ? 400 : 500 }
      );
    } finally {
      client.release();
    }

    // CRITICAL: Log activity for audit trail
    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    
    await logActivity({
      business_id,
      user_id: created_by || null,
      action_type: 'create',
      module: 'expenses',
      entity_id: expense.id,
      entity_type: 'expense',
      description: `Created expense dated ${expense_date}${isOnAccount ? ' (on account / unpaid)' : ''}${backdateValidation.isBackdated ? ` (backdated ${backdateValidation.daysBackdated} days)` : ''}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: {
        expense_date,
        branch_id: finalBranchId,
        amount: Number(amount),
        is_backdated: backdateValidation.isBackdated,
        days_backdated: backdateValidation.daysBackdated,
        backdate_reason: (body as any).backdate_reason || null
      }
    });

    return NextResponse.json({ expense }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating expense:', error);
    return NextResponse.json(
      { error: 'Failed to create expense', details: error.message },
      { status: 500 }
    );
  }
}

