const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const q3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export class PurchaseReturnValidationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PurchaseReturnValidationError';
  }
}

export type BillLine = {
  item_id: string | null;
  item_name: string | null;
  hsn_sac: string | null;
  unit: string | null;
  quantity: number;
  taxable_value: number;
  tax_rate: number;
  igst_amount: number;
};

export type ReturnRequestLine = {
  item_id?: string | null;
  item_name?: string | null;
  description?: string | null;
  hsn_sac?: string | null;
  unit?: string | null;
  qty?: number | string;
  quantity?: number | string;
  unit_price?: number | string;
  discount_amount?: number | string;
  tax_rate?: number | string;
};

export type ComputedReturnLine = {
  item_id: string | null;
  description: string;
  hsn_sac: string | null;
  unit: string;
  qty: number;
  unit_price: number;
  taxable_value: number;
  tax_rate: number;
  tax_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
};

export type ReturnTotals = {
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  tax_total: number;
  grand_total: number;
};

function lineKey(itemId: string | null | undefined, name: string | null | undefined): string {
  return itemId ? `id:${itemId}` : `name:${String(name || '').trim().toLowerCase()}`;
}

function taxSplit(taxable: number, rate: number, interState: boolean) {
  const tax = r2((taxable * rate) / 100);
  if (interState) return { tax, igst: tax, cgst: 0, sgst: 0 };
  const cgst = r2(tax / 2);
  return { tax, igst: 0, cgst, sgst: r2(tax - cgst) };
}

function finish(lines: ComputedReturnLine[], roundOff: number): { lines: ComputedReturnLine[]; totals: ReturnTotals } {
  const t = lines.reduce(
    (a, l) => ({
      subtotal: a.subtotal + l.taxable_value,
      cgst: a.cgst + l.cgst_amount,
      sgst: a.sgst + l.sgst_amount,
      igst: a.igst + l.igst_amount,
    }),
    { subtotal: 0, cgst: 0, sgst: 0, igst: 0 }
  );
  const tax = r2(t.cgst + t.sgst + t.igst);
  const ro = Math.abs(roundOff) < 1 ? r2(roundOff) : 0;
  return {
    lines,
    totals: {
      subtotal: r2(t.subtotal),
      cgst_total: r2(t.cgst),
      sgst_total: r2(t.sgst),
      igst_total: r2(t.igst),
      tax_total: tax,
      grand_total: r2(t.subtotal + tax + ro),
    },
  };
}

/**
 * Return lines against a bill: quantity is capped at purchased minus already returned, and value
 * and GST come from the bill line (its net cost, rate and IGST vs CGST+SGST), never from the client.
 */
export function buildReturnLinesFromBill(p: {
  billLines: BillLine[];
  requested: ReturnRequestLine[];
  alreadyReturned: Map<string, number>;
  roundOff?: number;
}): { lines: ComputedReturnLine[]; totals: ReturnTotals } {
  const byKey = new Map<string, { qty: number; taxable: number; rate: number; inter: boolean; line: BillLine }>();
  for (const b of p.billLines) {
    const k = lineKey(b.item_id, b.item_name);
    const cur = byKey.get(k);
    if (cur) {
      cur.qty += Number(b.quantity) || 0;
      cur.taxable += Number(b.taxable_value) || 0;
      cur.inter = cur.inter || Number(b.igst_amount) > 0;
    } else {
      byKey.set(k, {
        qty: Number(b.quantity) || 0,
        taxable: Number(b.taxable_value) || 0,
        rate: Number(b.tax_rate) || 0,
        inter: Number(b.igst_amount) > 0,
        line: b,
      });
    }
  }

  const requestedQty = new Map<string, number>();
  const lines: ComputedReturnLine[] = [];
  for (const req of p.requested) {
    const qty = q3(Number(req.qty ?? req.quantity) || 0);
    if (!(qty > 0)) continue;
    const k = lineKey(req.item_id, req.item_name || req.description);
    const bill = byKey.get(k);
    if (!bill) {
      throw new PurchaseReturnValidationError(
        `"${req.item_name || req.description || req.item_id}" is not on the original bill`,
        'RETURN_ITEM_NOT_ON_BILL',
        { item_id: req.item_id ?? null }
      );
    }
    const total = q3((requestedQty.get(k) || 0) + qty);
    const available = q3(bill.qty - (p.alreadyReturned.get(k) || 0));
    if (total > available + 1e-9) {
      throw new PurchaseReturnValidationError(
        `Cannot return ${total} of "${bill.line.item_name}": purchased ${bill.qty}, available to return ${Math.max(0, available)}`,
        'RETURN_EXCEEDS_PURCHASED',
        { item_id: bill.line.item_id, purchased: bill.qty, available: Math.max(0, available), requested: total }
      );
    }
    requestedQty.set(k, total);

    const unitCost = bill.qty > 0 ? bill.taxable / bill.qty : 0;
    const taxable = r2(unitCost * qty);
    const split = taxSplit(taxable, bill.rate, bill.inter);
    lines.push({
      item_id: bill.line.item_id,
      description: String(req.description || bill.line.item_name || ''),
      hsn_sac: bill.line.hsn_sac,
      unit: bill.line.unit || req.unit || 'PCS',
      qty,
      unit_price: r2(unitCost),
      taxable_value: taxable,
      tax_rate: bill.rate,
      tax_amount: split.tax,
      cgst_amount: split.cgst,
      sgst_amount: split.sgst,
      igst_amount: split.igst,
      line_total: r2(taxable + split.tax),
    });
  }
  if (lines.length === 0) {
    throw new PurchaseReturnValidationError('Enter a quantity to return on at least one line', 'RETURN_EMPTY');
  }
  return finish(lines, p.roundOff ?? 0);
}

/** Return without a linked bill: GST recomputed from the rate and the supplier's state. */
export function buildStandaloneReturnLines(p: {
  requested: ReturnRequestLine[];
  interState: boolean;
  roundOff?: number;
}): { lines: ComputedReturnLine[]; totals: ReturnTotals } {
  const lines: ComputedReturnLine[] = [];
  for (const req of p.requested) {
    const qty = q3(Number(req.qty ?? req.quantity) || 0);
    if (!(qty > 0)) continue;
    const unitPrice = r2(Number(req.unit_price) || 0);
    const taxable = r2(Math.max(0, unitPrice * qty - (Number(req.discount_amount) || 0)));
    const rate = Number(req.tax_rate) || 0;
    const split = taxSplit(taxable, rate, p.interState);
    lines.push({
      item_id: req.item_id || null,
      description: String(req.description || req.item_name || ''),
      hsn_sac: req.hsn_sac || null,
      unit: req.unit || 'PCS',
      qty,
      unit_price: unitPrice,
      taxable_value: taxable,
      tax_rate: rate,
      tax_amount: split.tax,
      cgst_amount: split.cgst,
      sgst_amount: split.sgst,
      igst_amount: split.igst,
      line_total: r2(taxable + split.tax),
    });
  }
  if (lines.length === 0) {
    throw new PurchaseReturnValidationError('Enter a quantity to return on at least one line', 'RETURN_EMPTY');
  }
  return finish(lines, p.roundOff ?? 0);
}

export { lineKey as purchaseReturnLineKey };
