import { effectivePlSection, type PlAccountLike } from '@/lib/accounting/pl-sections';

/** Schedule III (Companies Act) lines an income or expense account can sit on. */
export const SCHEDULE3_LINES = [
  'revenue_from_operations',
  'other_income',
  'materials_consumed',
  'purchases_stock_in_trade',
  'changes_in_inventories',
  'employee_benefits',
  'finance_costs',
  'depreciation_amortisation',
  'other_expenses',
  'exceptional_items',
  'current_tax',
  'deferred_tax',
] as const;

export type Schedule3Line = (typeof SCHEDULE3_LINES)[number];
export type Schedule3Placement = Schedule3Line | 'stock_cost' | 'elimination';

export const SCHEDULE3_LINE_LABELS: Record<Schedule3Line, string> = {
  revenue_from_operations: 'Revenue from operations',
  other_income: 'Other income',
  materials_consumed: 'Cost of materials consumed',
  purchases_stock_in_trade: 'Purchases of stock-in-trade',
  changes_in_inventories: 'Changes in inventories of finished goods, work-in-progress and stock-in-trade',
  employee_benefits: 'Employee benefits expense',
  finance_costs: 'Finance costs',
  depreciation_amortisation: 'Depreciation and amortisation expense',
  other_expenses: 'Other expenses',
  exceptional_items: 'Exceptional items',
  current_tax: 'Current tax',
  deferred_tax: 'Deferred tax',
};

/** Lines an owner may put an account on; the stock-derived lines are always computed. */
export const ASSIGNABLE_SCHEDULE3_LINES: readonly Schedule3Line[] = SCHEDULE3_LINES.filter(
  (l) => l !== 'materials_consumed' && l !== 'changes_in_inventories'
);

/** Seeded accounts the stock figures depend on; they cannot be moved. */
export const SCHEDULE3_LOCKED_CODES: ReadonlySet<string> = new Set(['4103', '5101', '5102', '5103', '5104']);

export const SYSTEM_SCHEDULE3_PLACEMENTS: Readonly<Record<string, Schedule3Placement>> = {
  '4101': 'revenue_from_operations',
  '4102': 'other_income',
  '4103': 'elimination',
  '4201': 'other_income',
  '4202': 'other_income',
  '4203': 'other_income',
  '4204': 'other_income',
  '4205': 'other_income',
  '5101': 'purchases_stock_in_trade',
  '5102': 'purchases_stock_in_trade',
  '5103': 'elimination',
  '5104': 'stock_cost',
  '5105': 'purchases_stock_in_trade',
  '5106': 'other_expenses',
  '5201': 'other_expenses',
  '5202': 'other_expenses',
  '5203': 'finance_costs',
  '5204': 'depreciation_amortisation',
  '5205': 'finance_costs',
  '5206': 'other_expenses',
  '5207': 'other_expenses',
  '5208': 'other_expenses',
  '5209': 'employee_benefits',
  '5210': 'current_tax',
  '5211': 'deferred_tax',
  '5212': 'employee_benefits',
  '5213': 'other_expenses',
  '5214': 'employee_benefits',
  '5215': 'other_expenses',
  '5216': 'other_expenses',
  '5217': 'other_expenses',
  '5218': 'other_expenses',
  '5299': 'other_expenses',
};

/** Lines whose amount is credit − debit; the rest are debit − credit. */
export const CREDIT_LINES: ReadonlySet<Schedule3Line> = new Set<Schedule3Line>([
  'revenue_from_operations',
  'other_income',
]);

export function isAssignableSchedule3Line(v: unknown): v is Schedule3Line {
  return typeof v === 'string' && (ASSIGNABLE_SCHEDULE3_LINES as readonly string[]).includes(v);
}

export function schedule3Amount(line: Schedule3Line, debit: number, credit: number): number {
  return CREDIT_LINES.has(line) ? credit - debit : debit - credit;
}

export interface Schedule3AccountLike extends PlAccountLike {
  id: string;
  parent_account_id: string | null;
  schedule3_line?: string | null;
}

/** Rules 1 and 2: the owner's choice, else the fixed line for a seeded code. */
function ownPlacement(a: Schedule3AccountLike): Schedule3Placement | null {
  if (!SCHEDULE3_LOCKED_CODES.has(a.account_code) && isAssignableSchedule3Line(a.schedule3_line)) {
    return a.schedule3_line;
  }
  if (a.is_system !== false) {
    const seeded = Object.prototype.hasOwnProperty.call(SYSTEM_SCHEDULE3_PLACEMENTS, a.account_code)
      ? SYSTEM_SCHEDULE3_PLACEMENTS[a.account_code]
      : undefined;
    if (seeded) return seeded;
  }
  return null;
}

/** Rule 4: default from the account's Standard section. */
function sectionDefault(a: Schedule3AccountLike): Schedule3Placement {
  switch (effectivePlSection(a)) {
    case 'elimination':
      return 'elimination';
    case 'operating_income':
      return 'revenue_from_operations';
    case 'other_income':
      return 'other_income';
    case 'operating_expense':
      return a.account_type === 'income' ? 'other_income' : 'other_expenses';
    default:
      return 'other_expenses';
  }
}

/** Owner's line, else seeded line, else nearest parent's, else the section default. */
export function effectiveSchedule3Placement(
  a: Schedule3AccountLike,
  byId: ReadonlyMap<string, Schedule3AccountLike>
): Schedule3Placement {
  const own = ownPlacement(a);
  if (own) return own;

  const visited = new Set<string>([a.id]);
  let parentId = a.parent_account_id;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    const placed = ownPlacement(parent);
    if (placed) return placed;
    parentId = parent.parent_account_id;
  }
  return sectionDefault(a);
}
