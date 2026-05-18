import { getStateCode } from './getStateCode';
import { determineTaxType, type TaxTypeContext } from './determineTaxType';

export interface InvoiceItemRow {
  itemId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  freeQty: number;
  unit: string;
  price: number;
  discountPercent: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  hsnSac: string;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  total: number;
  /** When true, GST-inclusive catalog/party amounts are converted to taxable unit price using taxPercent */
  gstIncluded?: boolean;
  /** User edited unit price manually; do not auto-apply party-specific pricing over it */
  priceUserOverride?: boolean;
}

export interface CalculateRowContext {
  businessStateCode?: string;
  businessState?: string;
  placeOfSupply?: string;
  isExport: boolean;
  exportType?: 'wop' | 'with_payment';
  documentType: 'tax_invoice' | 'proforma_invoice' | 'bill_of_supply' | 'credit_note' | 'debit_note' | 'delivery_challan' | 'sales_order' | 'purchase_order';
}

/**
 * Calculates all values for a single invoice row
 * Pure function - no side effects
 * 
 * @param row - The invoice item row to calculate
 * @param context - Business and tax context
 * @param skipDiscountRecalc - If true, calculate discount percent from amount; if false, calculate amount from percent
 */
export function calculateRow(
  row: InvoiceItemRow,
  context: CalculateRowContext,
  skipDiscountRecalc: boolean = false
): InvoiceItemRow {
  const subtotal = row.quantity * row.price;
  let discAmt = row.discountAmount;
  let discPercent = row.discountPercent;
  
  // Calculate discount
  if (!skipDiscountRecalc) {
    // Calculate discount amount from percent
    if (subtotal > 0) {
      discAmt = (subtotal * row.discountPercent) / 100;
    } else {
      discAmt = 0;
    }
  } else {
    // Calculate discount percent from amount
    if (subtotal > 0) {
      discPercent = (row.discountAmount / subtotal) * 100;
    } else {
      discPercent = 0;
    }
  }
  
  // Ensure discount doesn't exceed subtotal
  if (discAmt > subtotal) {
    discAmt = subtotal;
    discPercent = 100;
  }
  
  const taxableAmount = subtotal - discAmt;
  
  // Determine tax type
  const taxType = determineTaxType({
    businessStateCode: context.businessStateCode,
    businessState: context.businessState,
    placeOfSupply: context.placeOfSupply,
    isExport: context.isExport,
    exportType: context.exportType,
    documentType: context.documentType
  });
  
  let cgst = 0, sgst = 0, igst = 0, taxAmt = 0;
  
  if (taxType.isNonTaxable) {
    // Bill of Supply: Force 0% tax
    cgst = 0;
    sgst = 0;
    igst = 0;
    taxAmt = 0;
  } else if (context.isExport) {
    // For export invoices, always use IGST
    if (context.exportType === 'wop') {
      // Export under LUT - IGST is 0%
      igst = 0;
      taxAmt = 0;
    } else {
      // Export with payment - IGST at applicable rate
      igst = taxableAmount * row.taxPercent / 100;
      taxAmt = igst;
    }
  } else if (taxType.useCGSTSGST) {
    // Intra-state: CGST + SGST
    cgst = taxableAmount * (row.taxPercent / 2) / 100;
    sgst = taxableAmount * (row.taxPercent / 2) / 100;
    taxAmt = cgst + sgst;
  } else {
    // Inter-state: IGST
    igst = taxableAmount * row.taxPercent / 100;
    taxAmt = igst;
  }
  
  return {
    ...row,
    taxPercent: taxType.isNonTaxable ? 0 : row.taxPercent,
    discountPercent: discPercent,
    discountAmount: discAmt,
    taxableValue: taxableAmount,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    taxAmount: taxAmt,
    total: taxableAmount + taxAmt
  };
}

