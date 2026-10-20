import { queryOne, queryRows } from '@/lib/db';
import { signedLedgerBalance } from '@/lib/accounting/ledger-register';

/**
 * My Accounts visibility.
 * Posted activity is a ledger_entry_lines row for this business and account.
 * Opening-balance vouchers are those rows. The accounts.opening_balance column is not activity.
 * Cancelled vouchers leave no row once deleteVoucher has removed their lines.
 * Each account's debit and credit are its own lines. Child totals are not copied onto a parent.
 */

export type MyAccountSource = {
  id: string;
  account_code: string;
  parent_account_id: string | null;
  account_group_id: string | null;
  nature: string | null;
};

export type MyGroupSource = {
  id: string;
  group_code: string;
  parent_group_id: string | null;
};

export type AccountActivity = {
  debit: number;
  credit: number;
  lineCount: number;
};

export type MyAccountVisibilityReason = 'activity' | 'manual' | 'ancestor';

export type VisibleMyAccount = {
  id: string;
  reason: MyAccountVisibilityReason;
  hasActivity: boolean;
  debit: number;
  credit: number;
  balance: number;
};

const MANUAL_KEY = 'my_account_ids';

export function resolveMyAccounts(opts: {
  accounts: MyAccountSource[];
  groups: MyGroupSource[];
  activityByAccount: Map<string, AccountActivity>;
  manualAccountIds: Iterable<string>;
}): { accounts: VisibleMyAccount[]; groupIds: string[] } {
  const byId = new Map(opts.accounts.map((account) => [account.id, account]));
  const manual = new Set<string>();
  for (const id of opts.manualAccountIds) {
    if (byId.has(id)) manual.add(id);
  }

  const reason = new Map<string, MyAccountVisibilityReason>();
  for (const account of opts.accounts) {
    const lines = opts.activityByAccount.get(account.id);
    if ((lines?.lineCount ?? 0) > 0) reason.set(account.id, 'activity');
    else if (manual.has(account.id)) reason.set(account.id, 'manual');
  }

  for (const id of [...reason.keys()]) {
    const seen = new Set<string>();
    let parentId = byId.get(id)?.parent_account_id ?? null;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (!reason.has(parent.id)) reason.set(parent.id, 'ancestor');
      parentId = parent.parent_account_id;
    }
  }

  const accounts: VisibleMyAccount[] = [];
  for (const account of opts.accounts) {
    const why = reason.get(account.id);
    if (!why) continue;
    const lines = opts.activityByAccount.get(account.id);
    const debit = lines?.debit ?? 0;
    const credit = lines?.credit ?? 0;
    accounts.push({
      id: account.id,
      reason: why,
      hasActivity: (lines?.lineCount ?? 0) > 0,
      debit,
      credit,
      balance: signedLedgerBalance(account.nature, debit, credit),
    });
  }

  const groupById = new Map(opts.groups.map((group) => [group.id, group]));
  const groupIds = new Set<string>();
  for (const account of opts.accounts) {
    if (!reason.has(account.id) || !account.account_group_id) continue;
    const seen = new Set<string>();
    let groupId: string | null = account.account_group_id;
    while (groupId && !seen.has(groupId)) {
      seen.add(groupId);
      groupIds.add(groupId);
      groupId = groupById.get(groupId)?.parent_group_id ?? null;
    }
  }

  return {
    accounts,
    groupIds: opts.groups.filter((group) => groupIds.has(group.id)).map((group) => group.id),
  };
}

type AccountQueryRow = MyAccountSource & {
  account_name: string;
  account_type: string;
  is_active: boolean;
  is_system: boolean;
};

type GroupQueryRow = MyGroupSource & {
  group_name: string;
};

export async function loadMyAccounts(businessId: string) {
  const [accounts, groups, activity, manualAccountIds] = await Promise.all([
    queryRows<AccountQueryRow>(
      `SELECT id, account_code, account_name, account_type, nature, is_active, is_system,
              parent_account_id, account_group_id
         FROM accounts
        WHERE business_id = $1
        ORDER BY account_code`,
      [businessId],
    ),
    queryRows<GroupQueryRow>(
      `SELECT id, group_code, group_name, parent_group_id
         FROM account_groups
        WHERE business_id = $1
        ORDER BY group_code`,
      [businessId],
    ),
    queryRows<{ account_id: string; debit: string; credit: string; line_count: string }>(
      `SELECT account_id,
              COALESCE(SUM(debit), 0)::text AS debit,
              COALESCE(SUM(credit), 0)::text AS credit,
              COUNT(*)::text AS line_count
         FROM ledger_entry_lines
        WHERE business_id = $1
        GROUP BY account_id`,
      [businessId],
    ),
    readManualAccountIds(businessId),
  ]);

  const activityByAccount = new Map<string, AccountActivity>();
  for (const row of activity) {
    activityByAccount.set(row.account_id, {
      debit: Number(row.debit),
      credit: Number(row.credit),
      lineCount: Number(row.line_count),
    });
  }

  const resolved = resolveMyAccounts({
    accounts,
    groups,
    activityByAccount,
    manualAccountIds,
  });
  const visible = new Map(resolved.accounts.map((row) => [row.id, row]));
  const groupSet = new Set(resolved.groupIds);

  return {
    accounts: accounts
      .filter((account) => visible.has(account.id))
      .map((account) => {
        const row = visible.get(account.id)!;
        return {
          id: account.id,
          account_code: account.account_code,
          account_name: account.account_name,
          account_type: account.account_type,
          nature: account.nature,
          is_active: account.is_active,
          is_system: account.is_system,
          parent_account_id: account.parent_account_id,
          account_group_id: account.account_group_id,
          reason: row.reason,
          has_activity: row.hasActivity,
          debit: row.debit,
          credit: row.credit,
          balance: row.balance,
        };
      }),
    groups: groups
      .filter((group) => groupSet.has(group.id))
      .map((group) => ({
        id: group.id,
        group_code: group.group_code,
        group_name: group.group_name,
        parent_group_id: group.parent_group_id,
        structural: true as const,
      })),
    manual_account_ids: manualAccountIds.filter((id) => accounts.some((account) => account.id === id)),
  };
}

export async function readManualAccountIds(businessId: string): Promise<string[]> {
  const row = await queryOne<{ ids: unknown }>(
    `SELECT settings -> $2 AS ids
       FROM business_settings
      WHERE business_id = $1`,
    [businessId, MANUAL_KEY],
  );
  if (!Array.isArray(row?.ids)) return [];
  return row.ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export async function saveManualAccountIds(businessId: string, accountIds: string[]): Promise<string[]> {
  const unique = [...new Set(accountIds)];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (unique.some((id) => !uuid.test(id))) {
    const error = new Error('One or more accounts were not found in this business.');
    (error as Error & { code: string }).code = 'ACCOUNT_NOT_FOUND';
    throw error;
  }
  if (unique.length > 0) {
    const found = await queryRows<{ id: string }>(
      `SELECT id FROM accounts WHERE business_id = $1 AND id = ANY($2::uuid[])`,
      [businessId, unique],
    );
    if (found.length !== unique.length) {
      const error = new Error('One or more accounts were not found in this business.');
      (error as Error & { code: string }).code = 'ACCOUNT_NOT_FOUND';
      throw error;
    }
  }

  await queryOne(
    `INSERT INTO business_settings (business_id, settings)
     VALUES ($1, jsonb_build_object($3::text, $2::jsonb))
     ON CONFLICT (business_id) DO UPDATE
       SET settings = COALESCE(business_settings.settings, '{}'::jsonb)
                    || jsonb_build_object($3::text, $2::jsonb),
           updated_at = CURRENT_TIMESTAMP`,
    [businessId, JSON.stringify(unique), MANUAL_KEY],
  );
  return unique;
}
