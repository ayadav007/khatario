import type { PoolClient } from 'pg';
import { round2 } from '@/lib/accounting/voucher-posting';
import { postExpenseVoucher, ON_ACCOUNT_MODES } from '@/lib/accounting/expense-posting';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';

export type ExpenseRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  category_id: string | null;
  amount: string;
  description: string | null;
  expense_date: string;
  payment_mode: string | null;
  reference_number: string | null;
  cgst_amount: string | null;
  sgst_amount: string | null;
  igst_amount: string | null;
  itc_eligible: boolean | null;
  is_reverse_charge: boolean | null;
  tds_section: string | null;
  tds_amount: string | null;
  supplier_id: string | null;
};

export type ExpenseTax = {
  itcEligible: boolean;
  isReverseCharge: boolean;
  tdsSection: string | null;
  tdsAmount: number;
};

export const supplierDue = (e: ExpenseRow) =>
  e.supplier_id && ON_ACCOUNT_MODES.includes(String(e.payment_mode || '').toLowerCase())
    ? round2(Number(e.amount) - Number(e.tds_amount || 0))
    : 0;

async function moveSupplier(client: PoolClient, businessId: string, supplierId: string | null, delta: number) {
  if (!supplierId || delta === 0) return;
  await client.query(
    `UPDATE suppliers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND business_id = $3`,
    [delta, supplierId, businessId]
  );
}

/**
 * Edit on the caller's transaction: the current expense posting is reversed (dated on the
 * original posting) and the corrected expense is posted under the same voucher, so the
 * voucher nets to the new amounts. Returns false when the expense is gone or deleted.
 */
export async function repostExpense(
  client: PoolClient,
  p: {
    businessId: string;
    userId: string;
    old: ExpenseRow;
    next: ExpenseRow;
    tax: ExpenseTax;
    expenseAccountId: string | null;
  }
): Promise<boolean> {
  const { businessId, old, next, tax } = p;
  const locked = await client.query(
    `SELECT 1 FROM expenses WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [old.id, businessId]
  );
  if (locked.rows.length === 0) return false;

  await moveSupplier(client, businessId, old.supplier_id, -supplierDue(old));
  await reverseVoucherLedgerEntries(client, {
    businessId,
    voucherType: 'expense',
    voucherId: old.id,
    reason: 'Expense edited',
    actorId: p.userId,
  });
  await client.query(
    `UPDATE expenses SET
       category_id = $3, amount = $4, description = $5, expense_date = $6, payment_mode = $7,
       reference_number = $8, cgst_amount = $9, sgst_amount = $10, igst_amount = $11,
       itc_eligible = $12, is_reverse_charge = $13, tds_section = $14, tds_amount = $15,
       supplier_id = $16, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2`,
    [
      old.id, businessId, next.category_id, next.amount, next.description, next.expense_date, next.payment_mode,
      next.reference_number, next.cgst_amount, next.sgst_amount, next.igst_amount,
      tax.itcEligible, tax.isReverseCharge, tax.tdsSection, tax.tdsAmount, next.supplier_id,
    ]
  );
  await postExpenseVoucher(client, {
    businessId,
    branchId: old.branch_id,
    expenseId: old.id,
    expenseDate: next.expense_date,
    expenseAccountId: p.expenseAccountId,
    paymentMode: next.payment_mode,
    description: next.description,
    reference: next.reference_number,
    amount: Number(next.amount),
    cgst: Number(next.cgst_amount || 0),
    sgst: Number(next.sgst_amount || 0),
    igst: Number(next.igst_amount || 0),
    ...tax,
  });
  await moveSupplier(client, businessId, next.supplier_id, supplierDue(next));
  return true;
}

/**
 * Delete on the caller's transaction: the expense is marked deleted (row kept) and its
 * posting is reversed. Returns false when the expense is gone or already deleted.
 */
export async function deleteExpenseByReversal(
  client: PoolClient,
  p: { businessId: string; userId: string; old: ExpenseRow; reason: string | null }
): Promise<boolean> {
  const del = await client.query(
    `UPDATE expenses SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $3, delete_reason = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [p.old.id, p.businessId, p.userId, p.reason ? p.reason.slice(0, 500) : null]
  );
  if (del.rows.length === 0) return false;
  await moveSupplier(client, p.businessId, p.old.supplier_id, -supplierDue(p.old));
  await reverseVoucherLedgerEntries(client, {
    businessId: p.businessId,
    voucherType: 'expense',
    voucherId: p.old.id,
    reason: 'Expense deleted',
    actorId: p.userId,
  });
  return true;
}
