export const ACCOUNT_TYPE_VALUES = ['asset', 'liability', 'income', 'expense', 'capital'] as const;
export type AccountType = (typeof ACCOUNT_TYPE_VALUES)[number];

/** The only nature the chart-of-accounts API accepts for a user-created account of this type. */
export const NATURE_FOR_TYPE: Record<AccountType, 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  income: 'credit',
  capital: 'credit',
};

export const ACCOUNT_TYPE_HELP: Record<AccountType, string> = {
  asset: 'Cash, bank accounts, inventory and equipment.',
  liability: 'Loans, GST payable and supplier dues.',
  income: 'Sales and other business income.',
  expense: 'Rent, electricity and other business expenses.',
  capital: "Owner's capital and retained earnings.",
};

export const NATURE_HELP: Record<'debit' | 'credit', string> = {
  debit: 'A debit balance means the account normally increases when you debit it. Assets and expenses use debit.',
  credit: 'A credit balance means the account normally increases when you credit it. Liabilities, income and capital use credit.',
};

const CODE_FLOOR: Record<AccountType, number> = {
  asset: 1000,
  liability: 2000,
  capital: 3000,
  income: 4000,
  expense: 5000,
};

export function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPE_VALUES as readonly string[]).includes(value);
}

export function parentTypeError(accountType: string, parentType: string): string | null {
  if (accountType === parentType) return null;
  return `This ${accountType} account can only be placed under another ${accountType} account.`;
}

export function natureForAccountType(accountType: string): 'debit' | 'credit' | null {
  if (!isAccountType(accountType)) return null;
  return NATURE_FOR_TYPE[accountType];
}

/**
 * Next unused numeric code inside the type's existing thousand-range
 * (assets 1xxx, liabilities 2xxx, and so on). Falls through to the next
 * free integer if that range is full.
 */
export function suggestNextAccountCode(existingCodes: string[], accountType: AccountType): string {
  const floor = CODE_FLOOR[accountType];
  const ceiling = floor + 1000;
  const used = new Set(existingCodes.map((c) => c.trim()));
  let max = floor;
  for (const code of used) {
    if (!/^\d+$/.test(code)) continue;
    const n = Number(code);
    if (n >= floor && n < ceiling && n > max) max = n;
  }
  let next = max + 1;
  while (next < ceiling && used.has(String(next))) next += 1;
  if (next >= ceiling || used.has(String(next))) {
    next = floor + 1;
    while (used.has(String(next))) next += 1;
  }
  return String(next);
}

export type ParentLink = { id: string; parent_account_id: string | null };

/** Self-parent, a parent that sits under this account, or a loop already in the chain. */
export function parentCreatesCycle(
  links: ParentLink[],
  accountId: string | null,
  parentId: string,
): 'self' | 'cycle' | 'missing' | null {
  if (accountId && accountId === parentId) return 'self';
  const byId = new Map(links.map((l) => [l.id, l.parent_account_id]));
  if (!byId.has(parentId)) return 'missing';
  const seen = new Set<string>();
  let current: string | null = parentId;
  while (current) {
    if (seen.has(current)) return 'cycle';
    if (accountId && current === accountId) return 'cycle';
    seen.add(current);
    const next = byId.get(current);
    if (next === undefined) return 'missing';
    current = next;
  }
  return null;
}

export function descendantIds(links: ParentLink[], accountId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const link of links) {
    if (!link.parent_account_id) continue;
    const list = children.get(link.parent_account_id) ?? [];
    list.push(link.id);
    children.set(link.parent_account_id, list);
  }
  const out = new Set<string>();
  const stack = [...(children.get(accountId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export function accountAncestorNames(
  accounts: Array<{ id: string; account_name: string; parent_account_id?: string | null }>,
  accountId: string,
): string[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(accountId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.push(current.account_name);
    current = current.parent_account_id ? byId.get(current.parent_account_id) : undefined;
  }
  return names.reverse();
}

export function groupAncestorNames(
  groups: Array<{ id: string; group_name: string; parent_group_id?: string | null }>,
  groupId: string | null | undefined,
): string[] {
  if (!groupId) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(groupId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.push(current.group_name);
    current = current.parent_group_id ? byId.get(current.parent_group_id) : undefined;
  }
  return names.reverse();
}

/**
 * Where a selected parent sits: its account-group chain, then its ledger parents, then itself.
 * Group names and account names stay in that order so the two concepts are not merged into one field.
 */
export function parentSelectionPath(opts: {
  accountId: string;
  accounts: Array<{
    id: string;
    account_name: string;
    parent_account_id?: string | null;
    account_group_id?: string | null;
  }>;
  groups: Array<{ id: string; group_name: string; parent_group_id?: string | null }>;
}): string {
  const account = opts.accounts.find((a) => a.id === opts.accountId);
  if (!account) return '';
  const groupNames = groupAncestorNames(opts.groups, account.account_group_id);
  const accountNames = accountAncestorNames(opts.accounts, account.id);
  const parts = [...groupNames];
  for (const name of accountNames) {
    if (parts[parts.length - 1] === name) continue;
    if (name !== account.account_name && parts.includes(name)) continue;
    parts.push(name);
  }
  return parts.join(' → ');
}

export function parseOpeningBalance(
  amount: unknown,
  type: unknown,
): { ok: true; amount: number; type: 'debit' | 'credit' } | { ok: false; error: string } {
  const n = typeof amount === 'string' && amount.trim() === '' ? 0 : Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Opening balance must be zero or a positive amount.' };
  }
  if (type !== 'debit' && type !== 'credit') {
    return { ok: false, error: 'Opening balance type must be debit or credit.' };
  }
  return { ok: true, amount: Math.round(n * 100) / 100, type };
}
