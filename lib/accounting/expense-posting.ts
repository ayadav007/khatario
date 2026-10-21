import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { getAccountForPaymentMode } from '@/lib/ledger-utils';
import {
  EXPENSE_ACCOUNT_REJECTED,
  EXPENSE_ACCOUNT_REQUIRED,
  isOrdinaryOperatingExpenseAccount,
} from '@/lib/accounting/expense-account-policy';
import type { PlAccountLike } from '@/lib/accounting/pl-sections';
import { requireAccountByCode, insertVoucherLines, round2, type VoucherLine } from '@/lib/accounting/voucher-posting';

export const ON_ACCOUNT_MODES = ['on_account', 'pay_later', 'unpaid', 'credit'];

export type ExpenseTaxInput = {
  /** Bill total. For reverse charge this is what the supplier charges (no GST). */
  amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  itcEligible: boolean;
  isReverseCharge: boolean;
  tdsAmount: number;
};

export type ExpenseSplit = {
  expenseDebit: number;
  input: { cgst: number; sgst: number; igst: number };
  rcmPayable: number;
  tdsPayable: number;
  paymentCredit: number;
};

export class ExpenseValidationError extends Error {}

export type ExpenseJournalLine = {
  role: 'expense' | 'input_gst' | 'rcm' | 'tds' | 'payment';
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  narration: string;
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Same key on an equivalent retry returns the original expense instead of posting again. */
export function readExpenseIdempotencyKey(header: string | null | undefined, bodyValue: unknown): string {
  const raw = (header && header.trim()) || (bodyValue == null ? '' : String(bodyValue).trim());
  if (!IDEMPOTENCY_KEY.test(raw)) {
    throw new ExpenseValidationError('A new expense needs an idempotency key so a retry cannot post it twice.');
  }
  return raw;
}

export const EXPENSE_IDEMPOTENCY_REUSED = 'IDEMPOTENCY_KEY_REUSED';
export const EXPENSE_IDEMPOTENCY_CANCELLED = 'IDEMPOTENCY_REQUEST_CANCELLED';

/** Posting fields only. Identity, the idempotency key, and request transport data are excluded. */
export type ExpensePostingIdentity = {
  businessId: string;
  branchId: string | null;
  categoryId: string | null;
  amount: number;
  description: string | null;
  expenseDate: string;
  paymentMode: string | null;
  referenceNumber: string | null;
  settlementAccountId: string | null;
  cgst: number;
  sgst: number;
  igst: number;
  itcEligible: boolean;
  isReverseCharge: boolean;
  tdsSection: string | null;
  tdsAmount: number;
  supplierId: string | null;
  supplierGstin: string | null;
  supplyReceivedOn: string | null;
  supplierRegistrationStatus: string | null;
};

const textOrNull = (value: unknown): string | null => {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

const calendarDay = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${value.getUTCFullYear()}-${month}-${day}`;
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

/** Stable hash of the expense that will be posted. Key order is fixed. */
export function expensePostingHash(input: ExpensePostingIdentity): string {
  const canonical = {
    amount: round2(input.amount),
    branch_id: textOrNull(input.branchId),
    business_id: input.businessId,
    category_id: textOrNull(input.categoryId),
    cgst: round2(input.cgst),
    description: textOrNull(input.description),
    expense_date: calendarDay(input.expenseDate),
    igst: round2(input.igst),
    is_reverse_charge: input.isReverseCharge === true,
    itc_eligible: input.itcEligible !== false,
    payment_mode: textOrNull(input.paymentMode)?.toLowerCase() ?? null,
    reference_number: textOrNull(input.referenceNumber),
    settlement_account_id: textOrNull(input.settlementAccountId),
    sgst: round2(input.sgst),
    supplier_gstin: textOrNull(input.supplierGstin),
    supplier_id: textOrNull(input.supplierId),
    supplier_registration_status: textOrNull(input.supplierRegistrationStatus)?.toLowerCase() ?? 'unknown',
    supply_received_on: calendarDay(input.supplyReceivedOn),
    tds_amount: round2(input.tdsAmount),
    tds_section: textOrNull(input.tdsSection),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

type StoredExpenseIdentity = {
  deleted_at?: Date | string | null;
  idempotency_payload_hash?: string | null;
  business_id: string;
  branch_id: string | null;
  category_id: string | null;
  amount: string | number;
  description: string | null;
  expense_date: Date | string;
  payment_mode: string | null;
  reference_number: string | null;
  settlement_account_id?: string | null;
  cgst_amount?: string | number | null;
  sgst_amount?: string | number | null;
  igst_amount?: string | number | null;
  itc_eligible?: boolean | null;
  is_reverse_charge?: boolean | null;
  tds_section?: string | null;
  tds_amount?: string | number | null;
  supplier_id?: string | null;
  supplier_gstin?: string | null;
  supply_received_on?: Date | string | null;
  supplier_registration_status?: string | null;
  expense_day?: string | null;
  supply_day?: string | null;
};

/** Rows saved before the hash column keep a null hash and are compared from their stored posting. */
export function hashStoredExpense(row: StoredExpenseIdentity): string {
  return expensePostingHash({
    businessId: row.business_id,
    branchId: row.branch_id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    description: row.description,
    expenseDate: row.expense_day || calendarDay(row.expense_date) || '',
    paymentMode: row.payment_mode,
    referenceNumber: row.reference_number,
    settlementAccountId: row.settlement_account_id ?? null,
    cgst: Number(row.cgst_amount || 0),
    sgst: Number(row.sgst_amount || 0),
    igst: Number(row.igst_amount || 0),
    itcEligible: row.itc_eligible !== false,
    isReverseCharge: row.is_reverse_charge === true,
    tdsSection: row.tds_section ?? null,
    tdsAmount: Number(row.tds_amount || 0),
    supplierId: row.supplier_id ?? null,
    supplierGstin: row.supplier_gstin ?? null,
    supplyReceivedOn: row.supply_day ?? row.supply_received_on ?? null,
    supplierRegistrationStatus: row.supplier_registration_status ?? 'unknown',
  });
}

export type ExpenseIdempotencyDecision = 'replay' | 'conflict' | 'cancelled';

export function decideExpenseIdempotency(row: StoredExpenseIdentity, requestHash: string): ExpenseIdempotencyDecision {
  if (row.deleted_at) return 'cancelled';
  const stored = row.idempotency_payload_hash || hashStoredExpense(row);
  return stored === requestHash ? 'replay' : 'conflict';
}

export function expenseIdempotencyConflictBody(): { error: string; code: typeof EXPENSE_IDEMPOTENCY_REUSED } {
  return {
    error: 'This idempotency key was already used for a different expense. Close this form and add the bill again.',
    code: EXPENSE_IDEMPOTENCY_REUSED,
  };
}

export function expenseIdempotencyCancelledBody(): { error: string; code: typeof EXPENSE_IDEMPOTENCY_CANCELLED } {
  return {
    error: 'This request was already cancelled. It cannot be used to save another expense.',
    code: EXPENSE_IDEMPOTENCY_CANCELLED,
  };
}

/** Pure split of an expense into ledger amounts (validated). */
export function splitExpense(t: ExpenseTaxInput): ExpenseSplit {
  const amount = round2(t.amount);
  const cgst = round2(Math.max(0, t.cgst));
  const sgst = round2(Math.max(0, t.sgst));
  const igst = round2(Math.max(0, t.igst));
  const gst = round2(cgst + sgst + igst);
  const tds = round2(Math.max(0, t.tdsAmount));

  if (!(amount > 0)) throw new ExpenseValidationError('Amount must be greater than zero');
  if ((cgst > 0) !== (sgst > 0)) {
    throw new ExpenseValidationError('For intra-state GST, enter both CGST and SGST (or leave all GST fields empty).');
  }
  if (igst > 0 && cgst > 0) {
    throw new ExpenseValidationError('Enter either IGST (inter-state) or CGST+SGST (intra-state), not both.');
  }

  const taxable = t.isReverseCharge ? amount : round2(amount - gst);
  if (taxable < 0) throw new ExpenseValidationError('GST amounts cannot exceed the expense total amount');
  if (t.isReverseCharge && gst === 0) {
    throw new ExpenseValidationError('Reverse charge expense needs the GST amount payable by you (CGST+SGST or IGST).');
  }
  if (tds > taxable) throw new ExpenseValidationError('TDS cannot exceed the taxable value of the expense');

  const input = t.itcEligible ? { cgst, sgst, igst } : { cgst: 0, sgst: 0, igst: 0 };
  const expenseDebit = t.itcEligible ? taxable : round2(taxable + gst);
  return {
    expenseDebit,
    input,
    rcmPayable: t.isReverseCharge ? gst : 0,
    tdsPayable: tds,
    paymentCredit: round2(amount - tds),
  };
}

type CategoryAccountRow = PlAccountLike & {
  id: string | null;
  account_name: string | null;
  is_active: boolean | null;
  business_id: string | null;
};

/**
 * Resolves the category's debit account and the same journal lines that posting inserts.
 * A missing or unsuitable account fails before any line is written. There is no fallback account.
 */
export async function prepareExpenseVoucher(
  client: PoolClient,
  p: ExpenseTaxInput & {
    businessId: string;
    categoryId: string | null;
    paymentMode: string | null;
    settlementAccountId?: string | null;
    description: string | null;
    lockCategory?: boolean;
  }
): Promise<{ split: ExpenseSplit; lines: ExpenseJournalLine[]; onAccount: boolean }> {
  const split = splitExpense(p);
  const label = p.description || 'Expense';
  if (!p.categoryId) throw new ExpenseValidationError(EXPENSE_ACCOUNT_REQUIRED);

  const locked = await client.query<CategoryAccountRow>(
    `SELECT a.id, a.business_id, a.account_code, a.account_name, a.account_type, a.is_system, a.is_active,
            a.pl_section, ag.group_code, ag.group_type
       FROM expense_categories ec
       LEFT JOIN accounts a ON a.id = ec.account_id
       LEFT JOIN account_groups ag ON ag.id = a.account_group_id
      WHERE ec.id = $1 AND ec.business_id = $2
      ${p.lockCategory ? 'FOR UPDATE OF ec' : ''}`,
    [p.categoryId, p.businessId]
  );
  const account = locked.rows[0];
  if (!account) throw new ExpenseValidationError('Invalid category for this business');
  if (
    !account.id ||
    account.business_id !== p.businessId ||
    account.is_active === false ||
    !isOrdinaryOperatingExpenseAccount(account)
  ) {
    throw new ExpenseValidationError(EXPENSE_ACCOUNT_REJECTED);
  }

  const onAccount = ON_ACCOUNT_MODES.includes(String(p.paymentMode || '').toLowerCase());
  let payAccount: { id: string; account_code: string; account_name: string };
  if (onAccount) {
    const id = await requireAccountByCode(client, p.businessId, '2101', 'Accounts Payable');
    const named = await client.query<{ account_code: string; account_name: string }>(
      `SELECT account_code, account_name FROM accounts WHERE id = $1 AND business_id = $2`,
      [id, p.businessId]
    );
    payAccount = { id, account_code: named.rows[0].account_code, account_name: named.rows[0].account_name };
  } else {
    const acc = await getAccountForPaymentMode(p.businessId, p.paymentMode || 'cash', p.settlementAccountId);
    if (!acc) throw new ExpenseValidationError(`No cash/bank ledger for payment mode "${p.paymentMode || 'cash'}"`);
    payAccount = { id: acc.id, account_code: acc.account_code, account_name: acc.account_name };
  }

  const lines: ExpenseJournalLine[] = [
    {
      role: 'expense',
      accountId: account.id,
      accountCode: account.account_code,
      accountName: account.account_name || account.account_code,
      debit: split.expenseDebit,
      credit: 0,
      narration: label,
    },
  ];
  const inputHeads: Array<[number, string, string]> = [
    [split.input.cgst, '1110', 'Input CGST'],
    [split.input.sgst, '1111', 'Input SGST'],
    [split.input.igst, '1112', 'Input IGST'],
  ];
  for (const [amt, code, name] of inputHeads) {
    if (amt <= 0) continue;
    const id = await requireAccountByCode(client, p.businessId, code, name);
    lines.push({
      role: 'input_gst',
      accountId: id,
      accountCode: code,
      accountName: name,
      debit: amt,
      credit: 0,
      narration: `${name} - ${label}`,
    });
  }
  if (split.rcmPayable > 0) {
    const id = await requireAccountByCode(client, p.businessId, '2155', 'RCM Output Tax Payable');
    lines.push({
      role: 'rcm',
      accountId: id,
      accountCode: '2155',
      accountName: 'RCM Output Tax Payable',
      debit: 0,
      credit: split.rcmPayable,
      narration: `GST payable under reverse charge - ${label}`,
    });
  }
  if (split.tdsPayable > 0) {
    const id = await requireAccountByCode(client, p.businessId, '2102', 'TDS Payable');
    lines.push({
      role: 'tds',
      accountId: id,
      accountCode: '2102',
      accountName: 'TDS Payable',
      debit: 0,
      credit: split.tdsPayable,
      narration: `TDS deducted - ${label}`,
    });
  }
  if (split.paymentCredit > 0) {
    lines.push({
      role: 'payment',
      accountId: payAccount.id,
      accountCode: payAccount.account_code,
      accountName: payAccount.account_name,
      debit: 0,
      credit: split.paymentCredit,
      narration: onAccount ? `Payable (unpaid) - ${label}` : `Payment for expense: ${label}`,
    });
  }
  return { split, lines, onAccount };
}

/**
 * Posts an expense voucher on the caller's transaction:
 * Dr expense (+ input GST when ITC is available) / Cr cash-bank-payable, Cr TDS payable, Cr RCM output.
 * The journal is rebuilt here. Client-supplied lines are never used.
 */
export async function postExpenseVoucher(
  client: PoolClient,
  p: ExpenseTaxInput & {
    businessId: string;
    branchId: string | null;
    expenseId: string;
    expenseDate: string;
    categoryId: string | null;
    paymentMode: string | null;
    settlementAccountId?: string | null;
    description: string | null;
    reference: string | null;
  }
): Promise<ExpenseSplit> {
  const prepared = await prepareExpenseVoucher(client, { ...p, lockCategory: true });
  const lines: VoucherLine[] = prepared.lines.map((line) => ({
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    narration: line.narration,
  }));
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId: p.expenseId,
    voucherType: 'expense',
    entryDate: p.expenseDate,
    reference: p.reference || p.expenseId.substring(0, 8),
    lines,
  });
  return prepared.split;
}
