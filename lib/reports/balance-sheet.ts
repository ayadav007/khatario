/**
 * Balance sheet built from ledger balances only. Registers (fixed assets, provisions, tax) post to
 * the ledger, so their accounts are read like any other; register figures are shown as detail only.
 */

export type BsClass =
  | 'current_asset'
  | 'fixed_asset'
  | 'investment'
  | 'other_asset'
  | 'current_liability'
  | 'long_term_liability'
  | 'other_liability'
  | 'equity';

export type GroupInfo = { id: string; code: string | null; name: string | null; type: string | null; parentId: string | null };

/** Group codes of the standard sub-groups; custom groups fall back to their name. */
const CLASS_BY_GROUP_CODE: Record<string, BsClass> = {
  '1100': 'current_asset',
  '1200': 'fixed_asset',
  '1300': 'investment',
  '2100': 'current_liability',
  '2200': 'long_term_liability',
};

function classFromGroup(g: GroupInfo, side: 'asset' | 'liability'): BsClass | null {
  if (g.code && CLASS_BY_GROUP_CODE[g.code]) {
    const c = CLASS_BY_GROUP_CODE[g.code];
    return c.endsWith(side === 'asset' ? 'asset' : 'liability') || (side === 'asset' && c === 'investment') ? c : null;
  }
  // Inter-branch balances are short-term in a branch view and net to zero when consolidated.
  if (g.type === 'elimination') return side === 'asset' ? 'current_asset' : 'current_liability';
  const name = (g.name || '').trim().toLowerCase();
  if (side === 'asset') {
    if (/^current\b/.test(name)) return 'current_asset';
    if (/^fixed\b|^property, plant/.test(name)) return 'fixed_asset';
    if (/^investments?\b/.test(name)) return 'investment';
  } else {
    if (/^current\b/.test(name)) return 'current_liability';
    if (/^long[- ]term\b|^non[- ]current\b/.test(name)) return 'long_term_liability';
  }
  return null;
}

/** Walks the account's group chain up to the root; accounts outside the standard sub-groups are "other". */
export function classifyBsAccount(
  accountType: string,
  groupId: string | null,
  groups: Map<string, GroupInfo>
): BsClass | null {
  if (accountType === 'capital') return 'equity';
  if (accountType !== 'asset' && accountType !== 'liability') return null;
  const side = accountType;
  const seen = new Set<string>();
  let g = groupId ? groups.get(groupId) : undefined;
  while (g && !seen.has(g.id)) {
    seen.add(g.id);
    const c = classFromGroup(g, side);
    if (c) return c;
    g = g.parentId ? groups.get(g.parentId) : undefined;
  }
  return side === 'asset' ? 'other_asset' : 'other_liability';
}

export type BsAccountRow = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_group_id: string | null;
  account_group_name: string | null;
  nature: string | null;
  is_active: boolean;
  debit: number;
  credit: number;
};

export type BsAccountLine = {
  id: string;
  account_code: string;
  account_name: string;
  account_group_name: string | null;
  is_active: boolean;
  /** Signed for its side: assets debit-positive, liabilities and equity credit-positive. */
  balance: number;
};

export type BsSection = { accounts: BsAccountLine[]; total: number };

export type BalanceSheet = {
  assets: {
    current: BsSection & {
      inventory: number;
      /** Closing-stock adjustment added to the inventory ledger balance in periodic books. */
      inventory_adjustment: number;
      receivables: number;
      prepaid_expenses: number;
      accrued_income: number;
      advances_to_suppliers: number;
      loans_and_advances: number;
    };
    fixed: BsSection & { gross_block: number; accumulated_depreciation: number; net_block: number };
    investments: BsSection;
    other: BsSection;
    total: number;
  };
  liabilities: {
    current: BsSection & {
      payables: number;
      outstanding_expenses: number;
      accrued_expenses: number;
      advances_from_customers: number;
      unearned_revenue: number;
      provisions: number;
      current_tax: number;
      deferred_tax: number;
    };
    long_term: BsSection;
    other: BsSection;
    total: number;
  };
  equity: {
    capital: BsSection;
    retained_earnings: { opening: number; current_year_profit: number; dividends: number; closing: number };
    total: number;
  };
  total_liabilities_and_equity: number;
  difference: number;
  is_balanced: boolean;
  abnormal_balances: Array<{ account_code: string; account_name: string; side: 'asset' | 'liability'; amount: number }>;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.05;

const isAccumulatedDepreciation = (a: { account_code: string; account_name: string }) =>
  a.account_code === '1202' || /accumulated depreciation/i.test(a.account_name);

export function assembleBalanceSheet(
  rows: BsAccountRow[],
  groups: Map<string, GroupInfo>,
  opts: {
    /** Unclosed profit of earlier years (closed years already sit in Retained Earnings). */
    previousYearsProfit: number;
    /** Net profit of the financial year to date, from the P&L engine. */
    currentYearProfit: number;
    /** Periodic books: closing stock minus what the inventory ledger carries. */
    inventoryAdjustment?: number;
  }
): BalanceSheet {
  const buckets: Record<BsClass, BsAccountLine[]> = {
    current_asset: [], fixed_asset: [], investment: [], other_asset: [],
    current_liability: [], long_term_liability: [], other_liability: [], equity: [],
  };
  for (const r of rows) {
    const cls = classifyBsAccount(r.account_type, r.account_group_id, groups);
    if (!cls) continue;
    const drCr = r.debit - r.credit;
    const balance = r2(r.account_type === 'asset' ? drCr : -drCr);
    buckets[cls].push({
      id: r.id,
      account_code: r.account_code,
      account_name: r.account_name,
      account_group_name: r.account_group_name,
      is_active: r.is_active,
      balance,
    });
  }

  const sum = (ls: BsAccountLine[]) => r2(ls.reduce((s, l) => s + l.balance, 0));
  const byCode = (ls: BsAccountLine[], code: string) => ls.find((l) => l.account_code === code)?.balance ?? 0;
  const section = (ls: BsAccountLine[]): BsSection => ({ accounts: ls, total: sum(ls) });

  const invAdj = r2(opts.inventoryAdjustment ?? 0);
  const ca = buckets.current_asset;
  const inventoryLedger = byCode(ca, '1104');
  const currentAssets = {
    ...section(ca),
    inventory: r2(inventoryLedger + invAdj),
    inventory_adjustment: invAdj,
    receivables: byCode(ca, '1103'),
    prepaid_expenses: byCode(ca, '1105'),
    accrued_income: byCode(ca, '1106'),
    advances_to_suppliers: byCode(ca, '1107'),
    loans_and_advances: byCode(ca, '1108'),
  };
  currentAssets.total = r2(currentAssets.total + invAdj);

  const fa = buckets.fixed_asset;
  const accumulated = r2(-fa.filter(isAccumulatedDepreciation).reduce((s, l) => s + l.balance, 0));
  const fixedTotal = sum(fa);
  const fixed = {
    ...section(fa),
    gross_block: r2(fixedTotal + accumulated),
    accumulated_depreciation: accumulated,
    net_block: fixedTotal,
  };

  const investments = section(buckets.investment);
  const otherAssets = section(buckets.other_asset);
  const totalAssets = r2(currentAssets.total + fixed.total + investments.total + otherAssets.total);

  const cl = buckets.current_liability;
  const currentLiabilities = {
    ...section(cl),
    payables: byCode(cl, '2101'),
    outstanding_expenses: byCode(cl, '2104'),
    accrued_expenses: byCode(cl, '2105'),
    advances_from_customers: byCode(cl, '2106'),
    unearned_revenue: byCode(cl, '2107'),
    provisions: byCode(cl, '2108'),
    current_tax: byCode(cl, '2109'),
    deferred_tax: byCode(cl, '2110'),
  };
  const longTerm = section(buckets.long_term_liability);
  const otherLiabilities = section(buckets.other_liability);
  const totalLiabilities = r2(currentLiabilities.total + longTerm.total + otherLiabilities.total);

  const capital = section(buckets.equity);
  const opening = r2(opts.previousYearsProfit);
  const cyp = r2(opts.currentYearProfit);
  const retained = { opening, current_year_profit: cyp, dividends: 0, closing: r2(opening + cyp) };
  const totalEquity = r2(capital.total + retained.closing);
  const totalLe = r2(totalLiabilities + totalEquity);
  const difference = r2(totalAssets - totalLe);

  const abnormal = [
    ...[...ca, ...fa, ...buckets.investment, ...buckets.other_asset]
      .filter((l) => l.balance < -0.005 && !isAccumulatedDepreciation(l) && l.account_code !== '1104')
      .map((l) => ({ account_code: l.account_code, account_name: l.account_name, side: 'asset' as const, amount: l.balance })),
    ...[...cl, ...buckets.long_term_liability, ...buckets.other_liability]
      .filter((l) => l.balance < -0.005)
      .map((l) => ({ account_code: l.account_code, account_name: l.account_name, side: 'liability' as const, amount: l.balance })),
  ];

  return {
    assets: { current: currentAssets, fixed, investments, other: otherAssets, total: totalAssets },
    liabilities: { current: currentLiabilities, long_term: longTerm, other: otherLiabilities, total: totalLiabilities },
    equity: { capital, retained_earnings: retained, total: totalEquity },
    total_liabilities_and_equity: totalLe,
    difference,
    is_balanced: Math.abs(difference) < EPS,
    abnormal_balances: abnormal,
  };
}

/** Indian financial year start (1 April) for the year containing `date` (YYYY-MM-DD). */
export function financialYearStartFor(date: string): string {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(5, 7), 10);
  return `${m >= 4 ? y : y - 1}-04-01`;
}
