import type { PoolClient } from 'pg';
import { insertVoucherLines, round2, type VoucherLine } from './voucher-posting';

export type ContraKind = 'cash_deposit' | 'cash_withdrawal' | 'bank_transfer';

export interface CashBankAccount {
  id: string;
  code: string;
  name: string;
  kind: 'cash' | 'bank';
}

/**
 * Cash-in-hand (1101), bank (1102, bank OD 2112) and any ledger linked from bank_accounts.
 * A contra voucher may only move money between these.
 */
export async function listCashBankAccounts(client: PoolClient, businessId: string): Promise<CashBankAccount[]> {
  const res = await client.query<{ id: string; account_code: string; account_name: string; is_cash: boolean }>(
    `SELECT a.id, a.account_code, a.account_name,
            (a.account_code = '1101' OR (a.account_name ILIKE '%cash%' AND a.account_code <> '1102')) AS is_cash
       FROM accounts a
      WHERE a.business_id = $1
        AND a.is_active = true
        AND (
          a.account_code IN ('1101', '1102', '2112')
          OR a.id IN (SELECT ledger_account_id FROM bank_accounts
                       WHERE business_id = $1 AND ledger_account_id IS NOT NULL AND COALESCE(is_active, true))
          OR (a.account_type = 'asset' AND (a.account_name ILIKE '%cash%' OR a.account_name ILIKE '%bank%')
              AND a.account_code LIKE '11%')
        )
      ORDER BY a.account_code`,
    [businessId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    code: r.account_code,
    name: r.account_name,
    kind: r.is_cash ? 'cash' : 'bank',
  }));
}

export interface ContraInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  narration?: string | null;
}

export type ContraValidation =
  | { ok: true; kind: ContraKind; lines: VoucherLine[] }
  | { ok: false; error: string; code: string };

/** Dr the account receiving the money, Cr the account it leaves. */
export function buildContraLines(input: ContraInput, accounts: CashBankAccount[]): ContraValidation {
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) return { ok: false, code: 'INVALID_AMOUNT', error: 'Amount must be greater than zero' };
  if (input.fromAccountId === input.toAccountId) {
    return { ok: false, code: 'SAME_ACCOUNT', error: 'From and To accounts must be different' };
  }
  const from = accounts.find((a) => a.id === input.fromAccountId);
  const to = accounts.find((a) => a.id === input.toAccountId);
  if (!from || !to) {
    return {
      ok: false,
      code: 'NOT_CASH_OR_BANK',
      error: 'A contra voucher can only move money between cash and bank accounts',
    };
  }
  if (from.kind === 'cash' && to.kind === 'cash') {
    return { ok: false, code: 'CASH_TO_CASH', error: 'Cash-to-cash transfers are not a contra entry; use a journal' };
  }
  const kind: ContraKind =
    from.kind === 'cash' ? 'cash_deposit' : to.kind === 'cash' ? 'cash_withdrawal' : 'bank_transfer';
  const label =
    input.narration?.trim() ||
    (kind === 'cash_deposit'
      ? `Cash deposited into ${to.name}`
      : kind === 'cash_withdrawal'
        ? `Cash withdrawn from ${from.name}`
        : `Transfer from ${from.name} to ${to.name}`);
  return {
    ok: true,
    kind,
    lines: [
      { accountId: to.id, debit: amount, credit: 0, narration: label },
      { accountId: from.id, debit: 0, credit: amount, narration: label },
    ],
  };
}

export async function allocateContraNumber(client: PoolClient, businessId: string, entryDate: string): Promise<string> {
  const year = String(entryDate).slice(0, 4);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`contra-number:${businessId}`]);
  const res = await client.query<{ max_seq: number | null }>(
    `SELECT MAX(CAST(SUBSTRING(voucher_number FROM '[0-9]+$') AS INTEGER)) AS max_seq
       FROM journal_entries
      WHERE business_id = $1 AND voucher_number LIKE $2`,
    [businessId, `CTR/${year}/%`]
  );
  return `CTR/${year}/${String(Number(res.rows[0]?.max_seq || 0) + 1).padStart(6, '0')}`;
}

export async function postContraVoucher(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    entryDate: string;
    reference: string | null;
    narration: string | null;
    createdBy: string;
    lines: VoucherLine[];
    kind: ContraKind;
  }
): Promise<{ voucherId: string; voucherNumber: string }> {
  const voucherNumber = await allocateContraNumber(client, p.businessId, p.entryDate);
  const idRes = await client.query<{ id: string }>('SELECT uuid_generate_v4() AS id');
  const voucherId = idRes.rows[0].id;
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId,
    voucherType: 'contra',
    entryDate: p.entryDate,
    reference: p.reference,
    lines: p.lines,
  });
  await client.query(
    `INSERT INTO journal_entries (
       business_id, branch_id, voucher_id, voucher_number, entry_date,
       reference_number, narration, is_locked, created_by, tags
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9)`,
    [
      p.businessId,
      p.branchId,
      voucherId,
      voucherNumber,
      p.entryDate,
      p.reference,
      p.narration || p.lines[0]?.narration || null,
      p.createdBy,
      ['contra', p.kind],
    ]
  );
  return { voucherId, voucherNumber };
}
