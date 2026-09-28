import type { PoolClient } from 'pg';
import { getAccountForPaymentMode } from '@/lib/ledger-utils';
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

/**
 * Posts an expense voucher on the caller's transaction:
 * Dr expense (+ input GST when ITC is available) / Cr cash-bank-payable, Cr TDS payable, Cr RCM output.
 */
export async function postExpenseVoucher(
  client: PoolClient,
  p: ExpenseTaxInput & {
    businessId: string;
    branchId: string | null;
    expenseId: string;
    expenseDate: string;
    expenseAccountId: string | null;
    paymentMode: string | null;
    description: string | null;
    reference: string | null;
  }
): Promise<ExpenseSplit> {
  const split = splitExpense(p);
  const label = p.description || 'Expense';

  let expenseAccount = p.expenseAccountId;
  if (expenseAccount) {
    const ok = await client.query(
      `SELECT 1 FROM accounts WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [expenseAccount, p.businessId]
    );
    if (ok.rows.length === 0) {
      throw new ExpenseValidationError('Expense ledger account for this category is missing or inactive');
    }
  } else {
    expenseAccount = await requireAccountByCode(client, p.businessId, '5201', 'Administrative Expenses');
  }

  const onAccount = ON_ACCOUNT_MODES.includes(String(p.paymentMode || '').toLowerCase());
  let payAccount: string;
  if (onAccount) {
    payAccount = await requireAccountByCode(client, p.businessId, '2101', 'Accounts Payable');
  } else {
    const acc = await getAccountForPaymentMode(p.businessId, p.paymentMode || 'cash');
    if (!acc) throw new ExpenseValidationError(`No cash/bank ledger for payment mode "${p.paymentMode || 'cash'}"`);
    payAccount = acc.id;
  }

  const lines: VoucherLine[] = [{ accountId: expenseAccount, debit: split.expenseDebit, credit: 0, narration: label }];
  const inputHeads: Array<[number, string, string]> = [
    [split.input.cgst, '1110', 'Input CGST'],
    [split.input.sgst, '1111', 'Input SGST'],
    [split.input.igst, '1112', 'Input IGST'],
  ];
  for (const [amt, code, name] of inputHeads) {
    if (amt <= 0) continue;
    const id = await requireAccountByCode(client, p.businessId, code, name);
    lines.push({ accountId: id, debit: amt, credit: 0, narration: `${name} - ${label}` });
  }
  if (split.rcmPayable > 0) {
    const id = await requireAccountByCode(client, p.businessId, '2155', 'RCM Output Tax Payable');
    lines.push({ accountId: id, debit: 0, credit: split.rcmPayable, narration: `GST payable under reverse charge - ${label}` });
  }
  if (split.tdsPayable > 0) {
    const id = await requireAccountByCode(client, p.businessId, '2102', 'TDS Payable');
    lines.push({ accountId: id, debit: 0, credit: split.tdsPayable, narration: `TDS deducted - ${label}` });
  }
  if (split.paymentCredit > 0) {
    lines.push({
      accountId: payAccount,
      debit: 0,
      credit: split.paymentCredit,
      narration: onAccount ? `Payable (unpaid) - ${label}` : `Payment for expense: ${label}`,
    });
  }

  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId: p.expenseId,
    voucherType: 'expense',
    entryDate: p.expenseDate,
    reference: p.reference || p.expenseId.substring(0, 8),
    lines,
  });
  return split;
}
