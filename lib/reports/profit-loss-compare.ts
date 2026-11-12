// Lines up several finished Profit & Loss results by account for the Compare tab.
// Server-only: it imports values from lib/reports/profit-loss.ts, which imports the database.
// Section totals and profits are copied from each report, never re-added.

import {
  REPORT_SECTIONS,
  buildProfitAndLoss,
  type BranchScope,
  type PlAccountNode,
  type ProfitAndLoss,
  type ReportSection,
} from '@/lib/reports/profit-loss';
import { periodLabel, type Period } from '@/lib/reports/pl-compare-periods';

export interface CompareRow {
  id: string; account_code: string; account_name: string; is_active: boolean;
  amounts: number[];          // the account's own amount per column
  totals: number[];           // own amount plus sub-accounts per column
  children: CompareRow[];
}
export interface CompareSection {
  key: ReportSection; label: string;
  totals: number[];           // the builder's section total per column
  stock: null | { opening_stock: number[]; purchases: number[]; closing_stock: number[] };
  rows: CompareRow[];
}
export interface ComparedPl {
  sections: CompareSection[]; // REPORT_SECTIONS order
  gross_profit: number[]; operating_profit: number[]; net_profit: number[];
  profit_before_tax: number[]; ebit: number[]; ebitda: number[];
  elimination: { applied: boolean; net: number[] };
}

const isNil = (n: number) => Math.abs(n) < 0.005;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Entry {
  row: CompareRow;
  parentId: string | null;
}

function collectSection(reports: ProfitAndLoss[], key: ReportSection): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const n = reports.length;

  const visit = (node: PlAccountNode, parentId: string | null, col: number) => {
    let entry = entries.get(node.id);
    if (!entry) {
      entry = {
        row: {
          id: node.id,
          account_code: node.account_code,
          account_name: node.account_name,
          is_active: node.is_active,
          amounts: new Array<number>(n).fill(0),
          totals: new Array<number>(n).fill(0),
          children: [],
        },
        parentId,
      };
      entries.set(node.id, entry);
    } else if (entry.parentId === null && parentId !== null) {
      // First seen at top level (its inactive parent was absent from that period): adopt the parent.
      entry.parentId = parentId;
    }
    entry.row.amounts[col] = node.amount;
    for (const child of node.children) visit(child, node.id, col);
  };

  reports.forEach((report, col) => {
    for (const node of report.sections[key].accounts) visit(node, null, col);
  });
  return entries;
}

function buildRows(entries: Map<string, Entry>, includeZero: boolean): CompareRow[] {
  const roots: CompareRow[] = [];
  for (const { row, parentId } of entries.values()) {
    const parent = parentId === null ? undefined : entries.get(parentId);
    if (parent) parent.row.children.push(row);
    else roots.push(row);
  }

  // A row's total per column is its own amount plus its sub-accounts' totals in the lined-up tree.
  const sumTotals = (r: CompareRow) => {
    for (const c of r.children) sumTotals(c);
    r.totals = r.amounts.map((a, col) => r2(r.children.reduce((sum, c) => sum + c.totals[col], a)));
  };
  roots.forEach(sumTotals);

  const byCode = (a: CompareRow, b: CompareRow) =>
    a.account_code < b.account_code ? -1 : a.account_code > b.account_code ? 1 : 0;

  const finish = (rows: CompareRow[]): CompareRow[] => {
    const kept: CompareRow[] = [];
    for (const r of rows) {
      r.children = finish(r.children);
      if (includeZero || r.children.length > 0 || !r.amounts.every(isNil)) kept.push(r);
    }
    return kept.sort(byCode);
  };
  return finish(roots);
}

export function mergeProfitAndLoss(reports: ProfitAndLoss[], opts: { includeZero: boolean }): ComparedPl {
  const sections: CompareSection[] = REPORT_SECTIONS.map((key) => {
    const hasStock = key === 'cost_of_goods_sold' && reports.some((r) => r.periodic_cogs);
    return {
      key,
      label: reports[0]?.sections[key].label ?? key,
      totals: reports.map((r) => r.sections[key].total),
      stock: hasStock
        ? {
            opening_stock: reports.map((r) => r.periodic_cogs?.opening_stock ?? 0),
            purchases: reports.map((r) => r.periodic_cogs?.purchases ?? 0),
            closing_stock: reports.map((r) => r.periodic_cogs?.closing_stock ?? 0),
          }
        : null,
      rows: buildRows(collectSection(reports, key), opts.includeZero),
    };
  });

  return {
    sections,
    gross_profit: reports.map((r) => r.gross_profit),
    operating_profit: reports.map((r) => r.operating_profit),
    net_profit: reports.map((r) => r.net_profit),
    profit_before_tax: reports.map((r) => r.earnings.profit_before_tax),
    ebit: reports.map((r) => r.earnings.ebit),
    ebitda: reports.map((r) => r.earnings.ebitda),
    elimination: {
      applied: reports.some((r) => r.elimination.applied),
      net: reports.map((r) => r.elimination.net),
    },
  };
}

/** Financial year (starting April) a YYYY-MM-DD date belongs to. */
function financialYearOf(s: string): number {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return m < 4 ? y - 1 : y;
}

export function columnNotes(period: Period, report: ProfitAndLoss): string[] {
  const label = periodLabel(period);
  const notes: string[] = [];

  if (financialYearOf(period.from) !== financialYearOf(period.to)) {
    notes.push(
      `${label} crosses a financial year end. Its opening stock and purchases belong to different years, so treat it as a management figure.`
    );
  }

  const cogs = report.cogs_detail;
  if (report.periodic_cogs && cogs) {
    const hasInventoryActivity =
      (cogs.purchases?.gross_purchases ?? 0) > 0.01 ||
      (cogs.openingStock?.value ?? 0) > 0.01 ||
      (cogs.closingStock?.value ?? 0) > 0.01;
    const closingSrc = cogs.closingStock?.source;
    if (hasInventoryActivity && closingSrc && closingSrc !== 'snapshot') {
      notes.push(
        `${label}: ` +
          'Closing stock for this period is derived from live inventory and purchase history, not from a formal year-end closing snapshot. ' +
          'Gross profit and COGS are management estimates until your CA finalizes physical stock valuation and (where applicable) records a year-end closing entry / snapshot.'
      );
    }
  }

  const diff = report.ledger_check.difference;
  if (Math.abs(diff) >= 0.01) {
    notes.push(`${label} differs from the ledger by ₹${Math.abs(diff).toFixed(2)}. Please report this.`);
  }

  return notes;
}

/**
 * On periodic books every period must carry a stock schedule, or none may: the builder falls back
 * to ledger figures when the stock calculation fails, which would put one period on another basis.
 */
export function assertConsistentStockBasis(reports: ProfitAndLoss[]): void {
  if (!reports.some((r) => r.inventory_model === 'periodic')) return;
  const withSchedule = reports.filter((r) => r.periodic_cogs != null).length;
  if (withSchedule > 0 && withSchedule < reports.length) {
    throw new Error('The stock schedule could not be worked out for every period. Please try again.');
  }
}

export interface CompareColumn { from_date: string; to_date: string; notes: string[] }
export interface PlComparison extends ComparedPl {
  columns: CompareColumn[];
  inventory_model: 'periodic' | 'perpetual';
}

/** Builds the Standard report for every period at once and lines them up. Any failure rejects the call. */
export async function buildComparison(opts: {
  businessId: string; branch: BranchScope; consolidated: boolean;
  periods: Period[]; includeZero: boolean;
}): Promise<PlComparison> {
  const reports = await Promise.all(
    opts.periods.map((period) =>
      buildProfitAndLoss({
        businessId: opts.businessId,
        fromDate: period.from,
        toDate: period.to,
        branch: opts.branch,
        consolidated: opts.consolidated,
        financialYear: null,
        includeZero: true,
      })
    )
  );
  assertConsistentStockBasis(reports);
  return {
    ...mergeProfitAndLoss(reports, { includeZero: opts.includeZero }),
    columns: opts.periods.map((period, i) => ({
      from_date: period.from,
      to_date: period.to,
      notes: columnNotes(period, reports[i]),
    })),
    inventory_model: reports[0].inventory_model,
  };
}
