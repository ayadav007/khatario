import type { PoolClient } from 'pg';
import { getPool, queryOne } from '@/lib/db';
import {
  getFinancialYearStartDate,
  getOrCreateOpeningBalanceAdjustmentAccount,
} from '@/lib/ledger-utils';

export const ACCOUNT_TYPES = ['asset', 'liability', 'income', 'expense', 'capital'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export class AccountRuleError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

/** Account type must match its group's type (elimination groups accept any type). */
export async function assertGroupMatchesType(
  businessId: string,
  groupId: string,
  accountType: string
): Promise<void> {
  const group = await queryOne<{ group_type: string; group_name: string }>(
    `SELECT group_type, group_name FROM account_groups WHERE id = $1 AND business_id = $2`,
    [groupId, businessId]
  );
  if (!group) {
    throw new AccountRuleError('Account group not found', 'GROUP_NOT_FOUND');
  }
  if (group.group_type === 'elimination') return;
  if (group.group_type !== accountType) {
    throw new AccountRuleError(
      `A ${accountType} account cannot be placed under "${group.group_name}" (${group.group_type} group)`,
      'ACCOUNT_TYPE_GROUP_MISMATCH'
    );
  }
}

/**
 * Deletes and re-posts a business-level `opening_balance` voucher:
 * account Dr (signedAmount > 0) or Cr (< 0), contra on the other side.
 */
export async function replaceOpeningVoucher(
  client: PoolClient,
  p: {
    businessId: string;
    voucherId: string;
    accountId: string;
    contraAccountId: string;
    signedAmount: number;
    entryDate: Date | string;
    label: string;
  }
): Promise<void> {
  await client.query(
    `DELETE FROM ledger_entry_lines
      WHERE business_id = $1 AND voucher_id = $2 AND voucher_type = 'opening_balance'`,
    [p.businessId, p.voucherId]
  );
  const amount = Math.round(Math.abs(p.signedAmount) * 100) / 100;
  if (amount === 0) return;
  const dr = p.signedAmount > 0 ? amount : 0;
  const cr = p.signedAmount < 0 ? amount : 0;
  const insert = `INSERT INTO ledger_entry_lines
    (business_id, voucher_id, voucher_type, account_id, entry_date, debit, credit, narration, reference_number, branch_id)
    VALUES ($1, $2, 'opening_balance', $3, $4, $5, $6, $7, $8, NULL)`;
  await client.query(insert, [
    p.businessId, p.voucherId, p.accountId, p.entryDate, dr, cr,
    `Opening balance - ${p.label}`, p.label,
  ]);
  await client.query(insert, [
    p.businessId, p.voucherId, p.contraAccountId, p.entryDate, cr, dr,
    `Opening balance adjustment - ${p.label}`, p.label,
  ]);
}

/**
 * Posts a bank account's opening balance (Dr Bank / Cr 3100; a negative amount is
 * an overdraft). Uses the bank's ledger account, else 1102 Bank Account.
 */
export async function postBankOpeningBalance(p: {
  businessId: string;
  bankAccountId: string;
  ledgerAccountId: string | null;
  amount: number;
  date: string | Date | null;
  label: string;
}): Promise<string | null> {
  let ledgerId = p.ledgerAccountId;
  if (!ledgerId) {
    const bank = await queryOne<{ id: string }>(
      `SELECT id FROM accounts WHERE business_id = $1 AND account_code = '1102' AND is_active = true`,
      [p.businessId]
    );
    ledgerId = bank?.id ?? null;
  }
  if (!ledgerId) return null;
  const obAccount = await getOrCreateOpeningBalanceAdjustmentAccount(p.businessId);
  const entryDate = p.date || (await getFinancialYearStartDate(p.businessId));
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await replaceOpeningVoucher(client, {
      businessId: p.businessId,
      voucherId: p.bankAccountId,
      accountId: ledgerId,
      contraAccountId: obAccount.id,
      signedAmount: Number(p.amount) || 0,
      entryDate,
      label: p.label,
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return ledgerId;
}

/**
 * Opening balances of ledger accounts are posted as an `opening_balance` voucher
 * (voucher_id = account id, business-level, dated the FY start) against
 * 3100 Opening Balance Adjustment, so the trial balance always stays balanced.
 * `accounts.opening_balance` is kept only as the displayed value.
 */
export async function setAccountOpeningBalance(params: {
  businessId: string;
  accountId: string;
  amount: number;
  type: 'debit' | 'credit';
}): Promise<void> {
  const { businessId, accountId, type } = params;
  const amount = Math.round(Math.abs(Number(params.amount) || 0) * 100) / 100;

  const obAccount = await getOrCreateOpeningBalanceAdjustmentAccount(businessId);
  if (obAccount.id === accountId) {
    throw new AccountRuleError(
      'Opening Balance Adjustment is the balancing account and cannot be edited directly',
      'OPENING_ADJUSTMENT_READONLY'
    );
  }
  const account = await queryOne<{ account_name: string }>(
    `SELECT account_name FROM accounts WHERE id = $1 AND business_id = $2`,
    [accountId, businessId]
  );
  if (!account) throw new AccountRuleError('Account not found', 'NOT_FOUND', 404);

  const fyStart = await getFinancialYearStartDate(businessId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await replaceOpeningVoucher(client, {
      businessId,
      voucherId: accountId,
      accountId,
      contraAccountId: obAccount.id,
      signedAmount: type === 'debit' ? amount : -amount,
      entryDate: fyStart,
      label: account.account_name,
    });
    await client.query(
      `UPDATE accounts SET opening_balance = $1, opening_balance_type = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND business_id = $4`,
      [amount, type, accountId, businessId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
