/**
 * Client-safe correction deltas for extraction learning (no Node APIs).
 * Compare purchase-review shaped payloads (`data.supplier`, `data.invoice`, `data.items`, `data.totals`).
 */

export interface InvoiceCorrectionSummary {
  accept_kind: 'clean' | 'edited';
  supplier_field_changes: number;
  invoice_field_changes: number;
  items_rows_changed: number;
  /** Counts per item field key when values differ */
  item_field_changes: Record<string, number>;
  totals_changed: boolean;
}

function normPrimitive(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v))
    return String(Math.round(v * 10000) / 10000);
  return String(v).trim();
}

function shallowDiffCount(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
  keys: string[]
): number {
  let n = 0;
  for (const k of keys) {
    if (normPrimitive(a?.[k]) !== normPrimitive(b?.[k])) n++;
  }
  return n;
}

const SUP_KEYS = ['name', 'gstin', 'address', 'state_code', 'phone', 'email'] as const;
const INV_KEYS = [
  'invoice_number',
  'invoice_date',
  'due_date',
  'place_of_supply',
  'reverse_charge',
] as const;

const ITEM_KEYS = [
  'item_name',
  'quantity',
  'unit_price',
  'amount',
  'tax_rate',
  'hsn_sac',
  'discount_percent',
  'discount_amount',
  'discount_on_tax_inclusive',
] as const;

const TOTAL_KEYS = [
  'subtotal',
  'tax_amount',
  'grand_total',
  'cgst_total',
  'sgst_total',
  'igst_total',
  'round_off',
] as const;

/**
 * Summarize how much the user changed extracted invoice JSON before accepting.
 */
export function summarizeInvoiceCorrectionDelta(
  before: { supplier?: unknown; invoice?: unknown; items?: unknown; totals?: unknown } | null | undefined,
  after: { supplier?: unknown; invoice?: unknown; items?: unknown; totals?: unknown } | null | undefined
): InvoiceCorrectionSummary {
  const bs = (before?.supplier ?? {}) as Record<string, unknown>;
  const as = (after?.supplier ?? {}) as Record<string, unknown>;
  const bi = (before?.invoice ?? {}) as Record<string, unknown>;
  const ai = (after?.invoice ?? {}) as Record<string, unknown>;
  const bt = (before?.totals ?? {}) as Record<string, unknown>;
  const at = (after?.totals ?? {}) as Record<string, unknown>;

  const supplier_field_changes = shallowDiffCount(bs, as, [...SUP_KEYS]);
  const invoice_field_changes = shallowDiffCount(bi, ai, [...INV_KEYS]);

  const totals_changed = shallowDiffCount(bt, at, [...TOTAL_KEYS]) > 0;

  const bItems = Array.isArray(before?.items) ? before!.items : [];
  const aItems = Array.isArray(after?.items) ? after!.items : [];

  const item_field_changes: Record<string, number> = {};
  const bump = (k: string) => {
    item_field_changes[k] = (item_field_changes[k] ?? 0) + 1;
  };

  let items_rows_changed = 0;
  const n = Math.max(bItems.length, aItems.length);
  for (let i = 0; i < n; i++) {
    const rowB = (bItems[i] ?? {}) as Record<string, unknown>;
    const rowA = (aItems[i] ?? {}) as Record<string, unknown>;
    let rowDiff = false;
    for (const k of ITEM_KEYS) {
      if (normPrimitive(rowB[k]) !== normPrimitive(rowA[k])) {
        bump(k);
        rowDiff = true;
      }
    }
    if (rowDiff) items_rows_changed++;
  }

  const edited =
    supplier_field_changes +
      invoice_field_changes +
      items_rows_changed +
      (totals_changed ? 1 : 0) >
    0;

  return {
    accept_kind: edited ? 'edited' : 'clean',
    supplier_field_changes,
    invoice_field_changes,
    items_rows_changed,
    item_field_changes,
    totals_changed,
  };
}
