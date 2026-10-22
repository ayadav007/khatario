import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { prepareExpenseVoucher, ExpenseValidationError, ON_ACCOUNT_MODES } from '@/lib/accounting/expense-posting';
import { parseExpenseTaxFields, type ExpenseCategoryRow } from '@/lib/accounting/expense-fields';
import { readSettlementAccountId, resolveSettlementForBusiness } from '@/lib/accounting/settlement-accounts-db';
import { SettlementAccountError } from '@/lib/accounting/settlement-accounts';
import { buildExpenseBillFromLines, loadExpenseSupplyStates } from '@/lib/accounting/expense-lines';

export const dynamic = 'force-dynamic';

/**
 * POST /api/expenses/preview
 * Journal that prepareExpenseVoucher would post. Nothing is written.
 * The request supplies the bill fields, not journal lines.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const body = await request.json();
    const categoryId = body.category_id && String(body.category_id).trim() ? String(body.category_id).trim() : null;

    try {
      await authorize(session.userId, 'expenses', 'create', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    let category: ExpenseCategoryRow | null = null;
    if (categoryId) {
      category = await db.queryOne<ExpenseCategoryRow>(
        `SELECT account_id, COALESCE(itc_blocked, false) AS itc_blocked
           FROM expense_categories WHERE id = $1 AND business_id = $2`,
        [categoryId, session.businessId]
      );
      if (!category) {
        return NextResponse.json({ error: 'Invalid category_id for this business' }, { status: 400 });
      }
    }
    const tax = parseExpenseTaxFields(body, category);
    const hasLines = Object.prototype.hasOwnProperty.call(body, 'lines');
    let amount = Number(body.amount);
    let cgst = Math.max(0, Number(body.cgst_amount) || 0);
    let sgst = Math.max(0, Number(body.sgst_amount) || 0);
    let igst = Math.max(0, Number(body.igst_amount) || 0);
    let lineBill = null;
    if (hasLines) {
      try {
        const supplierId = body.supplier_id && String(body.supplier_id).trim() ? String(body.supplier_id).trim() : null;
        let supplierGstin: string | null = null;
        if (typeof body.supplier_gstin === 'string' && body.supplier_gstin.trim()) supplierGstin = body.supplier_gstin.trim();
        const supply = await loadExpenseSupplyStates(session.businessId, supplierId, supplierGstin);
        lineBill = await buildExpenseBillFromLines({
          businessId: session.businessId,
          lines: body.lines,
          pricesIncludeGst: body.prices_include_gst === true,
          isReverseCharge: tax.isReverseCharge,
          expenseDate: String(body.expense_date || new Date().toISOString().slice(0, 10)),
          businessState: supply.businessState,
          supplierState: supply.supplierState,
        });
      } catch (lineError) {
        if (lineError instanceof ExpenseValidationError) {
          return NextResponse.json({ error: lineError.message, code: 'EXPENSE_INVALID' }, { status: 400 });
        }
        throw lineError;
      }
      amount = lineBill.amount;
      cgst = lineBill.cgst;
      sgst = lineBill.sgst;
      igst = lineBill.igst;
    }
    const paymentMode = body.payment_mode ? String(body.payment_mode) : 'cash';
    let settlementAccountId: string | null = null;
    try {
      const resolved = await resolveSettlementForBusiness(
        session.businessId,
        paymentMode,
        readSettlementAccountId(body.settlement_account_id)
      );
      settlementAccountId = resolved.accountId;
    } catch (settlementError) {
      if (settlementError instanceof SettlementAccountError) {
        return NextResponse.json(
          { error: settlementError.message, code: settlementError.code },
          { status: settlementError.status }
        );
      }
      throw settlementError;
    }

    const client = await db.getPool().connect();
    try {
      const prepared = await prepareExpenseVoucher(client, {
        businessId: session.businessId,
        categoryId,
        paymentMode,
        settlementAccountId,
        description: body.description ?? null,
        lockCategory: false,
        amount,
        cgst,
        sgst,
        igst,
        ...tax,
      });
      const onAccount = ON_ACCOUNT_MODES.includes(paymentMode.toLowerCase());
      return NextResponse.json({
        on_account: onAccount,
        paid_immediately: !onAccount,
        bill: lineBill
          ? {
              amount: lineBill.amount,
              cgst: lineBill.cgst,
              sgst: lineBill.sgst,
              igst: lineBill.igst,
              intra_state: lineBill.intraState,
            }
          : null,
        lines: prepared.lines.map((line) => ({
          role: line.role,
          account_code: line.accountCode,
          account_name: line.accountName,
          debit: line.debit,
          credit: line.credit,
        })),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof ExpenseValidationError) {
      return NextResponse.json({ error: error.message, code: 'EXPENSE_INVALID' }, { status: 400 });
    }
    console.error('Error previewing expense:', error);
    return NextResponse.json({ error: 'Could not preview this expense' }, { status: 500 });
  }
}
