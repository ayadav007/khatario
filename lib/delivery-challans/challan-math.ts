export const CHALLAN_STATUSES = ['draft', 'sent', 'delivered', 'cancelled'] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

/** Allowed moves between statuses; delivered and cancelled are final. */
const TRANSITIONS: Record<ChallanStatus, ChallanStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from as ChallanStatus] || []).includes(to as ChallanStatus);
}

export function isChallanEditable(status: string): boolean {
  return status === 'draft' || status === 'sent';
}

/** Consignment value above which goods need an e-way bill to move (CGST Rule 138). */
export const EWAY_BILL_THRESHOLD = 50000;

export interface ChallanLineInput {
  item_id?: string | null;
  item_name?: string;
  name?: string;
  description?: string | null;
  hsn_sac?: string | null;
  qty?: number | string;
  quantity?: number | string;
  unit?: string | null;
  unit_price?: number | string;
  tax_rate?: number | string;
}

export interface ChallanLine {
  item_id: string | null;
  item_name: string;
  description: string | null;
  hsn_sac: string | null;
  qty: number;
  unit: string;
  unit_price: number;
  tax_rate: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  tax_amount: number;
  line_total: number;
}

export interface ChallanTotals {
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  tax_total: number;
  grand_total: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Value and GST per line. `chargeTax` is false for composition / unregistered suppliers,
 * who cannot show tax on any document.
 */
export function computeChallanLines(
  input: ChallanLineInput[],
  opts: { interState: boolean; chargeTax: boolean }
): { lines: ChallanLine[]; totals: ChallanTotals } {
  const lines: ChallanLine[] = input
    .map((it) => {
      const qty = num(it.qty ?? it.quantity);
      const unitPrice = Math.max(0, num(it.unit_price));
      const taxRate = opts.chargeTax ? Math.max(0, num(it.tax_rate)) : 0;
      const taxable = r2(qty * unitPrice);
      const tax = r2((taxable * taxRate) / 100);
      const cgst = opts.interState ? 0 : r2(tax / 2);
      const sgst = opts.interState ? 0 : r2(tax - cgst);
      const igst = opts.interState ? tax : 0;
      return {
        item_id: it.item_id || null,
        item_name: String(it.item_name || it.name || it.description || '').trim(),
        description: it.description || null,
        hsn_sac: it.hsn_sac || null,
        qty,
        unit: it.unit || 'PCS',
        unit_price: unitPrice,
        tax_rate: taxRate,
        taxable_value: taxable,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: igst,
        tax_amount: tax,
        line_total: r2(taxable + tax),
      };
    })
    .filter((l) => l.item_name && l.qty > 0);

  const sum = (k: keyof ChallanLine) => r2(lines.reduce((s, l) => s + (l[k] as number), 0));
  const subtotal = sum('taxable_value');
  const tax_total = sum('tax_amount');
  return {
    lines,
    totals: {
      subtotal,
      cgst_total: sum('cgst_amount'),
      sgst_total: sum('sgst_amount'),
      igst_total: sum('igst_amount'),
      tax_total,
      grand_total: r2(subtotal + tax_total),
    },
  };
}
