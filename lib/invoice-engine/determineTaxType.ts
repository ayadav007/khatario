import { getStateCode } from './getStateCode';

export interface TaxTypeContext {
  businessStateCode?: string;
  businessState?: string;
  placeOfSupply?: string;
  isExport: boolean;
  exportType?: 'wop' | 'with_payment';
  documentType: 'tax_invoice' | 'proforma_invoice' | 'bill_of_supply' | 'credit_note' | 'debit_note' | 'delivery_challan' | 'sales_order' | 'purchase_order';
  /** SEZ is always inter-state. Exempt charges no GST. */
  supplyKind?: 'taxable' | 'exempt' | 'export' | 'sez';
}

export interface TaxTypeResult {
  isNonTaxable: boolean;
  isIntraState: boolean;
  isIGST: boolean;
  useCGSTSGST: boolean;
}

/**
 * Determines tax type based on business context
 * Pure function - no side effects
 */
export function determineTaxType(context: TaxTypeContext): TaxTypeResult {
  const businessStateCode = context.businessStateCode || getStateCode(context.businessState || '');
  const posStateCode = getStateCode(context.placeOfSupply || '');
  const sez = context.supplyKind === 'sez';
  const isIntraState = !sez && !!businessStateCode && !!posStateCode && businessStateCode === posStateCode;
  const isNonTaxable = context.documentType === 'bill_of_supply' || context.supplyKind === 'exempt';

  // Export and SEZ always use IGST (LUT / without payment is 0% in the row calculator).
  const isIGST = context.isExport || sez || !isIntraState;
  const useCGSTSGST = !isNonTaxable && !context.isExport && !sez && isIntraState;
  
  return {
    isNonTaxable,
    isIntraState,
    isIGST,
    useCGSTSGST
  };
}

