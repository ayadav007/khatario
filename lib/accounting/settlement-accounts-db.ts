import { queryOne, queryRows } from '@/lib/db';
import {
  resolveSettlementAccount,
  settlementKind,
  SettlementAccountError,
  type SettlementAccount,
  type SettlementResolution,
} from '@/lib/accounting/settlement-accounts';

type AccountRow = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  group_name: string | null;
  linked_bank: boolean;
};

export async function listSettlementAccounts(businessId: string): Promise<SettlementAccount[]> {
  const rows = await queryRows<AccountRow>(
    `SELECT a.id, a.account_code, a.account_name, a.account_type, ag.group_name,
            EXISTS (
              SELECT 1 FROM bank_accounts ba
               WHERE ba.business_id = a.business_id
                 AND ba.ledger_account_id = a.id
                 AND COALESCE(ba.is_active, true)
            ) AS linked_bank
       FROM accounts a
       LEFT JOIN account_groups ag ON ag.id = a.account_group_id
      WHERE a.business_id = $1 AND a.is_active = true
      ORDER BY a.account_code`,
    [businessId],
  );
  const out: SettlementAccount[] = [];
  for (const row of rows) {
    const kind = settlementKind(row);
    if (!kind) continue;
    out.push({
      id: row.id,
      code: row.account_code,
      name: row.account_name,
      accountType: row.account_type,
      kind,
    });
  }
  return out;
}

export async function resolveSettlementForBusiness(
  businessId: string,
  mode: string | null | undefined,
  selectedId?: string | null,
): Promise<Extract<SettlementResolution, { ok: true }>> {
  const accounts = await listSettlementAccounts(businessId);
  const resolved = resolveSettlementAccount({ accounts, mode, selectedId });
  if (!resolved.ok) throw new SettlementAccountError(resolved.error, resolved.code);
  return resolved;
}

export function readSettlementAccountId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function ledgerHasOpeningBalance(businessId: string, accountId: string): Promise<boolean> {
  const row = await queryOne<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ledger_entry_lines
        WHERE business_id = $1 AND account_id = $2 AND voucher_type = 'opening_balance'
     ) AS found`,
    [businessId, accountId],
  );
  return !!row?.found;
}
