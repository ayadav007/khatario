/**
 * Options for a "Receivable account" picker: Accounts Receivable first, then the accounts under
 * it as a tree in account-code order. No database access, so client components can import it.
 */

export type ReceivableAccountLike = {
  id: string;
  account_code: string;
  account_name: string;
  parent_account_id: string | null;
  is_active: boolean;
};

export type ReceivableAccountOption = {
  id: string;
  /** "code name" */
  label: string;
  /** 0 for the control account, 1 for accounts directly under it, and so on. */
  depth: number;
  isControl: boolean;
  inactive: boolean;
};

const byCode = (a: ReceivableAccountLike, b: ReceivableAccountLike) =>
  a.account_code.localeCompare(b.account_code, undefined, { numeric: true });

/**
 * `selectedId` keeps an inactive account in the list when it is the customer's current one,
 * so the form can show what is saved.
 */
export function buildReceivableAccountOptions(
  accounts: ReceivableAccountLike[],
  controlAccountId: string | null,
  selectedId?: string | null,
): ReceivableAccountOption[] {
  const control = accounts.find((a) => a.id === controlAccountId);
  if (!control) return [];

  const visible = (a: ReceivableAccountLike) => a.is_active || a.id === selectedId;
  const childrenOf = new Map<string, ReceivableAccountLike[]>();
  for (const a of accounts) {
    if (!a.parent_account_id || a.id === control.id) continue;
    childrenOf.set(a.parent_account_id, [...(childrenOf.get(a.parent_account_id) ?? []), a]);
  }

  const out: ReceivableAccountOption[] = [];
  const seen = new Set<string>();
  const add = (a: ReceivableAccountLike, depth: number) => {
    seen.add(a.id);
    out.push({
      id: a.id,
      label: `${a.account_code} ${a.account_name}`,
      depth,
      isControl: a.id === control.id,
      inactive: !a.is_active,
    });
  };
  const walk = (parentId: string, depth: number) => {
    for (const child of (childrenOf.get(parentId) ?? []).sort(byCode)) {
      if (seen.has(child.id)) continue;
      if (visible(child)) add(child, depth);
      else seen.add(child.id);
      walk(child.id, depth + 1);
    }
  };

  add(control, 0);
  walk(control.id, 1);
  // Receivable accounts that are not linked under the control account (older "1103…" codes).
  for (const a of accounts.filter((x) => !seen.has(x.id)).sort(byCode)) {
    if (visible(a)) add(a, 1);
  }
  return out;
}

/**
 * What a "receivable account" filter keeps, for lists filtered in the browser. Null = no filter.
 * An account keeps itself and everything under it; the control account keeps only customers
 * with no account of their own (the same rule as `receivableAccountFilter` on the server).
 */
export function receivableAccountFilterIds(
  accounts: ReceivableAccountLike[],
  controlAccountId: string | null,
  selectedId: string,
): { accountIds: Set<string>; unassigned: boolean } | null {
  if (!selectedId) return null;
  if (selectedId === controlAccountId) return { accountIds: new Set(), unassigned: true };
  const accountIds = new Set<string>([selectedId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of accounts) {
      if (a.parent_account_id && accountIds.has(a.parent_account_id) && !accountIds.has(a.id)) {
        accountIds.add(a.id);
        grew = true;
      }
    }
  }
  return { accountIds, unassigned: false };
}
