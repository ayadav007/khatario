/**
 * Compares two invoice snapshots from invoice_revisions (migration 469) and describes the change
 * in plain words for the History tab. Pure: no database access.
 */
import type { InvoiceSnapshot } from '@/types/database';

export type { InvoiceSnapshot };

export interface FieldChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface LineChange {
  kind: 'added' | 'removed' | 'changed';
  position: number;
  name: string;
  fields: FieldChange[];
}

export interface InvoiceDiff {
  header: FieldChange[];
  lines: LineChange[];
  charges: LineChange[];
}

export const INVOICE_ACTION_LABELS: Record<string, string> = {
  baseline: 'Recorded when history started',
  created: 'Created',
  draft_edited: 'Draft edited',
  finalized: 'Finalized',
  amended: 'Amended',
  cancelled: 'Cancelled',
  payment_recorded: 'Payment recorded',
  payment_reversed: 'Payment reversed',
  credit_note_applied: 'Credit note applied',
  credit_note_cancelled: 'Credit note cancelled',
  debit_note_applied: 'Debit note applied',
  debit_note_cancelled: 'Debit note cancelled',
  converted: 'Converted',
  eway_updated: 'E-way bill updated',
  restored: 'Restored',
  gstr1_locked: 'Locked by GSTR-1 filing',
  proforma_status: 'Estimate status changed',
  store_order: 'Online store order',
  item_merged: 'Item merged',
  updated: 'Updated',
};

/** Labels match the invoice form and the amend form (app/api/invoices/[id]/amend/route.ts). */
const FIELD_LABELS: Record<string, string> = {
  invoice_number: 'Invoice number',
  invoice_date: 'Invoice date',
  due_date: 'Due date',
  status: 'Status',
  document_type: 'Document type',
  customer_id: 'Customer',
  billing_name: 'Name on bill',
  billing_address: 'Billing address',
  shipping_address: 'Ship-to address',
  shipping_state: 'Ship-to state',
  place_of_supply_state_code: 'Place of supply',
  notes: 'Notes',
  payment_terms: 'Terms of payment',
  terms_of_delivery: 'Terms of delivery',
  purchase_order_number: 'PO number',
  purchase_order_date: 'PO date',
  reference_number: 'Reference number',
  eway_bill_number: 'E-way bill number',
  eway_bill_date: 'E-way bill date',
  delivery_note: 'Delivery note',
  other_references: 'Other references',
  dispatched_through: 'Dispatched through',
  destination: 'Destination',
  subtotal: 'Subtotal',
  grand_total: 'Total',
  total_tax: 'Total GST',
  amount_paid: 'Amount received',
  balance_amount: 'Balance due',
  round_off: 'Round off',
  tds_received: 'TDS received',
  is_editable: 'Locked for editing',
  estimate_status: 'Estimate status',
  branch_id: 'Branch',
  custom_fields: 'Custom fields',
  deleted_at: 'Deleted',
  prices_include_gst: 'Prices include GST',
  // Lines and charges
  item_id: 'Item',
  item_name: 'Item',
  description: 'Description',
  hsn_sac: 'HSN/SAC',
  quantity: 'Qty',
  unit: 'Unit',
  unit_price: 'Rate',
  discount_percent: 'Discount %',
  discount_amount: 'Discount',
  tax_rate: 'GST %',
  tax_amount: 'GST amount',
  taxable_value: 'Taxable value',
  cgst_amount: 'CGST',
  sgst_amount: 'SGST',
  igst_amount: 'IGST',
  line_total: 'Amount',
  amount: 'Amount',
  purpose: 'Charge',
  classification: 'Charge type',
};

/** System bookkeeping, never shown as a change. */
const IGNORED_HEADER = new Set(['id', 'business_id', 'created_at', 'created_by', 'search_vector']);
const IGNORED_ROW = new Set(['id', 'invoice_id', 'business_id', 'sort_order']);

function humanize(field: string): string {
  const text = field.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? humanize(field);
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  if (isBlank(a) || isBlank(b)) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a);
    const y = Number(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x === y;
  }
  // Snapshots come from to_jsonb, so dates always have one shape: text is compared exactly.
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function diffFields(prev: Record<string, unknown>, next: Record<string, unknown>, ignored: Set<string>): FieldChange[] {
  const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]))
    .filter((k) => !ignored.has(k))
    .sort();
  const out: FieldChange[] = [];
  for (const field of keys) {
    const before = prev[field];
    const after = next[field];
    if (!sameValue(before, after)) {
      out.push({ field, label: fieldLabel(field), before: before ?? null, after: after ?? null });
    }
  }
  return out;
}

type Row = Record<string, unknown>;

function rowName(row: Row): string {
  return String(row.item_name ?? row.purpose ?? row.description ?? '').trim() || 'Line';
}

function blankToEmpty(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Same item (and variant) with the same name: the strongest sign two rows are one line. */
function rowKey(row: Row): string {
  return `${blankToEmpty(row.item_id)}|${blankToEmpty(row.variant_id)}|${rowName(row)}`;
}

const KIND_ORDER: Record<LineChange['kind'], number> = { removed: 0, changed: 1, added: 2 };

/**
 * Pairs rows across versions by identity, not position: draft saves renumber sort_order, so
 * deleting the first line would otherwise make every later line look changed.
 * Pass 1 pairs rows with the same item, variant and name; pass 2 pairs leftover rows with the
 * same item and variant (a renamed line). Anything left is removed or added.
 */
function diffRows(prev: Row[], next: Row[]): LineChange[] {
  const out: LineChange[] = [];
  const matchedNext = new Set<number>();
  const pairOf = new Map<number, number>();

  const pair = (sameRow: (a: Row, b: Row) => boolean) => {
    prev.forEach((a, ai) => {
      if (pairOf.has(ai)) return;
      const bi = next.findIndex((b, j) => !matchedNext.has(j) && sameRow(a, b));
      if (bi >= 0) {
        pairOf.set(ai, bi);
        matchedNext.add(bi);
      }
    });
  };
  pair((a, b) => rowKey(a) === rowKey(b));
  pair(
    (a, b) =>
      blankToEmpty(a.item_id) !== '' &&
      blankToEmpty(a.item_id) === blankToEmpty(b.item_id) &&
      blankToEmpty(a.variant_id) === blankToEmpty(b.variant_id),
  );

  prev.forEach((a, ai) => {
    const bi = pairOf.get(ai);
    if (bi === undefined) {
      out.push({ kind: 'removed', position: ai, name: rowName(a), fields: [] });
      return;
    }
    const fields = diffFields(a, next[bi], IGNORED_ROW);
    if (fields.length) out.push({ kind: 'changed', position: bi, name: rowName(next[bi]), fields });
  });
  next.forEach((b, bi) => {
    if (!matchedNext.has(bi)) out.push({ kind: 'added', position: bi, name: rowName(b), fields: [] });
  });
  return out.sort((x, y) => x.position - y.position || KIND_ORDER[x.kind] - KIND_ORDER[y.kind]);
}

export function diffInvoiceSnapshots(prev: InvoiceSnapshot | null, next: InvoiceSnapshot): InvoiceDiff {
  if (!prev) return { header: [], lines: [], charges: [] };
  return {
    header: diffFields(prev.header ?? {}, next.header ?? {}, IGNORED_HEADER),
    lines: diffRows(prev.lines ?? [], next.lines ?? []),
    charges: diffRows(prev.charges ?? [], next.charges ?? []),
  };
}

export function describeRevision(action: string, diff: InvoiceDiff, invoiceNumber: string): string {
  const label = INVOICE_ACTION_LABELS[action] ?? humanize(action);
  if (action === 'baseline') return label;
  const head = invoiceNumber ? `${label} ${invoiceNumber}` : label;
  const names = diff.header.map((c) => c.label);
  if (diff.lines.length) names.push('Items');
  if (diff.charges.length) names.push('Charges');
  if (!names.length) return head;
  const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  return `${head}: ${shown}`;
}
