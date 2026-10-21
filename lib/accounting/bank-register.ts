import type { PoolClient } from 'pg';
import { suggestNextAccountCode } from '@/lib/accounting/account-hierarchy';
import { assertGroupMatchesType, setAccountOpeningBalance } from '@/lib/accounting/account-rules';
import {
  openingBalanceDecision,
  pickBankAssetGroup,
  settlementKind,
  type AccountGroupPick,
} from '@/lib/accounting/settlement-accounts';

export class BankRegisterError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'BankRegisterError';
  }
}

type LedgerRow = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  group_name: string | null;
  is_active: boolean;
};

export async function assertBankLedgerAvailable(
  client: PoolClient,
  businessId: string,
  ledgerAccountId: string,
  exceptBankAccountId?: string | null,
): Promise<LedgerRow> {
  const res = await client.query<LedgerRow>(
    `SELECT a.id, a.account_code, a.account_name, a.account_type, ag.group_name, a.is_active
       FROM accounts a
       LEFT JOIN account_groups ag ON ag.id = a.account_group_id
      WHERE a.id = $1 AND a.business_id = $2`,
    [ledgerAccountId, businessId],
  );
  const ledger = res.rows[0];
  if (!ledger || !ledger.is_active) {
    throw new BankRegisterError('That ledger account was not found in this business.', 'LEDGER_NOT_FOUND', 404);
  }
  const kind = settlementKind(ledger);
  if (kind !== 'bank') {
    throw new BankRegisterError(
      'Link a bank ledger from the chart. Cash and other accounts cannot be used as a bank register.',
      'LEDGER_NOT_BANK',
    );
  }
  const taken = await client.query<{ id: string }>(
    `SELECT id FROM bank_accounts
      WHERE business_id = $1 AND ledger_account_id = $2 AND id IS DISTINCT FROM $3`,
    [businessId, ledgerAccountId, exceptBankAccountId || null],
  );
  if (taken.rows[0]) {
    throw new BankRegisterError(
      'That ledger is already linked to another bank account.',
      'LEDGER_ALREADY_LINKED',
      409,
    );
  }
  return ledger;
}

export async function createBankLedger(
  client: PoolClient,
  businessId: string,
  accountName: string,
): Promise<string> {
  const name = accountName.trim();
  if (!name) throw new BankRegisterError('A name is required to create the bank ledger.', 'LEDGER_NAME_REQUIRED');
  const head = await client.query<{ account_group_id: string | null }>(
    `SELECT account_group_id FROM accounts WHERE business_id = $1 AND account_code = '1102' AND is_active = true LIMIT 1`,
    [businessId],
  );
  const groups = await client.query<AccountGroupPick>(
    `SELECT id, group_code, group_name, group_type FROM account_groups WHERE business_id = $1`,
    [businessId],
  );
  const namedBank = groups.rows.find((g) => g.group_type === 'asset' && /bank/i.test(g.group_name));
  const groupId = namedBank?.id || head.rows[0]?.account_group_id || pickBankAssetGroup(groups.rows);
  if (!groupId) {
    throw new BankRegisterError('This business has no asset group for a bank ledger.', 'BANK_GROUP_MISSING');
  }
  await assertGroupMatchesType(businessId, groupId, 'asset');
  const codes = await client.query<{ account_code: string }>(
    `SELECT account_code FROM accounts WHERE business_id = $1`,
    [businessId],
  );
  const accountCode = suggestNextAccountCode(
    codes.rows.map((r) => r.account_code),
    'asset',
  );
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO accounts (
       business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order
     ) VALUES ($1, $2, $3, 'asset', $4, 'debit', false, 0)
     RETURNING id`,
    [businessId, accountCode, name, groupId],
  );
  return inserted.rows[0].id;
}

export async function applyBankLedgerOpeningBalance(
  businessId: string,
  ledgerAccountId: string,
  amount: number,
  alreadyHasOpening: boolean,
): Promise<void> {
  const decision = openingBalanceDecision(alreadyHasOpening, amount);
  if (decision === 'skip') return;
  if (decision === 'reject') {
    throw new BankRegisterError(
      'This ledger already has an opening balance. Change it on the chart account. A second opening is not posted.',
      'OPENING_ALREADY_POSTED',
      409,
    );
  }
  await setAccountOpeningBalance({
    businessId,
    accountId: ledgerAccountId,
    amount,
    type: amount < 0 ? 'credit' : 'debit',
  });
}
