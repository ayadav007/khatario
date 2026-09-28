import { checkGstin } from '@/lib/tax/gstin';
import { gstRateError } from '@/lib/gst/rates';
import { hsnRuleError } from '@/lib/gst/hsn-rules';

export interface ComplianceLine {
  item_name?: string | null;
  hsn_sac?: string | null;
  tax_rate?: unknown;
  /** Catalogue HSN used when the line leaves it blank (the insert falls back to it too). */
  master_hsn_sac?: string | null;
}

export interface InvoiceComplianceInput {
  lines: ComplianceLine[];
  invoiceDate: string | null | undefined;
  status: string;
  documentType: string;
  customerGstin: string | null | undefined;
  /** Billing state of an unregistered customer; used when no place of supply is given. */
  customerStateCode?: string | null;
  /** State of the issuing registration; an over-the-counter B2C sale is supplied there. */
  supplierStateCode?: string | null;
  placeOfSupply: string | null | undefined;
  isExport: boolean;
  turnoverAbove5Cr: boolean;
  /** Bill-to / ship-to: goods delivered to a state other than the buyer's registration. */
  allowPosDifferentFromGstin?: boolean;
  today?: string;
}

export type InvoiceComplianceResult =
  | { ok: true; placeOfSupply: string | null; isB2B: boolean; warnings: string[] }
  | { ok: false; error: string; code: string };

const TAX_DOCUMENTS = new Set(['tax_invoice', 'invoice', 'bill_of_supply']);

function istToday(): string {
  const now = new Date(Date.now() + 330 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export function checkInvoiceCompliance(input: InvoiceComplianceInput): InvoiceComplianceResult {
  const warnings: string[] = [];
  const invoiceDay = input.invoiceDate ? String(input.invoiceDate).slice(0, 10) : null;
  const today = input.today ?? istToday();

  const gstinCheck = input.customerGstin ? checkGstin(input.customerGstin) : null;
  const isB2B = !!(input.customerGstin && String(input.customerGstin).trim());
  const zeroRatedPos = input.placeOfSupply === '96' || input.placeOfSupply === '97';
  let placeOfSupply = input.placeOfSupply ? String(input.placeOfSupply).slice(0, 2) : null;

  if (gstinCheck?.valid && !input.isExport && !zeroRatedPos) {
    const gstinState = gstinCheck.stateCode;
    if (!placeOfSupply) {
      placeOfSupply = gstinState;
    } else if (placeOfSupply !== gstinState && !input.allowPosDifferentFromGstin) {
      return {
        ok: false,
        code: 'POS_GSTIN_MISMATCH',
        error:
          `Place of supply ${placeOfSupply} does not match the customer's GSTIN state ${gstinState}. ` +
          'For a registered buyer the place of supply is the GSTIN state unless goods are shipped elsewhere.',
      };
    }
  }

  if (!placeOfSupply && !input.isExport) {
    placeOfSupply = input.customerStateCode?.trim()
      ? input.customerStateCode.trim().padStart(2, '0')
      : input.supplierStateCode?.trim() || null;
  }

  for (const line of input.lines) {
    const rateError = gstRateError(line.tax_rate ?? 0, invoiceDay);
    if (rateError) {
      return { ok: false, code: 'INVALID_GST_RATE', error: `${line.item_name || 'Line'}: ${rateError}` };
    }
  }

  const isFinalTaxDoc = input.status === 'final' && TAX_DOCUMENTS.has(input.documentType);
  if (isFinalTaxDoc) {
    for (const line of input.lines) {
      const hsn = (line.hsn_sac && String(line.hsn_sac).trim()) || line.master_hsn_sac || null;
      const err = hsnRuleError({ hsn, isB2B, turnoverAbove5Cr: input.turnoverAbove5Cr });
      if (err) {
        return { ok: false, code: 'HSN_RULE', error: `${line.item_name || 'Line'}: ${err}` };
      }
    }
  }

  if (invoiceDay && invoiceDay > today) {
    warnings.push(
      `Invoice is dated ${invoiceDay}, after today (${today}). Tax is due on the actual date of supply; check the date before filing.`,
    );
  }

  return { ok: true, placeOfSupply, isB2B, warnings };
}
