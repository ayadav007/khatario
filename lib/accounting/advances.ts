import type { PoolClient } from 'pg';
import { round2, type VoucherLine } from './voucher-posting';

export type AdvanceType = 'received' | 'paid';
export type SupplyType = 'goods' | 'services';

export interface TaxSplit {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

const ZERO: TaxSplit = { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };

export const taxOf = (s: TaxSplit) => round2(s.cgst + s.sgst + s.igst + s.cess);

/**
 * GST inside an advance received. Goods advances are not taxed (Notification 66/2017-CT);
 * service advances are taxed on receipt, the amount received being tax-inclusive.
 */
export function splitAdvanceGst(p: {
  amount: number;
  supplyType: SupplyType;
  taxRate: number;
  cessRate?: number;
  intraState: boolean;
  type?: AdvanceType;
}): TaxSplit {
  const amount = round2(p.amount);
  if (p.type === 'paid' || p.supplyType === 'goods' || !(p.taxRate > 0)) return { ...ZERO, taxable: amount };
  const cessRate = p.cessRate && p.cessRate > 0 ? p.cessRate : 0;
  const taxable = round2((amount * 100) / (100 + p.taxRate + cessRate));
  const cess = round2((taxable * cessRate) / 100);
  const gst = round2(amount - taxable - cess);
  if (p.intraState) {
    const cgst = round2(gst / 2);
    return { taxable, cgst, sgst: round2(gst - cgst), igst: 0, cess };
  }
  return { taxable, cgst: 0, sgst: 0, igst: gst, cess };
}

/**
 * Share of the advance's GST released when `portion` of it is adjusted or refunded.
 * The last slice takes whatever tax is left so rounding never strands paise.
 */
export function proportionalReversal(p: {
  advanceAmount: number;
  advanceSplit: TaxSplit;
  consumedBefore: number;
  reversedBefore: TaxSplit;
  portion: number;
}): TaxSplit {
  const remaining = round2(p.advanceAmount - p.consumedBefore);
  const portion = round2(p.portion);
  if (portion <= 0) return { ...ZERO };
  const left: TaxSplit = {
    taxable: round2(p.advanceSplit.taxable - p.reversedBefore.taxable),
    cgst: round2(p.advanceSplit.cgst - p.reversedBefore.cgst),
    sgst: round2(p.advanceSplit.sgst - p.reversedBefore.sgst),
    igst: round2(p.advanceSplit.igst - p.reversedBefore.igst),
    cess: round2(p.advanceSplit.cess - p.reversedBefore.cess),
  };
  if (portion >= remaining - 0.005) return left;
  const f = portion / p.advanceAmount;
  const cgst = Math.min(left.cgst, round2(p.advanceSplit.cgst * f));
  const sgst = Math.min(left.sgst, round2(p.advanceSplit.sgst * f));
  const igst = Math.min(left.igst, round2(p.advanceSplit.igst * f));
  const cess = Math.min(left.cess, round2(p.advanceSplit.cess * f));
  return { taxable: round2(portion - cgst - sgst - igst - cess), cgst, sgst, igst, cess };
}

export interface AdvanceAccounts {
  customerAdvance: string;
  supplierAdvance: string;
  receivable: string;
  payable: string;
  outputCgst: string | null;
  outputSgst: string | null;
  outputIgst: string | null;
  outputCess: string | null;
}

function taxLines(acc: AdvanceAccounts, s: TaxSplit, side: 'debit' | 'credit', label: string): VoucherLine[] {
  const out: VoucherLine[] = [];
  const add = (id: string | null, amt: number, name: string) => {
    if (amt <= 0) return;
    if (!id) throw new Error(`${name} account not found; initialise the chart of accounts`);
    out.push({ accountId: id, debit: side === 'debit' ? amt : 0, credit: side === 'credit' ? amt : 0, narration: label });
  };
  add(acc.outputCgst, s.cgst, 'Output CGST (2150)');
  add(acc.outputSgst, s.sgst, 'Output SGST (2151)');
  add(acc.outputIgst, s.igst, 'Output IGST (2152)');
  add(acc.outputCess, s.cess, 'Output Cess (2153)');
  return out;
}

/** Receipt: customer advance → Dr cash/bank, Cr advance (net) and output GST; supplier advance → Dr 1107, Cr cash/bank. */
export function advanceReceiptLines(p: {
  type: AdvanceType;
  amount: number;
  split: TaxSplit;
  paymentAccountId: string;
  accounts: AdvanceAccounts;
  label: string;
}): VoucherLine[] {
  const amount = round2(p.amount);
  if (p.type === 'paid') {
    return [
      { accountId: p.accounts.supplierAdvance, debit: amount, credit: 0, narration: p.label },
      { accountId: p.paymentAccountId, debit: 0, credit: amount, narration: p.label },
    ];
  }
  return [
    { accountId: p.paymentAccountId, debit: amount, credit: 0, narration: p.label },
    { accountId: p.accounts.customerAdvance, debit: 0, credit: round2(amount - taxOf(p.split)), narration: p.label },
    ...taxLines(p.accounts, p.split, 'credit', p.label),
  ];
}

/**
 * Adjustment against an invoice: Dr advance (net) + Dr output GST reversed, Cr receivable.
 * The invoice already charged the full GST, so reversing the advance's GST avoids paying it twice.
 * Against a purchase: Dr payable, Cr 1107.
 */
export function advanceAdjustmentLines(p: {
  type: AdvanceType;
  amount: number;
  reversal: TaxSplit;
  accounts: AdvanceAccounts;
  label: string;
}): VoucherLine[] {
  const amount = round2(p.amount);
  if (p.type === 'paid') {
    return [
      { accountId: p.accounts.payable, debit: amount, credit: 0, narration: p.label },
      { accountId: p.accounts.supplierAdvance, debit: 0, credit: amount, narration: p.label },
    ];
  }
  return [
    { accountId: p.accounts.customerAdvance, debit: round2(amount - taxOf(p.reversal)), credit: 0, narration: p.label },
    ...taxLines(p.accounts, p.reversal, 'debit', p.label),
    { accountId: p.accounts.receivable, debit: 0, credit: amount, narration: p.label },
  ].filter((l) => l.debit > 0 || l.credit > 0);
}

/** Refund (Rule 51 refund voucher for customer advances): reverse the advance and its GST against cash/bank. */
export function advanceRefundLines(p: {
  type: AdvanceType;
  amount: number;
  reversal: TaxSplit;
  paymentAccountId: string;
  accounts: AdvanceAccounts;
  label: string;
}): VoucherLine[] {
  const amount = round2(p.amount);
  if (p.type === 'paid') {
    return [
      { accountId: p.paymentAccountId, debit: amount, credit: 0, narration: p.label },
      { accountId: p.accounts.supplierAdvance, debit: 0, credit: amount, narration: p.label },
    ];
  }
  return [
    { accountId: p.accounts.customerAdvance, debit: round2(amount - taxOf(p.reversal)), credit: 0, narration: p.label },
    ...taxLines(p.accounts, p.reversal, 'debit', p.label),
    { accountId: p.paymentAccountId, debit: 0, credit: amount, narration: p.label },
  ].filter((l) => l.debit > 0 || l.credit > 0);
}

export function financialYearLabel(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Sequential per-FY voucher numbers (Rule 46/50/51 require a unique serial within the financial year). */
export async function allocateFyVoucherNumber(
  client: PoolClient,
  p: { businessId: string; prefix: string; date: string; table: 'advance_payments' | 'advance_adjustments' }
): Promise<string> {
  const fy = financialYearLabel(p.date);
  const stem = `${p.prefix}/${fy}/`;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fy-voucher:${p.businessId}:${stem}`]);
  const res = await client.query<{ max_seq: number | null }>(
    `SELECT MAX(CAST(SUBSTRING(voucher_number FROM '[0-9]+$') AS INTEGER)) AS max_seq
       FROM ${p.table}
      WHERE business_id = $1 AND voucher_number LIKE $2`,
    [p.businessId, `${stem}%`]
  );
  return `${stem}${String(Number(res.rows[0]?.max_seq || 0) + 1).padStart(5, '0')}`;
}

export async function loadAdvanceAccounts(client: PoolClient, businessId: string): Promise<AdvanceAccounts> {
  const res = await client.query<{ account_code: string; id: string }>(
    `SELECT DISTINCT ON (account_code) account_code, id FROM accounts
      WHERE business_id = $1 AND is_active = true
        AND account_code IN ('1103','1107','2101','2106','2150','2151','2152','2153')
      ORDER BY account_code, created_at`,
    [businessId]
  );
  const by = new Map(res.rows.map((r) => [r.account_code, r.id]));
  const { getMappedAccountId } = await import('@/lib/account-mappings');
  const receivable = await getMappedAccountId(businessId, 'accounts_receivable_account_id', '1103', 'Accounts Receivable');
  const payable = await getMappedAccountId(businessId, 'accounts_payable_account_id', '2101', 'Accounts Payable');
  const need = (code: string, name: string) => {
    const id = by.get(code);
    if (!id) throw new Error(`${name} (${code}) account not found; initialise the chart of accounts`);
    return id;
  };
  return {
    customerAdvance: need('2106', 'Advances from Customers'),
    supplierAdvance: need('1107', 'Advances to Suppliers'),
    receivable: receivable || need('1103', 'Accounts Receivable'),
    payable: payable || need('2101', 'Accounts Payable'),
    outputCgst: by.get('2150') ?? null,
    outputSgst: by.get('2151') ?? null,
    outputIgst: by.get('2152') ?? null,
    outputCess: by.get('2153') ?? null,
  };
}
