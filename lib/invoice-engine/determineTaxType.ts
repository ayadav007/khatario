import { getStateCode } from './getStateCode';

export interface TaxTypeContext {
  businessStateCode?: string;
  businessState?: string;
  placeOfSupply?: string;
  isExport: boolean;
  exportType?: 'wop' | 'with_payment';
  documentType: 'tax_invoice' | 'proforma_invoice' | 'bill_of_supply' | 'credit_note' | 'debit_note' | 'delivery_challan' | 'sales_order' | 'purchase_order';
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
  const isIntraState = !!businessStateCode && !!posStateCode && businessStateCode === posStateCode;
  const isNonTaxable = context.documentType === 'bill_of_supply';
  
  // Export invoices always use IGST (unless LUT/wop which is 0%)
  const isIGST = context.isExport || !isIntraState;
  const useCGSTSGST = !isNonTaxable && !context.isExport && isIntraState;
  
  return {
    isNonTaxable,
    isIntraState,
    isIGST,
    useCGSTSGST
  };
}

