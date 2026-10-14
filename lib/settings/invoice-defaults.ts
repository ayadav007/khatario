/**
 * Defaults filled in on every new bill (and the low-stock level on new items). The bill can still
 * change each value. Client-safe: no server imports.
 */

export interface InvoiceDefaults {
  /** Days after the bill date; 0 = due on receipt, null = no due date. */
  dueDays: number | null;
  pricesIncludeGst: boolean;
  roundOff: boolean;
  /** Decimal places shown and accepted for quantities (fabric by the metre needs 2). */
  quantityDecimals: number;
  notes: string;
  terms: string;
  /** Low-stock alert level for new items, in the item's own unit; null = none. */
  lowStockAlert: number | null;
}

export const DEFAULT_INVOICE_DEFAULTS: InvoiceDefaults = {
  dueDays: null,
  pricesIncludeGst: false,
  roundOff: false,
  quantityDecimals: 2,
  notes: '',
  terms: '',
  lowStockAlert: null,
};

const clipText = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function sanitizeInvoiceDefaults(raw: unknown): InvoiceDefaults {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const due = r.dueDays === null || r.dueDays === '' ? null : Number(r.dueDays);
  const dec = Number(r.quantityDecimals);
  const low = r.lowStockAlert === null || r.lowStockAlert === '' ? null : Number(r.lowStockAlert);
  return {
    dueDays: due === null || !Number.isFinite(due) ? null : Math.min(365, Math.max(0, Math.round(due))),
    pricesIncludeGst: r.pricesIncludeGst === true,
    roundOff: r.roundOff === true,
    quantityDecimals: Number.isFinite(dec) && dec >= 0 && dec <= 3 ? Math.round(dec) : 2,
    notes: clipText(r.notes, 1000),
    terms: clipText(r.terms, 2000),
    lowStockAlert: low === null || !Number.isFinite(low) || low < 0 ? null : Math.round(low * 1000) / 1000,
  };
}
