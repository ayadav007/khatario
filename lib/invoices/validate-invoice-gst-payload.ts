import type { CreateInvoiceInput } from '@/lib/invoices/invoice-create-service';
import {
  authoritativeInvoiceTotals,
  InvoiceChargeError,
  type AuthoritativeInvoiceTotals,
  type InvoiceChargeInput,
} from '@/lib/invoices/invoice-charges';
import { isZeroRatedWithoutTax } from '@/lib/invoices/line-gst';

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
): AuthoritativeInvoiceTotals {
  const items = body.items ?? [];
  const placeOfSupply = body.place_of_supply_state_code || businessStateCode;
  const intraState = !!(placeOfSupply && businessStateCode && placeOfSupply === businessStateCode);
  const exportFields = body as CreateInvoiceInput & {
    is_export?: boolean | null;
    supply_type?: string | null;
    export_type?: string | null;
    lut_declaration?: boolean | null;
  };
  const zeroRated =
    body.document_type === 'bill_of_supply' ||
    isZeroRatedWithoutTax({
      is_export: exportFields.is_export,
      supply_type: exportFields.supply_type,
      export_type: exportFields.export_type,
      lut_declaration: exportFields.lut_declaration,
      place_of_supply_state_code: body.place_of_supply_state_code,
    });
  const totals = authoritativeInvoiceTotals({
    items,
    charges: (body as CreateInvoiceInput & { charges?: InvoiceChargeInput[] }).charges,
    additionalCharges: body.additional_charges,
    intraState,
    zeroRated,
    pricesIncludeGst: body.prices_include_gst === true,
    documentDate: body.invoice_date,
    roundOff: body.round_off,
    enableRoundOff: body.enable_round_off,
  });

  return totals;
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
  let totals: ReturnType<typeof computeInvoiceTotals>;
  try {
    totals = computeInvoiceTotals(body, businessStateCode);
  } catch (error) {
    if (error instanceof InvoiceChargeError) {
      return {
        ok: false,
        reason: error.message,
        serverTotals: {
          itemSubtotal: 0,
          goodsTaxable: 0,
          subtotal: 0,
          discountTotal: 0,
          taxTotal: 0,
          cgstTotal: 0,
          sgstTotal: 0,
          igstTotal: 0,
          additionalCharges: 0,
          chargesIncluded: false,
          roundOff: 0,
          grandTotal: 0,
          lines: [],
          separateLines: [],
          charges: [],
        },
        clientTotals: {
          subtotal: body.subtotal,
          tax_total: body.tax_total,
          grand_total: body.grand_total,
        },
      };
    }
    throw error;
  }

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
