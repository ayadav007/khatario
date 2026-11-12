import { effectivePlSection } from '@/lib/accounting/pl-sections';
import {
  SCHEDULE3_LINES,
  SCHEDULE3_LINE_LABELS,
  schedule3Amount,
  effectiveSchedule3Placement,
  type Schedule3AccountLike,
  type Schedule3Line,
} from '@/lib/accounting/schedule3-lines';
import { queryRows } from '@/lib/db';
import { INVENTORY_ACCOUNT_CODES } from '@/lib/inventory/stock-class';
import { getInventoryModel } from '@/lib/inventory/cogs-posting';
import {
  assemblePl,
  loadPlAccounts,
  previousFinancialYear,
  type BuildPlOptions,
  type PlAccountRow,
} from '@/lib/reports/profit-loss';
import { calculateCOGS, type COGSCalculation } from '@/lib/services/cogs-calculator';

export type Schedule3AccountRow = PlAccountRow & { schedule3_line: string | null };

/** Spec section 6: P(code) = net purchase debits, M(code) = total debit minus credit, per stock account. */
export interface StockMovement {
  code: string;
  purchases: number;
  movement: number;
}

/** id null = computed row. */
export interface S3Row {
  id: string | null;
  account_code: string | null;
  label: string;
  amount: number;
}

export interface S3LineBlock {
  key: Schedule3Line;
  label: string;
  amount: number;
  rows: S3Row[];
}

export interface Schedule3Statement {
  lines: Record<Schedule3Line, S3LineBlock>;
  total_income: number;
  total_expenses: number;
  elimination_net: number;
  profit_before_exceptional_and_tax: number;
  profit_before_tax: number;
  tax_expense: number;
  profit_for_period: number;
  stock_basis: 'periodic' | 'perpetual';
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const PERIODIC_PURCHASE_CODES = new Set(['5101', '5102']);
const TRIVIAL = 0.005;

/** Mirrors `reportSection` in profit-loss.ts: in a branch view inter-branch accounts sit in Standard sections. */
function viewSection(row: PlAccountRow, consolidated: boolean) {
  const s = effectivePlSection(row);
  if (s !== 'elimination' || consolidated) return s;
  return row.account_type === 'income' ? 'operating_income' : 'cost_of_goods_sold';
}

export function assembleSchedule3(
  rows: Schedule3AccountRow[],
  opts: { consolidated: boolean; periodic?: COGSCalculation | null; stock?: StockMovement[] }
): Schedule3Statement {
  const periodic = opts.periodic ?? null;
  const byId = new Map<string, Schedule3AccountLike>(rows.map((r) => [r.id, r]));

  const accountRows = {} as Record<Schedule3Line, Schedule3AccountRow[]>;
  const computed = {} as Record<Schedule3Line, S3Row[]>;
  for (const key of SCHEDULE3_LINES) {
    accountRows[key] = [];
    computed[key] = [];
  }

  let eliminationNet = 0;
  let stockCost = 0; // C: movement on 5104 and its sub-accounts
  const stockCostRows: Schedule3AccountRow[] = [];

  for (const r of rows) {
    if (
      periodic &&
      PERIODIC_PURCHASE_CODES.has(r.account_code) &&
      viewSection(r, opts.consolidated) === 'cost_of_goods_sold'
    ) {
      continue;
    }
    const placement = effectiveSchedule3Placement(r, byId);
    if (placement === 'elimination') {
      if (opts.consolidated) {
        eliminationNet += r.credit - r.debit;
      } else {
        accountRows[r.account_type === 'income' ? 'revenue_from_operations' : 'purchases_stock_in_trade'].push(r);
      }
    } else if (placement === 'stock_cost') {
      stockCost += r.debit - r.credit;
      stockCostRows.push(r);
    } else {
      accountRows[placement].push(r);
    }
  }

  const addComputed = (line: Schedule3Line, label: string, amount: number) => {
    computed[line].push({ id: null, account_code: null, label, amount: r2(amount) });
  };

  if (periodic) {
    // Same expression order as assemblePl, rounded once; closing stock is the balancing figure (spec section 6).
    const cost = r2(periodic.openingStock.value + periodic.purchases.total - periodic.closingStock.value);
    const purchRow = r2(periodic.purchases.total);
    const openRow = r2(periodic.openingStock.value);
    const closeRow = r2(cost - purchRow - openRow);
    addComputed('purchases_stock_in_trade', 'Purchases (net of returns)', purchRow);
    addComputed('changes_in_inventories', 'Opening stock', openRow);
    addComputed('changes_in_inventories', 'Less: closing stock', closeRow);
    accountRows.changes_in_inventories.push(...stockCostRows);
  } else {
    const p = (code: string) => (opts.stock ?? []).filter((x) => x.code === code).reduce((s, x) => s + x.purchases, 0);
    const m = (code: string) => (opts.stock ?? []).filter((x) => x.code === code).reduce((s, x) => s + x.movement, 0);
    const materials = p('1160') - m('1160');
    const purchases = p('1104') + p('1161') + p('1162');
    addComputed('materials_consumed', 'Raw material consumed', materials);
    addComputed('purchases_stock_in_trade', 'Purchases taken into stock', purchases);
    addComputed('changes_in_inventories', 'Decrease / (increase) in stock', stockCost - materials - purchases);
  }

  const lines = {} as Record<Schedule3Line, S3LineBlock>;
  for (const key of SCHEDULE3_LINES) {
    const accounts = [...accountRows[key]].sort((a, b) => a.account_code.localeCompare(b.account_code));
    const all: S3Row[] = [
      ...computed[key],
      ...accounts.map((a) => ({
        id: a.id,
        account_code: a.account_code,
        label: a.account_name,
        amount: r2(schedule3Amount(key, a.debit, a.credit)),
      })),
    ];
    const sum = computed[key].reduce((s, c) => s + c.amount, 0) +
      accounts.reduce((s, a) => s + schedule3Amount(key, a.debit, a.credit), 0);
    lines[key] = {
      key,
      label: SCHEDULE3_LINE_LABELS[key],
      amount: r2(sum),
      rows: all.filter((x) => Math.abs(x.amount) >= TRIVIAL),
    };
  }

  const a = (k: Schedule3Line) => lines[k].amount;
  const totalIncome = r2(a('revenue_from_operations') + a('other_income'));
  const totalExpenses = r2(
    a('materials_consumed') +
      a('purchases_stock_in_trade') +
      a('changes_in_inventories') +
      a('employee_benefits') +
      a('finance_costs') +
      a('depreciation_amortisation') +
      a('other_expenses')
  );
  const elimNet = opts.consolidated ? r2(eliminationNet) : 0;
  const beforeExceptional = r2(totalIncome - totalExpenses + elimNet);
  const beforeTax = r2(beforeExceptional - a('exceptional_items'));
  const tax = r2(a('current_tax') + a('deferred_tax'));

  return {
    lines,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    elimination_net: elimNet,
    profit_before_exceptional_and_tax: beforeExceptional,
    profit_before_tax: beforeTax,
    tax_expense: tax,
    profit_for_period: r2(beforeTax - tax),
    stock_basis: periodic ? 'periodic' : 'perpetual',
  };
}

/** Voucher types whose stock-account debits and credits count as purchases (net of returns). */
export const STOCK_PURCHASE_VOUCHER_TYPES = ['purchase', 'purchase_return'] as const;

/** Also purchases in a single-branch view: goods a branch receives from another branch. Never in the consolidated view. */
export const STOCK_BRANCH_PURCHASE_VOUCHER_TYPES = ['inter_branch_receipt'] as const;

/** Opening stock posted inside the year; left out of the movement because it is not a movement of the year. */
export const STOCK_OPENING_VOUCHER_TYPES = ['opening_stock', 'opening_balance'] as const;

/** Purchases and movement (opening entries excluded) per stock account that has ledger lines in the period. */
export async function loadStockMovements(opts: BuildPlOptions): Promise<StockMovement[]> {
  const purchaseTypes: string[] = opts.consolidated
    ? [...STOCK_PURCHASE_VOUCHER_TYPES]
    : [...STOCK_PURCHASE_VOUCHER_TYPES, ...STOCK_BRANCH_PURCHASE_VOUCHER_TYPES];
  const params: unknown[] = [
    opts.businessId,
    opts.fromDate,
    opts.toDate,
    [...INVENTORY_ACCOUNT_CODES],
    purchaseTypes,
    [...STOCK_OPENING_VOUCHER_TYPES],
  ];
  let branchSql = '';
  if (opts.branch.kind === 'branches') {
    params.push(opts.branch.branchIds, opts.branch.includeUnbranched);
    branchSql = 'AND (l.branch_id = ANY($7::uuid[]) OR ($8::boolean AND l.branch_id IS NULL))';
  }
  const rows = await queryRows<{ code: string; purchases: number | string; movement: number | string }>(
    `SELECT a.account_code AS code,
            COALESCE(SUM(l.debit - l.credit) FILTER (WHERE l.voucher_type = ANY($5::text[])), 0)::float AS purchases,
            COALESCE(SUM(l.debit - l.credit) FILTER (WHERE NOT (l.voucher_type = ANY($6::text[]))), 0)::float AS movement
       FROM ledger_entry_lines l
       JOIN accounts a ON a.id = l.account_id AND a.business_id = l.business_id
      WHERE l.business_id = $1
        AND a.account_code = ANY($4::text[])
        AND l.entry_date >= $2 AND l.entry_date <= $3
        AND l.voucher_type <> 'year_close'
        ${branchSql}
      GROUP BY a.account_code
      ORDER BY a.account_code`,
    params
  );
  return rows.map((r) => ({ code: r.code, purchases: r2(Number(r.purchases)), movement: r2(Number(r.movement)) }));
}

/** Account id to the Schedule III line stored on it. Read through to_jsonb so it works before the column exists. */
export async function loadSchedule3Overrides(businessId: string): Promise<Map<string, string>> {
  const rows = await queryRows<{ id: string; schedule3_line: string | null }>(
    `SELECT a.id, to_jsonb(a) ->> 'schedule3_line' AS schedule3_line
       FROM accounts a
      WHERE a.business_id = $1`,
    [businessId]
  );
  const map = new Map<string, string>();
  for (const r of rows) if (r.schedule3_line) map.set(r.id, r.schedule3_line);
  return map;
}

export interface Schedule3Report {
  statement: Schedule3Statement;
  standard_net_profit: number;
  difference: number;
}

export async function buildSchedule3(opts: BuildPlOptions): Promise<Schedule3Report> {
  const plRows = await loadPlAccounts(opts);
  const overrides = await loadSchedule3Overrides(opts.businessId);
  const rows: Schedule3AccountRow[] = plRows.map((r) => ({ ...r, schedule3_line: overrides.get(r.id) ?? null }));
  const inventoryModel = await getInventoryModel(undefined, opts.businessId);

  let cogsDetail: COGSCalculation | null = null;
  let stock: StockMovement[] = [];
  if (inventoryModel === 'periodic') {
    try {
      const fy = opts.financialYear || undefined;
      cogsDetail = await calculateCOGS(opts.businessId, opts.fromDate, opts.toDate, fy, previousFinancialYear(fy));
    } catch (error) {
      console.error('Error calculating COGS schedule:', error);
    }
  } else {
    stock = await loadStockMovements(opts);
  }
  const periodic = inventoryModel === 'periodic' && cogsDetail ? cogsDetail : null;

  const statement = assembleSchedule3(rows, { consolidated: opts.consolidated, periodic, stock });
  const standardNetProfit = assemblePl(plRows, { consolidated: opts.consolidated, periodic }).net_profit;
  return {
    statement,
    standard_net_profit: standardNetProfit,
    difference: r2(statement.profit_for_period - standardNetProfit),
  };
}

/** The same calendar date one year earlier (2024-02-29 becomes 2023-02-28). Works on the string parts, never on Date. */
export function shiftYearBack(iso: string): string {
  const year = Number(iso.slice(0, 4)) - 1;
  const month = iso.slice(5, 7);
  let day = Number(iso.slice(8, 10));
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (month === '02' && day === 29 && !isLeap(year)) day = 28;
  return `${String(year).padStart(4, '0')}-${month}-${String(day).padStart(2, '0')}`;
}
