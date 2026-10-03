import { queryRows } from '@/lib/db';
import {
  effectivePlSection,
  PL_SECTION_LABELS,
  sectionAmount,
  type PlSection,
} from '@/lib/accounting/pl-sections';
import { calculateCOGS, type COGSCalculation } from '@/lib/services/cogs-calculator';
import { getInventoryModel } from '@/lib/inventory/cogs-posting';

export type ReportSection = Exclude<PlSection, 'elimination'>;

export const REPORT_SECTIONS: ReportSection[] = [
  'operating_income',
  'cost_of_goods_sold',
  'operating_expense',
  'other_income',
  'other_expense',
];

export interface PlAccountRow {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  is_active: boolean;
  is_system: boolean | null;
  parent_account_id: string | null;
  pl_section: string | null;
  group_code: string | null;
  group_type: string | null;
  group_name: string | null;
  debit: number;
  credit: number;
}

export interface PlAccountNode {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_group_name: string | null;
  is_active: boolean;
  section: PlSection;
  /** This account's own movement, signed for its section. */
  amount: number;
  /** Own amount plus all sub-accounts in the same section. */
  total: number;
  children: PlAccountNode[];
}

export interface PlSectionBlock {
  key: ReportSection;
  label: string;
  total: number;
  accounts: PlAccountNode[];
}

export interface PeriodicCogsSchedule {
  opening_stock: number;
  purchases: number;
  closing_stock: number;
  cost_of_goods_sold: number;
}

/**
 * Earnings measures derived back from net profit, so they hold wherever the accounts sit in the
 * sections. EBIT = PBT + finance cost − interest income; EBITDA = EBIT + depreciation & amortisation.
 */
export interface PlEarnings {
  tax: number;
  finance_cost: number;
  interest_income: number;
  depreciation_amortisation: number;
  profit_before_tax: number;
  ebit: number;
  ebitda: number;
}

export interface ProfitAndLoss {
  sections: Record<ReportSection, PlSectionBlock>;
  gross_profit: number;
  operating_profit: number;
  net_profit: number;
  earnings: PlEarnings;
  /** Inter-branch accounts removed in the consolidated view; `net` stays in net profit when the two sides differ. */
  elimination: { applied: boolean; net: number; accounts: PlAccountNode[] };
  inventory_model: 'periodic' | 'perpetual';
  periodic_cogs: PeriodicCogsSchedule | null;
  cogs_detail: COGSCalculation | null;
  ledger_check: { ledger_net: number; inventory_adjustment: number; difference: number };
}

export type BranchScope =
  | { kind: 'all' }
  | { kind: 'branches'; branchIds: string[]; includeUnbranched: boolean };

export interface BuildPlOptions {
  businessId: string;
  fromDate: string;
  toDate: string;
  branch: BranchScope;
  /** Consolidated view eliminates inter-branch accounts; a branch view keeps them. */
  consolidated: boolean;
  financialYear?: string | null;
  includeZero?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const PERIODIC_PURCHASE_CODES = new Set(['5101', '5102']);

type EarningsRole = 'tax' | 'finance_cost' | 'interest_income' | 'depreciation_amortisation';

/** Seeded accounts behind each earnings add-back; sub-accounts created under them follow their parent. */
const EARNINGS_ROLE_CODES: Record<string, EarningsRole> = {
  '5210': 'tax',
  '5211': 'tax',
  '5203': 'finance_cost',
  '5205': 'finance_cost',
  '4202': 'interest_income',
  '5204': 'depreciation_amortisation',
};

function earningsRoleOf(row: PlAccountRow, byId: Map<string, PlAccountRow>): EarningsRole | null {
  const seen = new Set<string>();
  let cur: PlAccountRow | undefined = row;
  while (cur && !seen.has(cur.id)) {
    const role = EARNINGS_ROLE_CODES[cur.account_code];
    if (role) return role;
    seen.add(cur.id);
    cur = cur.parent_account_id ? byId.get(cur.parent_account_id) : undefined;
  }
  return null;
}

export function computeEarnings(rows: PlAccountRow[], netProfit: number): PlEarnings {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sums: Record<EarningsRole, number> = {
    tax: 0,
    finance_cost: 0,
    interest_income: 0,
    depreciation_amortisation: 0,
  };
  for (const r of rows) {
    const role = earningsRoleOf(r, byId);
    if (!role) continue;
    sums[role] += role === 'interest_income' ? r.credit - r.debit : r.debit - r.credit;
  }
  const profitBeforeTax = r2(netProfit + sums.tax);
  const ebit = r2(profitBeforeTax + sums.finance_cost - sums.interest_income);
  return {
    tax: r2(sums.tax),
    finance_cost: r2(sums.finance_cost),
    interest_income: r2(sums.interest_income),
    depreciation_amortisation: r2(sums.depreciation_amortisation),
    profit_before_tax: profitBeforeTax,
    ebit,
    ebitda: r2(ebit + sums.depreciation_amortisation),
  };
}

export async function loadPlAccounts(opts: BuildPlOptions): Promise<PlAccountRow[]> {
  const params: unknown[] = [opts.businessId, opts.fromDate, opts.toDate];
  let branchSql = '';
  if (opts.branch.kind === 'branches') {
    params.push(opts.branch.branchIds, opts.branch.includeUnbranched);
    branchSql = 'AND (l.branch_id = ANY($4::uuid[]) OR ($5::boolean AND l.branch_id IS NULL))';
  }
  // pl_section is read through to_jsonb so the report keeps working before migration 334 adds the column.
  const rows = await queryRows<any>(
    `SELECT a.id, a.account_code, a.account_name, a.account_type, a.is_active, a.is_system,
            a.parent_account_id, to_jsonb(a) ->> 'pl_section' AS pl_section,
            ag.group_code, ag.group_type, ag.group_name,
            COALESCE(SUM(l.debit), 0)::float AS debit,
            COALESCE(SUM(l.credit), 0)::float AS credit,
            COUNT(l.id)::int AS line_count
       FROM accounts a
       LEFT JOIN account_groups ag ON ag.id = a.account_group_id
       LEFT JOIN ledger_entry_lines l
              ON l.account_id = a.id AND l.business_id = a.business_id
             AND l.entry_date >= $2 AND l.entry_date <= $3
             AND l.voucher_type <> 'year_close'
             ${branchSql}
      WHERE a.business_id = $1 AND a.account_type IN ('income', 'expense')
      GROUP BY a.id, ag.group_code, ag.group_type, ag.group_name
     HAVING a.is_active = true OR COUNT(l.id) > 0
      ORDER BY a.account_code`,
    params
  );
  return rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
}

/** Section an account is reported in, after inter-branch handling for the view. */
function reportSection(row: PlAccountRow, consolidated: boolean): PlSection {
  const s = effectivePlSection(row) as PlSection;
  if (s !== 'elimination' || consolidated) return s;
  return row.account_type === 'income' ? 'operating_income' : 'cost_of_goods_sold';
}

function buildTree(rows: PlAccountRow[], sectionOf: Map<string, PlSection>, includeZero: boolean): PlAccountNode[] {
  const nodes = new Map<string, PlAccountNode>();
  for (const r of rows) {
    const section = sectionOf.get(r.id)!;
    nodes.set(r.id, {
      id: r.id,
      account_code: r.account_code,
      account_name: r.account_name,
      account_type: r.account_type,
      account_group_name: r.group_name,
      is_active: r.is_active,
      section,
      amount: r2(sectionAmount(section, r.account_type, r.debit, r.credit)),
      total: 0,
      children: [],
    });
  }
  const roots: PlAccountNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    const parent = r.parent_account_id ? nodes.get(r.parent_account_id) : undefined;
    // Sub-accounts nest only under a parent in the same section, so section totals never move.
    if (parent && parent.section === node.section && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const total = (n: PlAccountNode, seen: Set<string>): number => {
    if (seen.has(n.id)) return 0;
    seen.add(n.id);
    n.total = r2(n.amount + n.children.reduce((s, c) => s + total(c, seen), 0));
    return n.total;
  };
  const seen = new Set<string>();
  roots.forEach((n) => total(n, seen));
  const keep = (n: PlAccountNode): boolean => {
    n.children = n.children.filter(keep);
    return includeZero || Math.abs(n.amount) >= 0.005 || n.children.length > 0;
  };
  return roots.filter(keep);
}

/** Pure part of the report: sections and profits from account movements. */
export function assemblePl(
  rows: PlAccountRow[],
  opts: { consolidated: boolean; includeZero?: boolean; periodic?: COGSCalculation | null }
): Omit<ProfitAndLoss, 'inventory_model' | 'cogs_detail'> {
  const periodic = opts.periodic ?? null;
  const sectionOf = new Map(rows.map((r) => [r.id, reportSection(r, opts.consolidated)]));
  let ledgerNet = 0;
  let ledgerPurchases = 0;
  for (const r of rows) {
    ledgerNet += r.account_type === 'income' ? r.credit - r.debit : -(r.debit - r.credit);
    if (periodic && PERIODIC_PURCHASE_CODES.has(r.account_code) && sectionOf.get(r.id) === 'cost_of_goods_sold') {
      ledgerPurchases += r.debit - r.credit;
    }
  }

  // Periodic books: 5101/5102 are replaced by Opening + Purchases − Closing from the stock schedule.
  const reported = periodic
    ? rows.filter((r) => !(PERIODIC_PURCHASE_CODES.has(r.account_code) && sectionOf.get(r.id) === 'cost_of_goods_sold'))
    : rows;

  const sections = {} as Record<ReportSection, PlSectionBlock>;
  for (const key of REPORT_SECTIONS) {
    const inSection = reported.filter((r) => sectionOf.get(r.id) === key);
    const accounts = buildTree(inSection, sectionOf, !!opts.includeZero);
    const sum = inSection.reduce((s, r) => s + sectionAmount(key, r.account_type, r.debit, r.credit), 0);
    sections[key] = { key, label: PL_SECTION_LABELS[key], total: r2(sum), accounts };
  }

  let schedule: PeriodicCogsSchedule | null = null;
  if (periodic) {
    schedule = {
      opening_stock: r2(periodic.openingStock.value),
      purchases: r2(periodic.purchases.total),
      closing_stock: r2(periodic.closingStock.value),
      cost_of_goods_sold: r2(periodic.openingStock.value + periodic.purchases.total - periodic.closingStock.value),
    };
    sections.cost_of_goods_sold.total = r2(sections.cost_of_goods_sold.total + schedule.cost_of_goods_sold);
  }

  const elimRows = rows.filter((r) => sectionOf.get(r.id) === 'elimination');
  const elimNet = r2(elimRows.reduce((s, r) => s + (r.credit - r.debit), 0));
  const elimination = {
    applied: opts.consolidated && elimRows.length > 0,
    net: elimNet,
    accounts: buildTree(elimRows, sectionOf, false),
  };

  const grossProfit = r2(sections.operating_income.total - sections.cost_of_goods_sold.total);
  const operatingProfit = r2(grossProfit - sections.operating_expense.total);
  const netProfit = r2(operatingProfit + sections.other_income.total - sections.other_expense.total + elimNet);

  const inventoryAdjustment = schedule
    ? r2(schedule.closing_stock - schedule.opening_stock - (schedule.purchases - ledgerPurchases))
    : 0;
  return {
    sections,
    gross_profit: grossProfit,
    operating_profit: operatingProfit,
    net_profit: netProfit,
    earnings: computeEarnings(rows, netProfit),
    elimination,
    periodic_cogs: schedule,
    ledger_check: {
      ledger_net: r2(ledgerNet),
      inventory_adjustment: inventoryAdjustment,
      difference: r2(netProfit - ledgerNet - inventoryAdjustment),
    },
  };
}

export async function buildProfitAndLoss(opts: BuildPlOptions): Promise<ProfitAndLoss> {
  const rows = await loadPlAccounts(opts);
  const inventoryModel = await getInventoryModel(undefined, opts.businessId);
  let cogsDetail: COGSCalculation | null = null;
  try {
    const fy = opts.financialYear || undefined;
    cogsDetail = await calculateCOGS(opts.businessId, opts.fromDate, opts.toDate, fy, previousFinancialYear(fy));
  } catch (error) {
    console.error('Error calculating COGS schedule:', error);
  }
  const periodic = inventoryModel === 'periodic' && cogsDetail ? cogsDetail : null;
  const pl = assemblePl(rows, { consolidated: opts.consolidated, includeZero: opts.includeZero, periodic });
  return { ...pl, inventory_model: inventoryModel, cogs_detail: cogsDetail };
}

/** '2026-27' → '2025-26'. */
export function previousFinancialYear(fy: string | null | undefined): string | undefined {
  const start = fy ? parseInt(fy.slice(0, 4), 10) : NaN;
  if (!Number.isFinite(start)) return undefined;
  return `${start - 1}-${String(start % 100).padStart(2, '0')}`;
}

export function flattenNodes(nodes: PlAccountNode[]): PlAccountNode[] {
  return nodes.flatMap((n) => [n, ...flattenNodes(n.children)]);
}
