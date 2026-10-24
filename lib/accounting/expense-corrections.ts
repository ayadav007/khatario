import type { PoolClient } from 'pg';
import { round2 } from '@/lib/accounting/voucher-posting';
import { postExpenseVoucher, ON_ACCOUNT_MODES, ExpenseValidationError } from '@/lib/accounting/expense-posting';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';

export const EXPENSE_EDIT_CONFLICT = 'EXPENSE_EDIT_CONFLICT';

export class ExpenseEditConflictError extends Error {
  readonly code = EXPENSE_EDIT_CONFLICT;
  constructor() {
    super('Another edit to this expense was saved. Reload the latest expense and try again.');
  }
}

/** Microsecond text of expenses.updated_at. The edit form sends this string back unchanged. */
export function expenseVersionSql(expression = 'updated_at'): string {
  return `to_char(${expression}, 'YYYY-MM-DD HH24:MI:SS.US')`;
}

export function expenseVersionsMatch(stored: string | null, expected: unknown): boolean {
  if (expected === null) return stored === null;
  return typeof expected === 'string' && stored === expected;
}

export type ExpenseRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  category_id: string | null;
  amount: string;
  description: string | null;
  expense_date: string;
  payment_mode: string | null;
  settlement_account_id?: string | null;
  reference_number: string | null;
  cgst_amount: string | null;
  sgst_amount: string | null;
  igst_amount: string | null;
  itc_eligible: boolean | null;
  is_reverse_charge: boolean | null;
  tds_section: string | null;
  tds_amount: string | null;
  supplier_id: string | null;
  supplier_gstin?: string | null;
  supply_received_on?: string | null;
  supplier_registration_status?: string | null;
  prices_include_gst?: boolean | null;
  updated_at?: string | null;
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

const CURRENT_EXPENSE_SQL = `SELECT id, business_id, branch_id, category_id, amount::text AS amount, description,
            to_char(expense_date, 'YYYY-MM-DD') AS expense_date, payment_mode, settlement_account_id,
            reference_number, cgst_amount::text AS cgst_amount, sgst_amount::text AS sgst_amount,
            igst_amount::text AS igst_amount, itc_eligible, is_reverse_charge, tds_section,
            tds_amount::text AS tds_amount, supplier_id, supplier_gstin,
            to_char(supply_received_on, 'YYYY-MM-DD') AS supply_received_on,
            supplier_registration_status,
            COALESCE(prices_include_gst, false) AS prices_include_gst,
            ${expenseVersionSql('updated_at')} AS updated_at
       FROM expenses
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
      FOR UPDATE`;

/** Expense row first, then supplier rows in id order, so two corrections cannot deadlock. */
async function lockSuppliersInOrder(
  client: PoolClient,
  businessId: string,
  supplierIds: Array<string | null | undefined>
) {
  const ids = [...new Set(supplierIds.filter((id): id is string => !!id))].sort();
  for (const id of ids) {
    await client.query(`SELECT id FROM suppliers WHERE id = $1 AND business_id = $2 FOR UPDATE`, [id, businessId]);
  }
}

async function lockCurrentExpense(client: PoolClient, businessId: string, expenseId: string): Promise<ExpenseRow | null> {
  const locked = await client.query<ExpenseRow>(CURRENT_EXPENSE_SQL, [expenseId, businessId]);
  return locked.rows[0] ?? null;
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
    expectedUpdatedAt: unknown;
  }
): Promise<boolean> {
  const { businessId, old, next, tax } = p;
  if (!next.category_id) {
    throw new ExpenseValidationError('Select a category mapped to an active operating expense account.');
  }
  const current = await lockCurrentExpense(client, businessId, old.id);
  if (!current) return false;
  if (!expenseVersionsMatch(current.updated_at ?? null, p.expectedUpdatedAt)) {
    throw new ExpenseEditConflictError();
  }
  await lockSuppliersInOrder(client, businessId, [current.supplier_id, next.supplier_id]);

  await moveSupplier(client, businessId, current.supplier_id, -supplierDue(current));
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
       reference_number = $8, settlement_account_id = $9, cgst_amount = $10, sgst_amount = $11, igst_amount = $12,
       itc_eligible = $13, is_reverse_charge = $14, tds_section = $15, tds_amount = $16,
       supplier_id = $17, supplier_gstin = $18, supply_received_on = $19,
       supplier_registration_status = $20, prices_include_gst = $21, updated_at = clock_timestamp()
     WHERE id = $1 AND business_id = $2`,
    [
      old.id, businessId, next.category_id, next.amount, next.description, next.expense_date, next.payment_mode,
      next.reference_number, next.settlement_account_id ?? null, next.cgst_amount, next.sgst_amount, next.igst_amount,
      tax.itcEligible, tax.isReverseCharge, tax.tdsSection, tax.tdsAmount, next.supplier_id,
      next.supplier_gstin ?? null, next.supply_received_on ?? null,
      next.supplier_registration_status ?? 'unknown',
      next.prices_include_gst === true,
    ]
  );
  await postExpenseVoucher(client, {
    businessId,
    branchId: old.branch_id,
    expenseId: old.id,
    expenseDate: next.expense_date,
    categoryId: next.category_id,
    paymentMode: next.payment_mode,
    settlementAccountId: next.settlement_account_id,
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
  const current = await lockCurrentExpense(client, p.businessId, p.old.id);
  if (!current) return false;
  await lockSuppliersInOrder(client, p.businessId, [current.supplier_id]);
  await moveSupplier(client, p.businessId, current.supplier_id, -supplierDue(current));
  const del = await client.query(
    `UPDATE expenses SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $3, delete_reason = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [p.old.id, p.businessId, p.userId, p.reason ? p.reason.slice(0, 500) : null]
  );
  if (del.rows.length === 0) return false;
  await reverseVoucherLedgerEntries(client, {
    businessId: p.businessId,
    voucherType: 'expense',
    voucherId: p.old.id,
    reason: 'Expense deleted',
    actorId: p.userId,
  });
  return true;
}
