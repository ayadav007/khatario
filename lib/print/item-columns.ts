/**
 * The item table as data: a registry of columns a business can choose and order (template setting
 * `item_columns`), turned into rows of formatted cells for templates that loop over columns, plus the
 * GST-slab summary that distributor bills print above the items.
 */
import { getDocumentRule } from '@/lib/invoice-config';
import { isStatutoryDocument } from '@/lib/invoice-statutory';

export type ColumnAlign = 'left' | 'right' | 'center';

/** A presented invoice line (strings or numbers, as the presenter builds them). */
export type PrintLine = Record<string, unknown>;

type Ctx = { isIgst: boolean; lines: PrintLine[] };

export interface ItemColumn {
  id: string;
  label: string;
  align: ColumnAlign;
  /** Relative width; the builder turns these into percentages. */
  width: number;
  value: (line: PrintLine, ctx: Ctx) => string;
  /** How the totals row adds this column up, if at all. */
  total?: (lines: PrintLine[]) => string;
  /** Leave the column out when the bill has nothing to show in it. */
  shown?: (ctx: Ctx) => boolean;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function formatMoney(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatQty(n: number): string {
  return String(round3(n));
}
function formatRate(n: number): string {
  return String(Number(n.toFixed(2)));
}

const sumMoney = (pick: (l: PrintLine) => number) => (lines: PrintLine[]) =>
  formatMoney(lines.reduce((s, l) => s + pick(l), 0));
const sumQty = (pick: (l: PrintLine) => number) => (lines: PrintLine[]) =>
  formatQty(lines.reduce((s, l) => s + pick(l), 0));

const caseFactor = (l: PrintLine) => num(l.case_factor);
const hasCase = (l: PrintLine) => caseFactor(l) > 1;
const sameUnit = (a: unknown, b: unknown) =>
  String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();

/**
 * Quantity in the item's base unit (pieces). A line saved with its unit's factor (5 BOX of 12)
 * counts qty × that factor; an older line in the case unit counts factor × qty; any other unit is
 * taken as already being pieces.
 */
export function baseQuantity(l: PrintLine): number {
  const qty = num(l.quantity);
  const saved = num(l.unit_factor);
  if (saved > 0 && saved !== 1) return round3(qty * saved);
  return hasCase(l) && l.case_unit && sameUnit(l.unit, l.case_unit) ? qty * caseFactor(l) : qty;
}

/** Whole cases and loose pieces, e.g. 50 pieces at 12 per case = 4 cases + 2 pieces. */
export function casesAndPieces(l: PrintLine): { cases: number; pieces: number } {
  const base = baseQuantity(l);
  if (!hasCase(l)) return { cases: 0, pieces: base };
  const f = caseFactor(l);
  const cases = Math.floor(round3(base / f));
  return { cases, pieces: round3(base - cases * f) };
}

const gross = (l: PrintLine) => num(l.quantity) * num(l.unit_price);
const mrpOf = (l: PrintLine) => num(l.mrp);
const anyLine = (pred: (l: PrintLine) => boolean) => (ctx: Ctx) => ctx.lines.some(pred);

export const ITEM_COLUMNS: ItemColumn[] = [
  { id: 'sno', label: '#', align: 'center', width: 3, value: (l) => String(l.index ?? '') },
  { id: 'hsn', label: 'HSN', align: 'left', width: 8, value: (l) => String(l.hsn_sac ?? '') },
  {
    id: 'item_code', label: 'P.Code', align: 'left', width: 8, value: (l) => String(l.item_code ?? ''),
    shown: anyLine((l) => !!String(l.item_code ?? '').trim()),
  },
  {
    id: 'description', label: 'Item Description', align: 'left', width: 24,
    value: (l) => String(l.item_name ?? '') + (l.variant_name ? ` (${l.variant_name})` : ''),
  },
  {
    id: 'mrp', label: 'MRP', align: 'right', width: 7, value: (l) => (mrpOf(l) > 0 ? formatMoney(mrpOf(l)) : ''),
    shown: anyLine((l) => mrpOf(l) > 0),
  },
  {
    id: 'cases', label: 'Cs', align: 'right', width: 4,
    value: (l) => (hasCase(l) ? formatQty(casesAndPieces(l).cases) : ''),
    total: sumQty((l) => casesAndPieces(l).cases),
    shown: anyLine(hasCase),
  },
  {
    id: 'pieces', label: 'Pcs', align: 'right', width: 5,
    value: (l) => formatQty(casesAndPieces(l).pieces),
    total: sumQty((l) => casesAndPieces(l).pieces),
  },
  {
    id: 'upc', label: 'UPC', align: 'right', width: 4, value: (l) => (hasCase(l) ? formatQty(caseFactor(l)) : ''),
    shown: anyLine(hasCase),
  },
  {
    id: 'qty', label: 'Qty', align: 'right', width: 6, value: (l) => formatQty(num(l.quantity)),
    total: sumQty((l) => num(l.quantity)),
  },
  { id: 'unit', label: 'Unit', align: 'center', width: 5, value: (l) => String(l.unit ?? '') },
  { id: 'rate', label: 'Rate', align: 'right', width: 7, value: (l) => formatMoney(num(l.unit_price)) },
  {
    id: 'gross', label: 'Gross Amt', align: 'right', width: 8, value: (l) => formatMoney(gross(l)),
    total: sumMoney(gross),
  },
  {
    id: 'discount_percent', label: 'Disc %', align: 'right', width: 5,
    value: (l) => (num(l.discount_percent) ? formatRate(num(l.discount_percent)) : ''),
  },
  {
    id: 'discount', label: 'Disc Amt', align: 'right', width: 7, value: (l) => formatMoney(num(l.discount_amount)),
    total: sumMoney((l) => num(l.discount_amount)),
  },
  {
    id: 'taxable', label: 'Taxable', align: 'right', width: 8, value: (l) => formatMoney(num(l.taxable_value)),
    total: sumMoney((l) => num(l.taxable_value)),
  },
  { id: 'gst_rate', label: 'GST %', align: 'right', width: 5, value: (l) => formatRate(num(l.tax_rate)) },
  {
    id: 'cgst_igst', label: 'IGST/ CGST', align: 'right', width: 7,
    value: (l) => formatMoney(num(l.igst_amount) || num(l.cgst_amount)),
    total: sumMoney((l) => num(l.igst_amount) || num(l.cgst_amount)),
  },
  {
    id: 'cgst', label: 'CGST', align: 'right', width: 7, value: (l) => formatMoney(num(l.cgst_amount)),
    total: sumMoney((l) => num(l.cgst_amount)), shown: (c) => !c.isIgst,
  },
  {
    id: 'sgst', label: 'SGST', align: 'right', width: 7, value: (l) => formatMoney(num(l.sgst_amount)),
    total: sumMoney((l) => num(l.sgst_amount)), shown: (c) => !c.isIgst,
  },
  {
    id: 'igst', label: 'IGST', align: 'right', width: 7, value: (l) => formatMoney(num(l.igst_amount)),
    total: sumMoney((l) => num(l.igst_amount)), shown: (c) => c.isIgst,
  },
  {
    id: 'cess', label: 'Cess', align: 'right', width: 6, value: (l) => formatMoney(num(l.cess_amount)),
    total: sumMoney((l) => num(l.cess_amount)), shown: anyLine((l) => num(l.cess_amount) > 0),
  },
  {
    id: 'tax', label: 'Tax Amt', align: 'right', width: 7, value: (l) => formatMoney(num(l.tax_amount)),
    total: sumMoney((l) => num(l.tax_amount)),
  },
  {
    id: 'batch', label: 'Batch', align: 'left', width: 8, value: (l) => String(l.batch_number ?? ''),
    shown: anyLine((l) => !!l.batch_number),
  },
  {
    id: 'expiry', label: 'Expiry', align: 'left', width: 8, value: (l) => String(l.expiry_date ?? ''),
    shown: anyLine((l) => !!l.expiry_date),
  },
  {
    id: 'net', label: 'Net Amt', align: 'right', width: 8, value: (l) => formatMoney(num(l.line_total)),
    total: sumMoney((l) => num(l.line_total)),
  },
];

const BY_ID = new Map(ITEM_COLUMNS.map((c) => [c.id, c]));

/** The photo's layout: what a distributor bill shows when the business has not chosen. */
export const DEFAULT_DISTRIBUTOR_COLUMNS = [
  'sno', 'hsn', 'item_code', 'description', 'mrp', 'cases', 'pieces', 'upc', 'rate', 'gross',
  'discount', 'taxable', 'gst_rate', 'cgst_igst', 'sgst', 'cess', 'net',
];

/**
 * Columns a GST document must print, as groups: one column from each group. HSN, quantity, taxable
 * value, rate and amount of tax, and the line value (CGST Rules 46(g)–(l)).
 */
function requiredGroups(isIgst: boolean): string[][] {
  return [
    ['hsn'],
    ['qty', 'pieces'],
    ['taxable'],
    ['gst_rate'],
    ...(isIgst ? [['igst', 'cgst_igst']] : [['cgst', 'cgst_igst'], ['sgst']]),
    ['net'],
  ];
}

/** Column ids a business cannot untick on a GST document (shown locked in the chooser). */
export const ALWAYS_PRINTED_COLUMNS = ['hsn', 'taxable', 'gst_rate', 'net'];

export interface CustomItemColumn {
  key: string;
  label: string;
}

export interface ItemTableColumn {
  id: string;
  label: string;
  align: ColumnAlign;
  width_pct: number;
}
export interface ItemTableCell {
  text: string;
  align: ColumnAlign;
}
export interface ItemTable {
  columns: ItemTableColumn[];
  rows: { cells: ItemTableCell[] }[];
  totals: ItemTableCell[];
}

function customColumn(def: CustomItemColumn): ItemColumn {
  return {
    id: `cf:${def.key}`,
    label: def.label,
    align: 'left',
    width: 7,
    value: (l) => {
      const fields = (l.item_custom_fields ?? {}) as Record<string, unknown>;
      const v = fields && typeof fields === 'object' ? fields[def.key] : undefined;
      return v === undefined || v === null ? '' : String(v);
    },
  };
}

/**
 * The ordered column ids that will print: the business's choice (or the default), unknown ids and
 * columns with nothing to show dropped, and any column a GST document must print put back in its
 * default position.
 */
export function resolveColumnIds(opts: {
  chosen?: unknown;
  docType?: string | null;
  isIgst: boolean;
  lines: PrintLine[];
  customColumns?: CustomItemColumn[];
  defaults?: string[];
}): string[] {
  const custom = new Map((opts.customColumns || []).map((c) => [`cf:${c.key}`, c]));
  const known = (id: string) => BY_ID.has(id) || custom.has(id);
  const chosen = Array.isArray(opts.chosen) ? opts.chosen.filter((x): x is string => typeof x === 'string') : [];
  const base = chosen.filter(known);
  let ids = Array.from(new Set(base.length ? base : opts.defaults || DEFAULT_DISTRIBUTOR_COLUMNS));

  const ctx: Ctx = { isIgst: opts.isIgst, lines: opts.lines };
  ids = ids.filter((id) => {
    const col = BY_ID.get(id);
    return !col?.shown || col.shown(ctx);
  });

  if (isStatutoryDocument(opts.docType) && getDocumentRule(opts.docType).isTaxable) {
    const order = ITEM_COLUMNS.map((c) => c.id);
    for (const group of requiredGroups(opts.isIgst)) {
      if (group.some((id) => ids.includes(id))) continue;
      const add = group[0];
      // Insert before the first column that comes after it in the registry order.
      const at = ids.findIndex((id) => order.indexOf(id) > order.indexOf(add) && order.includes(id));
      if (at < 0) ids.push(add);
      else ids.splice(at, 0, add);
    }
  }
  return ids;
}

export function buildItemTable(opts: {
  lines: PrintLine[];
  chosen?: unknown;
  docType?: string | null;
  isIgst: boolean;
  customColumns?: CustomItemColumn[];
  translate?: (label: string) => string;
}): ItemTable {
  const custom = new Map((opts.customColumns || []).map((c) => [`cf:${c.key}`, customColumn(c)]));
  const ids = resolveColumnIds(opts);
  const cols = ids.map((id) => BY_ID.get(id) || custom.get(id)!).filter(Boolean);
  const ctx: Ctx = { isIgst: opts.isIgst, lines: opts.lines };
  const t = opts.translate || ((s: string) => s);
  const widthSum = cols.reduce((s, c) => s + c.width, 0) || 1;

  // The totals row says "Total" under the description, or else in the first column that does not add up.
  const descAt = cols.findIndex((c) => c.id === 'description');
  const labelAt = descAt >= 0 ? descAt : cols.findIndex((c) => !c.total);
  return {
    columns: cols.map((c) => ({
      id: c.id,
      label: t(c.label),
      align: c.align,
      width_pct: Math.round((c.width / widthSum) * 1000) / 10,
    })),
    rows: opts.lines.map((l) => ({ cells: cols.map((c) => ({ text: c.value(l, ctx), align: c.align })) })),
    totals: cols.map((c, i) => ({
      text: c.total ? c.total(opts.lines) : i === labelAt ? t('Total') : '',
      align: c.total ? c.align : 'left',
    })),
  };
}

export interface SlabRow {
  tax_rate: string;
  pieces: string;
  gross: string;
  discount: string;
  taxable: string;
  tax: string;
  net: string;
  margin: string;
  margin_pct: string;
}

/**
 * One row per GST rate, as distributor bills print above the items. Margin is the retailer's:
 * MRP value of the pieces less the net amount, as a percentage of the net amount, over lines that
 * carry an MRP.
 */
export function buildSlabSummary(lines: PrintLine[]): { rows: SlabRow[]; totals: SlabRow; has_margin: boolean } {
  type Acc = { pieces: number; gross: number; discount: number; taxable: number; tax: number; net: number; mrpValue: number; mrpNet: number };
  const empty = (): Acc => ({ pieces: 0, gross: 0, discount: 0, taxable: 0, tax: 0, net: 0, mrpValue: 0, mrpNet: 0 });
  const groups = new Map<number, Acc>();
  const all = empty();

  for (const l of lines) {
    const rate = num(l.tax_rate);
    const g = groups.get(rate) || empty();
    for (const acc of [g, all]) {
      acc.pieces += baseQuantity(l);
      acc.gross += gross(l);
      acc.discount += num(l.discount_amount);
      acc.taxable += num(l.taxable_value);
      acc.tax += num(l.tax_amount) + num(l.cess_amount);
      acc.net += num(l.line_total);
      if (mrpOf(l) > 0) {
        acc.mrpValue += mrpOf(l) * baseQuantity(l);
        acc.mrpNet += num(l.line_total);
      }
    }
    groups.set(rate, g);
  }

  const row = (rate: string, a: Acc): SlabRow => {
    const margin = a.mrpValue - a.mrpNet;
    return {
      tax_rate: rate,
      pieces: formatQty(a.pieces),
      gross: formatMoney(a.gross),
      discount: formatMoney(a.discount),
      taxable: formatMoney(a.taxable),
      tax: formatMoney(a.tax),
      net: formatMoney(a.net),
      margin: a.mrpNet > 0 ? formatMoney(margin) : '',
      margin_pct: a.mrpNet > 0 ? (margin / a.mrpNet * 100).toFixed(2) : '',
    };
  };

  return {
    rows: Array.from(groups.entries()).sort((a, b) => a[0] - b[0]).map(([r, a]) => row(formatRate(r), a)),
    totals: row('', all),
    has_margin: all.mrpNet > 0,
  };
}

/** Picks the case unit from an item's alternate units: a unit named like a case, else the largest. */
export function pickCaseUnit(units: { unit: string; factor_to_base: unknown }[]): { unit: string; factor: number } | null {
  const usable = units
    .map((u) => ({ unit: String(u.unit || '').trim(), factor: num(u.factor_to_base) }))
    .filter((u) => u.unit && u.factor > 1);
  if (!usable.length) return null;
  const named = usable.find((u) => /^(CASE|CS|CTN|CARTON|BOX|BX)S?$/i.test(u.unit));
  return named || usable.reduce((a, b) => (b.factor > a.factor ? b : a));
}

/**
 * Adds `invoice.item_table` and `invoice.slab_summary` to presented render data, from the template
 * setting `item_columns` and the business's item custom fields (`invoice.item_field_defs`).
 */
export function attachItemTablePrintData<T extends {
  invoice: Record<string, unknown>;
  items: PrintLine[];
  settings?: Record<string, unknown>;
}>(data: T, opts: { docType?: string | null; translate?: (label: string) => string } = {}): T {
  const isIgst = !!data.invoice.is_igst;
  const customColumns = (Array.isArray(data.invoice.item_field_defs) ? data.invoice.item_field_defs : []) as CustomItemColumn[];
  return {
    ...data,
    invoice: {
      ...data.invoice,
      item_table: buildItemTable({
        lines: data.items,
        chosen: data.settings?.item_columns,
        docType: opts.docType ?? (data.invoice.document_type as string | undefined),
        isIgst,
        customColumns,
        translate: opts.translate,
      }),
      slab_summary: buildSlabSummary(data.items),
    },
  };
}
