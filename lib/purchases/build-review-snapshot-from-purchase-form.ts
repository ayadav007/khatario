import type { Supplier } from '@/types/database';
import { getStateCode, INDIAN_STATES } from '@/lib/gst-utils';
import type { PurchaseDocumentTotals } from '@/lib/purchase-gst-calculator';
import { round2 } from '@/lib/numeric-precision';

export interface PurchaseItemLike {
  item_name: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  discount_amount?: number;
  discount_on_tax_inclusive?: boolean;
  tax_rate: number;
  hsn_sac: string;
  invoice_inclusive_line_total?: number;
}

/** Human-facing state name from 2-letter code (Indian GST). */
function placeOfSupplyLabel(code: string | undefined): string {
  const c = (code || '').trim().slice(0, 2);
  if (!c) return '';
  const found = INDIAN_STATES.find((state) => getStateCode(state) === c);
  return found ?? '';
}

/**
 * Builds purchase-review-shaped JSON for extraction learning deltas (supplier / invoice / items / totals).
 */
export function buildReviewSnapshotFromPurchaseForm(params: {
  formData: {
    bill_number: string;
    bill_date: string;
    place_of_supply_state_code: string;
    is_reverse_charge: boolean;
    document_type?: string;
    supplier_gstin: string;
    supplier_state_code: string;
    round_off: number;
  };
  supplierSearch: string;
  selectedSupplier: Supplier | null;
  purchaseItems: PurchaseItemLike[];
  purchaseGstDoc: PurchaseDocumentTotals | null;
  computedGrandTotal: number;
  /** Preserve optional supplier fields visible on extract payloads */
  extraSupplierSnapshot?: Record<string, unknown> | null;
}): {
  supplier: Record<string, unknown>;
  invoice: Record<string, unknown>;
  items: Record<string, unknown>[];
  totals: Record<string, unknown>;
} {
  const gstin = (
    params.selectedSupplier?.gstin ||
    params.formData.supplier_gstin ||
    ''
  )
    .toString()
    .trim()
    .toUpperCase();
  const sc =
    (params.selectedSupplier?.state_code &&
      String(params.selectedSupplier.state_code).trim().slice(0, 2)) ||
    (params.formData.supplier_state_code || '').trim().slice(0, 2);

  const name =
    params.selectedSupplier?.name?.trim() ||
    params.supplierSearch.trim() ||
    '';

  const extra = params.extraSupplierSnapshot || {};
  const supplier: Record<string, unknown> = {
    ...extra,
    name,
    gstin: gstin || null,
    state_code: sc || extra.state_code || null,
    phone:
      params.selectedSupplier?.phone != null
        ? String(params.selectedSupplier.phone)
        : extra.phone ?? null,
    email:
      params.selectedSupplier?.email != null
        ? String(params.selectedSupplier.email)
        : extra.email ?? null,
    address:
      params.selectedSupplier?.address != null
        ? String(params.selectedSupplier.address)
        : extra.address ?? null,
  };

  const posLabel = placeOfSupplyLabel(params.formData.place_of_supply_state_code);

  const invoice: Record<string, unknown> = {
    bill_number: params.formData.bill_number?.trim() || null,
    bill_date: params.formData.bill_date?.trim() || null,
    document_type: params.formData.document_type ?? null,
    invoice_number: params.formData.bill_number?.trim() || null,
    invoice_date: params.formData.bill_date?.trim() || null,
    due_date: null,
    place_of_supply: posLabel || params.formData.place_of_supply_state_code?.trim().slice(0, 2) || '',
    place_of_supply_state_code: params.formData.place_of_supply_state_code?.trim().slice(0, 2) || null,
    reverse_charge: params.formData.is_reverse_charge === true,
  };

  const doc = params.purchaseGstDoc;
  const items = params.purchaseItems.map((pi, idx) => {
    const lc = doc?.lineComputeds[idx];
    const inclusive =
      pi.invoice_inclusive_line_total != null && Number.isFinite(pi.invoice_inclusive_line_total)
        ? round2(Number(pi.invoice_inclusive_line_total))
        : lc != null
          ? round2(lc.lineTotal)
          : 0;
    return {
      item_name: pi.item_name,
      quantity: pi.quantity,
      unit_price: pi.unit_price,
      amount: inclusive,
      tax_rate: pi.tax_rate,
      hsn_sac: pi.hsn_sac,
      discount_percent: pi.discount_percent ?? 0,
      discount_amount: pi.discount_amount ?? 0,
      discount_on_tax_inclusive: pi.discount_on_tax_inclusive === true,
    };
  });

  const d = doc;
  const totals: Record<string, unknown> = {
    subtotal: d ? round2(d.subtotal) : 0,
    tax_amount: d ? round2(d.taxTotal) : 0,
    grand_total: round2(params.computedGrandTotal),
    cgst_total: d ? round2(d.cgstTotal) : 0,
    sgst_total: d ? round2(d.sgstTotal) : 0,
    igst_total: d ? round2(d.igstTotal) : 0,
    round_off: round2(Number(params.formData.round_off) || 0),
  };

  return { supplier, invoice, items, totals };
}
