import type { CreateInvoiceInput } from '@/lib/invoices/invoice-create-service';

const GST_TOLERANCE = 0.05;

const STATE_NAME_MAP: Record<string, string> = {
  'andhra pradesh': '37',
  karnataka: '29',
  'tamil nadu': '33',
  maharashtra: '27',
  gujarat: '24',
  rajasthan: '08',
  'uttar pradesh': '09',
  'west bengal': '19',
  delhi: '07',
  telangana: '36',
};

function getStateCode(stateName: string): string {
  if (!stateName) return '';
  return STATE_NAME_MAP[stateName.trim().toLowerCase()] || '';
}

export function computeInvoiceTotals(
  body: CreateInvoiceInput,
  businessStateCode: string
): {
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  grandTotal: number;
  roundOff: number;
} {
  const items = body.items ?? [];
  const placeOfSupply = body.place_of_supply_state_code || businessStateCode;
  let subtotal = 0;
  let taxTotal = 0;
  let discountTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const itemSubtotal = qty * unitPrice;
    const itemDiscount = (itemSubtotal * (Number(item.discount_percent) || 0)) / 100;
    const taxable = itemSubtotal - itemDiscount;
    const taxRate = Number(item.tax_rate) || 0;

    let taxAmount = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (placeOfSupply && businessStateCode && placeOfSupply === businessStateCode) {
      const half = taxRate / 2;
      cgst = (taxable * half) / 100;
      sgst = (taxable * half) / 100;
      taxAmount = cgst + sgst;
    } else {
      igst = (taxable * taxRate) / 100;
      taxAmount = igst;
    }

    subtotal += taxable;
    discountTotal += itemDiscount;
    taxTotal += taxAmount;
    cgstTotal += cgst;
    sgstTotal += sgst;
    igstTotal += igst;
  }

  const additional = Number(body.additional_charges) || 0;
  const grandTotalRaw = subtotal + taxTotal + additional;
  let roundOff = Number(body.round_off) || 0;
  if (body.enable_round_off && !body.round_off) {
    roundOff = Math.round(grandTotalRaw) - grandTotalRaw;
  }
  const grandTotal = grandTotalRaw + roundOff;

  return {
    subtotal,
    taxTotal,
    discountTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    grandTotal,
    roundOff,
  };
}

/** Server-side GST reconciliation for offline sales payloads. */
export function validateInvoiceGstPayload(
  body: CreateInvoiceInput,
  businessStateCode: string
): {
  ok: true;
  totals: ReturnType<typeof computeInvoiceTotals>;
} | {
  ok: false;
  reason: string;
  serverTotals: ReturnType<typeof computeInvoiceTotals>;
  clientTotals: {
    subtotal?: number;
    tax_total?: number;
    grand_total?: number;
  };
} {
  const totals = computeInvoiceTotals(body, businessStateCode);

  const mismatch =
    (body.subtotal !== undefined &&
      Math.abs(body.subtotal - totals.subtotal) > GST_TOLERANCE) ||
    (body.tax_total !== undefined &&
      Math.abs(body.tax_total - totals.taxTotal) > GST_TOLERANCE) ||
    (body.grand_total !== undefined &&
      Math.abs(body.grand_total - totals.grandTotal) > GST_TOLERANCE);

  if (mismatch) {
    return {
      ok: false,
      reason: 'Client GST totals do not match server recomputation',
      serverTotals: totals,
      clientTotals: {
        subtotal: body.subtotal,
        tax_total: body.tax_total,
        grand_total: body.grand_total,
      },
    };
  }

  return { ok: true, totals };
}

export { getStateCode, GST_TOLERANCE };
