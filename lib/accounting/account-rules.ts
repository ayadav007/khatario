import type { PoolClient } from 'pg';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { parentCreatesCycle, parentTypeError } from '@/lib/accounting/account-hierarchy';
import { deleteVoucher } from '@/lib/accounting/voucher-posting';
import {
  getDefaultAccounts,
  getFinancialYearStartDate,
  getOrCreateOpeningBalanceAdjustmentAccount,
} from '@/lib/ledger-utils';

export { ACCOUNT_TYPE_VALUES as ACCOUNT_TYPES, type AccountType } from '@/lib/accounting/account-hierarchy';

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
 * Parent account is a ledger relationship, separate from account group.
 * The parent must be another account of the same type in this business,
 * and the link must not point at the account itself or at one of its children.
 */
export async function assertValidParentAccount(opts: {
  businessId: string;
  accountType: string;
  parentAccountId: string | null | undefined;
  accountId?: string | null;
}): Promise<void> {
  const parentId = opts.parentAccountId || null;
  if (!parentId) return;

  const rows = await queryRows<{
    id: string;
    parent_account_id: string | null;
    account_type: string;
  }>(
    `SELECT id, parent_account_id, account_type
       FROM accounts
      WHERE business_id = $1`,
    [opts.businessId]
  );
  const parent = rows.find((row) => row.id === parentId);
  if (!parent) {
    throw new AccountRuleError(
      'Parent account was not found in this business.',
      'PARENT_NOT_FOUND'
    );
  }
  const typeError = parentTypeError(opts.accountType, parent.account_type);
  if (typeError) {
    throw new AccountRuleError(typeError, 'PARENT_TYPE_MISMATCH');
  }
  const cycle = parentCreatesCycle(rows, opts.accountId ?? null, parentId);
  if (cycle === 'self') {
    throw new AccountRuleError('An account cannot be its own parent.', 'PARENT_SELF');
  }
  if (cycle === 'cycle') {
    throw new AccountRuleError(
      'That parent would create a circular account hierarchy.',
      'PARENT_CYCLE'
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
  await deleteVoucher(client, p.businessId, p.voucherId, 'opening_balance', 'regenerate:opening_balance', null);
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
 * an overdraft) to the ledger the caller names. Never falls back to 1102.
 * The voucher id is the bank register row, which is how older opening balances
 * were reversed when that row was deleted.
 */
export async function postBankOpeningBalance(p: {
  businessId: string;
  bankAccountId: string;
  ledgerAccountId: string | null;
  amount: number;
  date: string | Date | null;
  label: string;
}): Promise<string | null> {
  const ledgerId = p.ledgerAccountId;
  if (!ledgerId) {
    throw new AccountRuleError(
      'Choose the bank ledger before posting an opening balance.',
      'BANK_LEDGER_REQUIRED',
    );
  }
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

/**
 * Makes the ledger agree with a customer's or supplier's opening balance after it was edited.
 * (Creation posts it with postOpeningBalanceLedgerEntry; an edit is only allowed while the party
 * has no invoices, bills or payments.) The voucher is the party's id, type `opening_balance`:
 * Dr party account for a debit balance, Cr for a credit balance, against 3100 Opening Balance
 * Adjustment. It keeps the date it was first posted on, else the start of the financial year.
 *
 * Normally the voucher is replaced. A customer who has been moved to another receivable account
 * is different: the old opening line was settled by the move's transfer, so it is left in place
 * and only the difference is posted, on the account the customer posts to now.
 */
export async function setPartyOpeningBalance(p: {
  businessId: string;
  entityType: 'customer' | 'supplier';
  entityId: string;
  entityName: string;
  amount: number;
  type: 'debit' | 'credit';
}): Promise<void> {
  const amount = Math.round(Math.abs(Number(p.amount) || 0) * 100) / 100;
  const signed = p.type === 'debit' ? amount : -amount;

  const accounts = await getDefaultAccounts(p.businessId, {
    customerId: p.entityType === 'customer' ? p.entityId : null,
  });
  const party = p.entityType === 'customer' ? accounts.accountsReceivable : accounts.accountsPayable;
  if (!party) {
    throw new AccountRuleError(
      p.entityType === 'customer'
        ? 'Accounts Receivable account not found. Please set up the chart of accounts.'
        : 'Accounts Payable account not found. Please set up the chart of accounts.',
      'PARTY_ACCOUNT_MISSING',
    );
  }
  const contra = await getOrCreateOpeningBalanceAdjustmentAccount(p.businessId);
  const fyStart = await getFinancialYearStartDate(p.businessId);

  let movedCustomer = false;
  let receivableIds: string[] = [];
  if (p.entityType === 'customer') {
    const { hasCustomerReceivableAccounts } = await import('@/lib/accounting/receivable-accounts-schema');
    if (await hasCustomerReceivableAccounts()) {
      const moved = await queryOne<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM customer_receivable_account_moves
            WHERE business_id = $1 AND customer_id = $2 AND kind = 'move'
         ) AS ok`,
        [p.businessId, p.entityId],
      );
      movedCustomer = !!moved?.ok;
      if (movedCustomer) {
        const { receivableAccountIds } = await import('@/lib/accounting/receivable-accounts');
        receivableIds = await receivableAccountIds(p.businessId);
      }
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const first = await client.query<{ d: Date | string | null }>(
      `SELECT MIN(entry_date) AS d FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'opening_balance' AND voucher_id = $2`,
      [p.businessId, p.entityId],
    );
    const entryDate = first.rows[0]?.d ?? fyStart;

    if (movedCustomer) {
      const posted = await client.query<{ net: string }>(
        `SELECT COALESCE(SUM(debit - credit), 0)::text AS net FROM ledger_entry_lines
          WHERE business_id = $1 AND voucher_type = 'opening_balance' AND voucher_id = $2
            AND account_id = ANY($3::uuid[])`,
        [p.businessId, p.entityId, receivableIds],
      );
      const delta = Math.round((signed - (Number(posted.rows[0]?.net) || 0)) * 100) / 100;
      if (Math.abs(delta) >= 0.005) {
        const dr = delta > 0 ? delta : 0;
        const cr = delta < 0 ? -delta : 0;
        const insert = `INSERT INTO ledger_entry_lines
          (business_id, voucher_id, voucher_type, account_id, entry_date, debit, credit, narration, reference_number, branch_id)
          VALUES ($1, $2, 'opening_balance', $3, $4, $5, $6, $7, $8, NULL)`;
        await client.query(insert, [
          p.businessId, p.entityId, party.id, entryDate, dr, cr,
          `Opening balance - ${p.entityName}`, p.entityName,
        ]);
        await client.query(insert, [
          p.businessId, p.entityId, contra.id, entryDate, cr, dr,
          `Opening balance adjustment - ${p.entityName}`, p.entityName,
        ]);
      }
    } else {
      await replaceOpeningVoucher(client, {
        businessId: p.businessId,
        voucherId: p.entityId,
        accountId: party.id,
        contraAccountId: contra.id,
        signedAmount: signed,
        entryDate,
        label: p.entityName,
      });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

