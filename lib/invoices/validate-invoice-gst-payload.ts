import type { CreateInvoiceInput } from '@/lib/invoices/invoice-create-service';
import { computeLineGst, isZeroRatedWithoutTax, round2 } from '@/lib/invoices/line-gst';

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
  const intraState = !!(placeOfSupply && businessStateCode && placeOfSupply === businessStateCode);
  const exportFields = body as CreateInvoiceInput & {
    is_export?: boolean | null;
    supply_type?: string | null;
    export_type?: string | null;
    lut_declaration?: boolean | null;
  };
  const zeroRated = isZeroRatedWithoutTax({
    is_export: exportFields.is_export,
    supply_type: exportFields.supply_type,
    export_type: exportFields.export_type,
    lut_declaration: exportFields.lut_declaration,
    place_of_supply_state_code: body.place_of_supply_state_code,
  });
  let subtotal = 0;
  let discountTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  for (const item of items) {
    const line = computeLineGst(item, intraState, zeroRated, body.prices_include_gst === true);
    subtotal += line.taxable;
    discountTotal += line.itemDiscount;
    cgstTotal += line.cgst;
    sgstTotal += line.sgst;
    igstTotal += line.igst;
  }
  subtotal = round2(subtotal);
  discountTotal = round2(discountTotal);
  cgstTotal = round2(cgstTotal);
  sgstTotal = round2(sgstTotal);
  igstTotal = round2(igstTotal);
  const taxTotal = round2(cgstTotal + sgstTotal + igstTotal);

  const additional = Number(body.additional_charges) || 0;
  const grandTotalRaw = round2(subtotal + taxTotal + additional);
  let roundOff = Number(body.round_off) || 0;
  if (body.enable_round_off && !body.round_off) {
    roundOff = round2(Math.round(grandTotalRaw) - grandTotalRaw);
  }
  const grandTotal = round2(grandTotalRaw + roundOff);

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
