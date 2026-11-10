import type { PoolClient } from 'pg';
import { queryRows } from '@/lib/db';
import { descendantIds } from '@/lib/accounting/account-hierarchy';
import { getMappedAccountId } from '@/lib/account-mappings';
import * as schema from '@/lib/accounting/receivable-accounts-schema';

/**
 * Receivable accounts of a business.
 *
 * The control account is the one mapped as `accounts_receivable_account_id`, else code 1103.
 * A business may split what customers owe into accounts under it (Domestic Debtors, Foreign
 * Debtors, ...), and each customer posts to one of them (`customers.receivable_account_id`,
 * NULL = the control account). Reports that total receivables read the whole set.
 */

export class ReceivableAccountError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

export type ReceivableAccountNode = {
  id: string;
  account_code: string;
  account_name: string;
  parent_account_id: string | null;
  is_active: boolean;
};

type AccountRow = ReceivableAccountNode & { account_type: string };

const LEGACY_CODE_PREFIX = '1103';

/**
 * The control account, any account whose code starts with "1103", and everything under either.
 * Accounts under 1103 stay in the set when a business maps another account as its receivable
 * account, so category accounts and their balances do not drop out of the reports.
 */
export function collectReceivableAccountIds(
  accounts: Array<{ id: string; account_code: string; parent_account_id: string | null }>,
  controlId: string,
): string[] {
  const links = accounts.map((a) => ({ id: a.id, parent_account_id: a.parent_account_id }));
  const roots = [
    controlId,
    ...accounts.filter((a) => String(a.account_code ?? '').startsWith(LEGACY_CODE_PREFIX)).map((a) => a.id),
  ];
  const ids = new Set<string>();
  for (const root of roots) {
    if (ids.has(root)) continue;
    ids.add(root);
    for (const id of descendantIds(links, root)) ids.add(id);
  }
  return [...ids];
}

async function loadAccounts(businessId: string, client?: PoolClient): Promise<AccountRow[]> {
  const sql = `SELECT id, account_code, account_name, parent_account_id, is_active, account_type
                 FROM accounts
                WHERE business_id = $1`;
  if (client) return (await client.query<AccountRow>(sql, [businessId])).rows;
  return queryRows<AccountRow>(sql, [businessId]);
}

export async function receivableControlAccountId(businessId: string): Promise<string> {
  const id = await getMappedAccountId(businessId, 'accounts_receivable_account_id', '1103', 'Accounts Receivable');
  if (!id) {
    throw new ReceivableAccountError(
      'Accounts Receivable account not found. Please set up the chart of accounts.',
      'RECEIVABLE_CONTROL_MISSING',
      500,
    );
  }
  return id;
}

/**
 * The set for reading. It never throws: a business with no usable control account (a partial
 * chart, or Accounts Receivable deactivated) still has its 1103-coded accounts counted, as the
 * reports did before, and a reversal on such a business must not fail for want of the account.
 */
async function loadReceivableSet(businessId: string, client?: PoolClient) {
  const [mapped, accounts] = await Promise.all([
    getMappedAccountId(businessId, 'accounts_receivable_account_id', '1103', 'Accounts Receivable'),
    loadAccounts(businessId, client),
  ]);
  const controlAccountId =
    mapped ?? accounts.find((a) => a.account_code === LEGACY_CODE_PREFIX)?.id ?? null;
  const ids = new Set(
    controlAccountId
      ? collectReceivableAccountIds(accounts, controlAccountId)
      : accounts
          .filter((a) => String(a.account_code ?? '').startsWith(LEGACY_CODE_PREFIX))
          .flatMap((a) => collectReceivableAccountIds(accounts, a.id)),
  );
  return { controlAccountId, accounts, ids };
}

/** Every receivable account of the business; empty when it has none. Never throws for a missing account. */
export async function receivableAccountIds(businessId: string, client?: PoolClient): Promise<string[]> {
  return [...(await loadReceivableSet(businessId, client)).ids];
}

export async function listReceivableAccounts(
  businessId: string,
): Promise<{ controlAccountId: string; accounts: ReceivableAccountNode[] }> {
  const [controlAccountId, { accounts, ids }] = await Promise.all([
    receivableControlAccountId(businessId),
    loadReceivableSet(businessId),
  ]);
  return {
    controlAccountId,
    accounts: accounts
      .filter((a) => ids.has(a.id))
      .sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }))
      .map((a) => ({
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
        parent_account_id: a.parent_account_id,
        is_active: a.is_active,
      })),
  };
}

/**
 * The customer's own receivable account, or null when the customer has none, or the saved one
 * is no longer an active account inside the receivable set (callers then use the control account).
 *
 * With a transaction client the customer row is locked FOR KEY SHARE: a move takes FOR UPDATE,
 * so it cannot run between resolving the account and posting to it. It is not FOR SHARE, which
 * would make two postings for one customer deadlock when each updates the customer's balance.
 */
export async function customerReceivableAccountOverride(
  businessId: string,
  customerId: string | null | undefined,
  client?: PoolClient,
): Promise<string | null> {
  if (!customerId) return null;
  if (!(await schema.hasCustomerReceivableAccounts())) return null;
  const sql = `SELECT receivable_account_id FROM customers WHERE id = $1 AND business_id = $2${client ? ' FOR KEY SHARE' : ''}`;
  const rows = client
    ? (await client.query<{ receivable_account_id: string | null }>(sql, [customerId, businessId])).rows
    : await queryRows<{ receivable_account_id: string | null }>(sql, [customerId, businessId]);
  const saved = rows[0]?.receivable_account_id;
  if (!saved) return null;
  const { accounts, ids } = await loadReceivableSet(businessId, client);
  const account = accounts.find((a) => a.id === saved);
  if (!account || !ids.has(account.id) || !account.is_active) return null;
  return account.id;
}

/** The account a customer's receivable lines post to: their own when valid, else the control account. */
export async function resolveCustomerReceivableAccountId(
  businessId: string,
  customerId: string | null | undefined,
  client?: PoolClient,
): Promise<string> {
  return (
    (await customerReceivableAccountOverride(businessId, customerId, client)) ??
    (await receivableControlAccountId(businessId))
  );
}

/**
 * The account a customer may be assigned: `accountId`, or the control account when null.
 * It must be an active asset account of this business inside the receivable set.
 */
export async function assertReceivableTarget(
  businessId: string,
  accountId: string | null,
  client?: PoolClient,
): Promise<string> {
  const controlAccountId = await receivableControlAccountId(businessId);
  if (!accountId) return controlAccountId;
  const { accounts, ids } = await loadReceivableSet(businessId, client);
  const account = accounts.find((a) => a.id === accountId);
  if (!account || !ids.has(account.id) || !account.is_active || account.account_type !== 'asset') {
    throw new ReceivableAccountError(
      'Choose Accounts Receivable or an active account under it.',
      'RECEIVABLE_ACCOUNT_INVALID',
    );
  }
  return account.id;
}

function customersLabel(count: number): string {
  return count === 1 ? '1 customer posts' : `${count} customers post`;
}

/**
 * Refuses a change that would leave customers posting to an account that is inactive or no
 * longer under Accounts Receivable.
 *
 * - deactivate (also delete): refused while any customer is assigned to the account.
 * - reparent: refused when the account, or an account under it, is assigned to a customer and
 *   the new parent is not a receivable account. Moving it within the receivable accounts is fine.
 */
export async function assertReceivableAccountChangeAllowed(p: {
  businessId: string;
  accountId: string;
  change: { kind: 'deactivate' } | { kind: 'reparent'; newParentId: string | null };
}): Promise<void> {
  if (!(await schema.hasCustomerReceivableAccounts())) return;
  const countUsing = async (accountIds: string[]): Promise<number> => {
    const rows = await queryRows<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM customers
        WHERE business_id = $1 AND receivable_account_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [p.businessId, accountIds],
    );
    return Number(rows[0]?.n) || 0;
  };

  if (p.change.kind === 'deactivate') {
    const using = await countUsing([p.accountId]);
    if (using > 0) {
      throw new ReceivableAccountError(
        `${customersLabel(using)} to this account. Move them to another receivable account first.`,
        'ACCOUNT_IN_USE_BY_CUSTOMERS',
      );
    }
    return;
  }

  const { accounts, ids } = await loadReceivableSet(p.businessId);
  if (!ids.has(p.accountId)) return;
  if (p.change.newParentId && ids.has(p.change.newParentId)) return;
  const subtree = descendantIds(
    accounts.map((a) => ({ id: a.id, parent_account_id: a.parent_account_id })),
    p.accountId,
  );
  subtree.add(p.accountId);
  const using = await countUsing([...subtree]);
  if (using > 0) {
    throw new ReceivableAccountError(
      `${customersLabel(using)} to this account or an account under it, so it must stay under Accounts Receivable.`,
      'ACCOUNT_IN_USE_BY_CUSTOMERS',
    );
  }
}

/**
 * Which customers a "receivable account" filter keeps.
 *
 * An account under Accounts Receivable keeps the customers assigned to it or to an account under
 * it (Foreign Debtors includes USA). The control account keeps only the customers with no account
 * of their own; as a roll-up it would be every customer, which is no filter at all.
 */
export async function receivableAccountFilter(
  businessId: string,
  accountId: string,
): Promise<{ accountIds: string[]; includesUnassigned: boolean }> {
  const controlAccountId = await receivableControlAccountId(businessId);
  if (accountId === controlAccountId) return { accountIds: [], includesUnassigned: true };
  const { accounts, ids } = await loadReceivableSet(businessId);
  if (!ids.has(accountId)) {
    throw new ReceivableAccountError(
      'Choose Accounts Receivable or an account under it.',
      'RECEIVABLE_ACCOUNT_INVALID',
    );
  }
  const subtree = descendantIds(
    accounts.map((a) => ({ id: a.id, parent_account_id: a.parent_account_id })),
    accountId,
  );
  subtree.add(accountId);
  return { accountIds: [...subtree], includesUnassigned: false };
}

/**
 * For reports that show customers by receivable account: the account each of `customerIds`
 * posts to today. A customer missing from `byCustomer` posts to the control account.
 * Never throws for a missing control account (`controlAccountId` is then null).
 */
export async function customerReceivableAccountMap(
  businessId: string,
  customerIds: string[],
): Promise<{
  controlAccountId: string | null;
  accounts: Map<string, ReceivableAccountNode>;
  byCustomer: Map<string, string>;
}> {
  const { controlAccountId, accounts, ids } = await loadReceivableSet(businessId);
  const nodes = new Map<string, ReceivableAccountNode>(
    accounts.filter((a) => ids.has(a.id)).map((a) => [a.id, a]),
  );
  const byCustomer = new Map<string, string>();
  if (customerIds.length > 0 && (await schema.hasCustomerReceivableAccounts())) {
    const rows = await queryRows<{ id: string; receivable_account_id: string }>(
      `SELECT id, receivable_account_id FROM customers
        WHERE business_id = $1 AND id = ANY($2::uuid[]) AND receivable_account_id IS NOT NULL`,
      [businessId, customerIds],
    );
    for (const row of rows) {
      const account = nodes.get(row.receivable_account_id);
      if (account?.is_active) byCustomer.set(row.id, account.id);
    }
  }
  return { controlAccountId, accounts: nodes, byCustomer };
}
