/**
 * Where an income or expense account appears in the Profit & Loss statement.
 * Mirrors Zoho Books' P&L account types; posting never depends on it.
 */
export const PL_SECTIONS = [
  'operating_income',
  'cost_of_goods_sold',
  'operating_expense',
  'other_income',
  'other_expense',
  'elimination',
] as const;

export type PlSection = (typeof PL_SECTIONS)[number];

export const PL_SECTION_LABELS: Record<PlSection, string> = {
  operating_income: 'Operating Income',
  cost_of_goods_sold: 'Cost of Goods Sold',
  operating_expense: 'Operating Expense',
  other_income: 'Non Operating Income',
  other_expense: 'Non Operating Expense',
  elimination: 'Inter-branch (eliminated)',
};

export const PL_SECTION_HINTS: Record<PlSection, string> = {
  operating_income: 'Revenue from the main business: sales, service charges, fees.',
  cost_of_goods_sold: 'Direct cost of what was sold. Counted before gross profit.',
  operating_expense: 'Running costs: salaries, rent, office, marketing, depreciation.',
  other_income: 'Income outside the main business, shown below operating profit.',
  other_expense: 'Interest, exchange loss, loss on asset sale, income tax. Shown below operating profit.',
  elimination: 'Inter-branch transfers. Removed in the consolidated view.',
};

/** Sections whose amount is credit − debit; the rest are debit − credit. */
export const CREDIT_SECTIONS: ReadonlySet<PlSection> = new Set(['operating_income', 'other_income']);

const ALLOWED: Record<'income' | 'expense', ReadonlySet<PlSection>> = {
  // Contra placements (e.g. a discount-received income account inside Operating Expense) show as negative lines.
  income: new Set(['operating_income', 'other_income', 'operating_expense', 'cost_of_goods_sold', 'elimination']),
  expense: new Set(['cost_of_goods_sold', 'operating_expense', 'other_expense', 'operating_income', 'elimination']),
};

/** Seeded system accounts, placed as Zoho places the equivalent account. */
export const SYSTEM_PL_SECTIONS: Readonly<Record<string, PlSection>> = {
  '4101': 'operating_income',
  '4102': 'operating_expense', // Zoho "Purchase Discounts": negative operating expense
  '4103': 'elimination',
  '4201': 'operating_income', // Zoho "General Income"
  '4202': 'operating_income', // Zoho "Interest Income"
  '4203': 'other_income',
  '4204': 'other_income',
  '4205': 'other_income',
  '5101': 'cost_of_goods_sold',
  '5102': 'cost_of_goods_sold',
  '5103': 'elimination',
  '5104': 'cost_of_goods_sold',
  '5105': 'cost_of_goods_sold',
  '5106': 'cost_of_goods_sold',
  '5201': 'operating_expense',
  '5202': 'operating_expense',
  '5203': 'operating_expense',
  '5204': 'operating_expense',
  '5205': 'other_expense',
  '5206': 'other_expense', // Zoho "Exchange Gain or Loss"
  '5207': 'operating_expense', // Zoho "Bad Debt"
  '5208': 'operating_expense',
  '5209': 'operating_expense',
  '5210': 'other_expense', // Zoho has no tax section
  '5211': 'other_expense',
  '5212': 'operating_expense',
  '5213': 'operating_expense',
  '5214': 'operating_expense',
  '5215': 'operating_expense',
  '5216': 'operating_expense',
  '5217': 'operating_expense',
  '5218': 'other_expense',
  '5299': 'operating_income', // Zoho books rounding to "Other Charges"
};

export function isPlSection(value: unknown): value is PlSection {
  return typeof value === 'string' && (PL_SECTIONS as readonly string[]).includes(value);
}

export function isAllowedPlSection(accountType: string, section: PlSection): boolean {
  if (accountType !== 'income' && accountType !== 'expense') return false;
  return ALLOWED[accountType].has(section);
}

export function allowedPlSections(accountType: string): PlSection[] {
  if (accountType !== 'income' && accountType !== 'expense') return [];
  return PL_SECTIONS.filter((s) => ALLOWED[accountType].has(s));
}

/** Section for a new account from its group, when the user does not pick one. */
export function plSectionFromGroup(
  accountType: string,
  groupCode: string | null | undefined,
  groupType?: string | null
): PlSection | null {
  if (accountType !== 'income' && accountType !== 'expense') return null;
  if (groupType === 'elimination' || groupCode === '6000') return 'elimination';
  if (accountType === 'income') return groupCode === '4200' ? 'other_income' : 'operating_income';
  return groupCode === '5100' ? 'cost_of_goods_sold' : 'operating_expense';
}

export interface PlAccountLike {
  account_code: string;
  account_type: string;
  is_system?: boolean | null;
  pl_section?: string | null;
  group_code?: string | null;
  group_type?: string | null;
}

/** Stored section, else the system default for the code, else the group default. */
export function effectivePlSection(a: PlAccountLike): PlSection | null {
  if (a.account_type !== 'income' && a.account_type !== 'expense') return null;
  if (isPlSection(a.pl_section)) return a.pl_section;
  if (a.is_system !== false && SYSTEM_PL_SECTIONS[a.account_code]) return SYSTEM_PL_SECTIONS[a.account_code];
  return plSectionFromGroup(a.account_type, a.group_code, a.group_type);
}

/** Signed amount of a ledger movement as shown inside its section. */
export function sectionAmount(section: PlSection, accountType: string, debit: number, credit: number): number {
  const creditPositive = section === 'elimination' ? accountType === 'income' : CREDIT_SECTIONS.has(section);
  return creditPositive ? credit - debit : debit - credit;
}
