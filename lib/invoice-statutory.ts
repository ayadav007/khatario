/**
 * What a GST document must print, whatever the business has switched off in its template
 * settings, plus the copy label and HSN-wise tax summary that Indian invoices carry.
 *
 * CGST Rules: 46 (tax invoice), 48 (copies), 49 (bill of supply), 53 (credit/debit notes),
 * 55 (delivery challan).
 */
import { getDocumentRule } from './invoice-config';

export type PrintCopy = 'original' | 'duplicate' | 'triplicate';

const THERMAL_TEMPLATES = new Set(['thermal_58mm', 'thermal_80mm']);

/** Printed on every GST document, thermal receipts included. */
const ALWAYS_SHOWN = [
  'show_business_name',
  'show_business_address',
  'show_business_gstin',
  'show_bill_to',
  'show_customer_name',
  'show_customer_address',
  'show_customer_gstin',
  'show_invoice_number',
  'show_invoice_date',
  'show_place_of_supply',
  'show_item_name',
  'show_quantity',
  'show_unit',
  'show_line_total',
  'show_grand_total',
];

/** Printed on every A4/A5 GST document. Thermal receipts are B2C and skip these. */
const PAGE_SHOWN = ['show_hsn', 'show_rate', 'show_signature', 'show_authorized_signatory', 'show_copy_label'];

/** Printed on A4/A5 GST documents that carry tax (not a bill of supply). */
const PAGE_TAXED_SHOWN = [
  'show_tax_rate',
  'show_cgst',
  'show_sgst',
  'show_igst',
  'show_tax_total',
  'show_reverse_charge',
  'show_hsn_summary',
];

/** Tax invoices, bills of supply, credit and debit notes: the documents reported in GSTR-1. */
export function isStatutoryDocument(docType: string | null | undefined): boolean {
  return getDocumentRule(docType).showInGstr1;
}

/**
 * Settings the business cannot switch off for this document and template.
 * `b2b` (the buyer has a GSTIN) adds HSN on thermal receipts, where it is otherwise optional.
 */
export function lockedSettingKeys(
  docType: string | null | undefined,
  templateId: string | null | undefined,
  opts: { b2b?: boolean } = {},
): string[] {
  if (!isStatutoryDocument(docType)) return [];
  const keys = [...ALWAYS_SHOWN];
  if (THERMAL_TEMPLATES.has(String(templateId || ''))) {
    if (opts.b2b) keys.push('show_hsn');
    return keys;
  }
  keys.push(...PAGE_SHOWN);
  if (getDocumentRule(docType).isTaxable) keys.push(...PAGE_TAXED_SHOWN);
  return keys;
}

export function applyStatutorySettings<T extends Record<string, unknown>>(
  settings: T,
  docType: string | null | undefined,
  templateId: string | null | undefined,
  opts: { b2b?: boolean } = {},
): T {
  const out: Record<string, unknown> = { ...settings };
  for (const key of lockedSettingKeys(docType, templateId, opts)) out[key] = true;
  return out as T;
}

type HsnLike = { hsn_sac?: unknown };

/** Services-only documents (every line is a SAC, 99xxxx) need two copies, goods need three. */
function isServicesOnly(items: HsnLike[]): boolean {
  return items.length > 0 && items.every((i) => String(i.hsn_sac || '').trim().startsWith('99'));
}

const GOODS_LABELS: Record<PrintCopy, string> = {
  original: 'Original for Recipient',
  duplicate: 'Duplicate for Transporter',
  triplicate: 'Triplicate for Supplier',
};
const SERVICES_LABELS: Record<PrintCopy, string> = {
  original: 'Original for Recipient',
  duplicate: 'Duplicate for Supplier',
  triplicate: 'Duplicate for Supplier',
};
const CHALLAN_LABELS: Record<PrintCopy, string> = {
  original: 'Original for Consignee',
  duplicate: 'Duplicate for Transporter',
  triplicate: 'Triplicate for Consigner',
};

export function normalizePrintCopy(value: unknown): PrintCopy {
  return value === 'duplicate' || value === 'triplicate' ? value : 'original';
}

/** The copies Rule 48 / Rule 55 asks for, in print order. Empty for non-GST documents. */
export function printCopiesFor(docType: string | null | undefined, items: HsnLike[]): PrintCopy[] {
  if (docType === 'delivery_challan') return ['original', 'duplicate', 'triplicate'];
  if (!isStatutoryDocument(docType)) return [];
  return isServicesOnly(items) ? ['original', 'duplicate'] : ['original', 'duplicate', 'triplicate'];
}

/** "Original for Recipient" etc., or null for documents that carry no copy label. */
export function copyLabelFor(
  docType: string | null | undefined,
  copy: PrintCopy,
  items: HsnLike[],
): string | null {
  if (docType === 'delivery_challan') return CHALLAN_LABELS[copy];
  if (!isStatutoryDocument(docType)) return null;
  return (isServicesOnly(items) ? SERVICES_LABELS : GOODS_LABELS)[copy];
}

type TaxLine = HsnLike & {
  taxable_value?: unknown;
  tax_rate?: unknown;
  cgst_amount?: unknown;
  sgst_amount?: unknown;
  igst_amount?: unknown;
  tax_amount?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  discount_amount?: unknown;
};

function taxableValueOf(item: TaxLine): number {
  if (item.taxable_value !== undefined && item.taxable_value !== null && item.taxable_value !== '') {
    return Number(item.taxable_value) || 0;
  }
  return Number(item.quantity || 0) * Number(item.unit_price || 0) - Number(item.discount_amount || 0);
}

const money = (n: number) => n.toFixed(2);
const rate = (n: number) => String(Number(n.toFixed(2)));

/** HSN-wise tax summary, one row per HSN and tax rate, as Tally and GSTR-1 table 12 group it. */
export function buildHsnTaxSummary(items: TaxLine[]) {
  const groups = new Map<string, {
    hsn_sac: string;
    tax_rate: number;
    taxable_value: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    total_tax: number;
  }>();

  for (const item of items) {
    const hsn = String(item.hsn_sac || '').trim() || 'N/A';
    const taxRate = Number(item.tax_rate || 0);
    const key = `${hsn}|${taxRate}`;
    const g = groups.get(key) || {
      hsn_sac: hsn, tax_rate: taxRate, taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_tax: 0,
    };
    g.taxable_value += taxableValueOf(item);
    g.cgst_amount += Number(item.cgst_amount || 0);
    g.sgst_amount += Number(item.sgst_amount || 0);
    g.igst_amount += Number(item.igst_amount || 0);
    g.total_tax += Number(item.tax_amount || 0);
    groups.set(key, g);
  }

  const totals = { taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_tax: 0 };
  const rows = Array.from(groups.values()).map((g) => {
    totals.taxable_value += g.taxable_value;
    totals.cgst_amount += g.cgst_amount;
    totals.sgst_amount += g.sgst_amount;
    totals.igst_amount += g.igst_amount;
    totals.total_tax += g.total_tax;
    return {
      hsn_sac: g.hsn_sac,
      tax_rate: rate(g.tax_rate),
      taxable_value: money(g.taxable_value),
      cgst_rate: rate(g.tax_rate / 2),
      cgst_amount: money(g.cgst_amount),
      sgst_rate: rate(g.tax_rate / 2),
      sgst_amount: money(g.sgst_amount),
      igst_rate: rate(g.tax_rate),
      igst_amount: money(g.igst_amount),
      total_tax: money(g.total_tax),
    };
  });

  return {
    rows,
    totals: {
      taxable_value: money(totals.taxable_value),
      cgst_amount: money(totals.cgst_amount),
      sgst_amount: money(totals.sgst_amount),
      igst_amount: money(totals.igst_amount),
      total_tax: money(totals.total_tax),
    },
  };
}

/** Reads a `?copy=` query value: original, duplicate, triplicate or all. */
export function parsePrintCopyParam(value: string | null | undefined): PrintCopy | 'all' | undefined {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'all') return 'all';
  if (v === 'original' || v === 'duplicate' || v === 'triplicate') return v;
  return undefined;
}
