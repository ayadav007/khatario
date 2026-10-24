/**
 * Indirect-method cash flow statement (AS 3) built from ledger movements.
 * Every non-cash account is classified, so net cash flow always equals the movement in the
 * cash and bank ledgers (a balanced ledger nets to zero).
 */

import type { BsClass } from '@/lib/reports/balance-sheet';

export type CfAccount = {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'capital' | 'income' | 'expense' | string;
  groupCode: string | null;
  /** Balance-sheet class from the account's group chain; code ranges are the fallback. */
  bsClass?: BsClass | null;
  isCash: boolean;
  /** Dr - Cr before the period. */
  opening: number;
  periodDebit: number;
  periodCredit: number;
};

export type CfLine = { label: string; amount: number; codes: string[] };

export type CashFlowStatement = {
  openingCash: number;
  closingCash: number;
  netProfit: number;
  operating: { adjustments: CfLine[]; workingCapital: CfLine[]; total: number };
  investing: { lines: CfLine[]; total: number };
  financing: { lines: CfLine[]; total: number };
  netCashFlow: number;
  /** Should be 0; non-zero means an unbalanced voucher in the period. */
  difference: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

const GAIN_ON_SALE = '4205';
const LOSS_ON_SALE = '5218';
const ACCUM_DEP = '1202';

const WC_LABELS: Array<[RegExp, string, 'asset' | 'liability']> = [
  [/^1103/, 'Trade receivables', 'asset'],
  [/^1104/, 'Inventories', 'asset'],
  [/^111[0-5]/, 'GST input credit', 'asset'],
  [/^113[0-3]$/, 'GST electronic cash ledger', 'asset'],
  [/^111[67]/, 'TDS / advance tax paid', 'asset'],
  [/^1107/, 'Advances to suppliers', 'asset'],
  [/^2101/, 'Trade payables', 'liability'],
  [/^215/, 'GST payable', 'liability'],
  [/^2102|^2117/, 'TDS / TCS payable', 'liability'],
  [/^2106/, 'Advances from customers', 'liability'],
  [/^2109/, 'Income tax payable', 'liability'],
  [/^2108/, 'Provisions', 'liability'],
];

function isFixedAsset(a: CfAccount) {
  if (a.type !== 'asset' || a.code === ACCUM_DEP) return false;
  return a.bsClass ? a.bsClass === 'fixed_asset' : a.groupCode === '1200' || a.code.startsWith('12');
}
function isInvestment(a: CfAccount) {
  if (a.type !== 'asset') return false;
  return a.bsClass ? a.bsClass === 'investment' : a.groupCode === '1300' || a.code.startsWith('13');
}
function isLongTermLiability(a: CfAccount) {
  if (a.type !== 'liability') return false;
  return a.bsClass ? a.bsClass === 'long_term_liability' : a.groupCode === '2200' || a.code.startsWith('22');
}

function add(map: Map<string, CfLine>, label: string, amount: number, code: string) {
  if (Math.abs(amount) < 0.005) return;
  const cur = map.get(label);
  if (cur) {
    cur.amount += amount;
    if (!cur.codes.includes(code)) cur.codes.push(code);
  } else {
    map.set(label, { label, amount, codes: [code] });
  }
}

const lines = (m: Map<string, CfLine>) =>
  Array.from(m.values())
    .map((l) => ({ ...l, amount: r2(l.amount) }))
    .filter((l) => l.amount !== 0);

export type CashFlowOptions = {
  /**
   * Closing-stock adjustment the Profit & Loss adds to ledger profit in periodic books
   * (`ledger_check.inventory_adjustment`). It is added to net profit and taken out again as a
   * change in inventories, so net profit matches the P&L and the statement still balances.
   */
  inventoryAdjustment?: number;
};

export function buildCashFlow(accounts: CfAccount[], opts: CashFlowOptions = {}): CashFlowStatement {
  let openingCash = 0;
  let cashMovement = 0;
  let netProfit = 0;
  const adjustments = new Map<string, CfLine>();
  const wc = new Map<string, CfLine>();
  const investing = new Map<string, CfLine>();
  const financing = new Map<string, CfLine>();

  for (const a of accounts) {
    const drCr = a.periodDebit - a.periodCredit;
    if (a.isCash) {
      openingCash += a.opening;
      cashMovement += drCr;
      continue;
    }

    if (a.type === 'income' || a.type === 'expense') {
      netProfit -= drCr;
      if (a.code === GAIN_ON_SALE || a.code === LOSS_ON_SALE) {
        add(adjustments, a.code === GAIN_ON_SALE ? 'Less: profit on sale of fixed assets' : 'Add: loss on sale of fixed assets', drCr, a.code);
        add(investing, 'Sale of fixed assets', -drCr, a.code);
      }
      continue;
    }

    if (a.code === ACCUM_DEP) {
      add(adjustments, 'Add: depreciation', a.periodCredit, a.code);
      add(investing, 'Sale of fixed assets', -a.periodDebit, a.code);
      continue;
    }
    if (isFixedAsset(a)) {
      add(investing, 'Purchase of fixed assets', -a.periodDebit, a.code);
      add(investing, 'Sale of fixed assets', a.periodCredit, a.code);
      continue;
    }
    if (isInvestment(a)) {
      add(investing, 'Investments (net)', -drCr, a.code);
      continue;
    }
    if (a.type === 'asset' && a.code.startsWith('1108')) {
      add(investing, 'Loans and advances given', -drCr, a.code);
      continue;
    }
    if (a.bsClass === 'other_asset') {
      add(investing, 'Other non-current assets', -drCr, a.code);
      continue;
    }
    if (isLongTermLiability(a)) {
      add(financing, 'Long-term borrowings (net)', -drCr, a.code);
      continue;
    }
    if (a.type === 'capital') {
      add(financing, a.code.startsWith('3003') ? 'Drawings' : 'Capital introduced (net)', -drCr, a.code);
      continue;
    }

    const match = WC_LABELS.find(([re]) => re.test(a.code));
    const label = match ? match[1] : a.type === 'liability' ? 'Other current liabilities' : 'Other current assets';
    add(wc, label, -drCr, a.code);
  }

  if (opts.inventoryAdjustment) {
    netProfit += opts.inventoryAdjustment;
    add(wc, 'Inventories', -opts.inventoryAdjustment, 'closing_stock');
  }

  const adj = lines(adjustments);
  const wcl = lines(wc);
  const inv = lines(investing);
  const fin = lines(financing);
  const sum = (ls: CfLine[]) => ls.reduce((s, l) => s + l.amount, 0);

  const operatingTotal = r2(netProfit + sum(adj) + sum(wcl));
  const investingTotal = r2(sum(inv));
  const financingTotal = r2(sum(fin));
  const netCashFlow = r2(operatingTotal + investingTotal + financingTotal);

  return {
    openingCash: r2(openingCash),
    closingCash: r2(openingCash + cashMovement),
    netProfit: r2(netProfit),
    operating: { adjustments: adj, workingCapital: wcl, total: operatingTotal },
    investing: { lines: inv, total: investingTotal },
    financing: { lines: fin, total: financingTotal },
    netCashFlow,
    difference: r2(cashMovement - netCashFlow),
  };
}
