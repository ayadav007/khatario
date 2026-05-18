/**
 * Central source of truth for invoice types and their rules.
 */

export type DocumentType = 
  | 'tax_invoice' 
  | 'proforma_invoice' 
  | 'bill_of_supply' 
  | 'regular'
  | 'sales_order'
  | 'delivery_challan'
  | 'credit_note'
  | 'debit_note'
  | 'purchase_order'
  | 'work_order';

export interface DocumentRule {
  title: string;
  prefix: string;
  isTaxable: boolean;
  requiresGst: boolean;
  showInGstr1: boolean;
}

export const DOCUMENT_RULES: Record<string, DocumentRule> = {
  tax_invoice: {
    title: 'TAX INVOICE',
    prefix: 'INV',
    isTaxable: true,
    requiresGst: true,
    showInGstr1: true,
  },
  proforma_invoice: {
    title: 'PROFORMA INVOICE',
    prefix: 'PI',
    isTaxable: true,
    requiresGst: true,
    showInGstr1: false,
  },
  bill_of_supply: {
    title: 'BILL OF SUPPLY',
    prefix: 'BOS',
    isTaxable: false,
    requiresGst: true,
    showInGstr1: true,
  },
  regular: {
    title: 'TAX INVOICE',
    prefix: 'INV',
    isTaxable: true,
    requiresGst: true,
    showInGstr1: true,
  },
  sales_order: {
    title: 'SALES ORDER',
    prefix: 'SO',
    isTaxable: true,
    requiresGst: true,
    showInGstr1: false,
  },
  delivery_challan: {
    title: 'DELIVERY CHALLAN',
    prefix: 'DC',
    isTaxable: false,
    requiresGst: false,
    showInGstr1: false,
  },
  credit_note: {
    title: 'CREDIT NOTE',
    prefix: 'CN',
    isTaxable: true,
    requiresGst: true,
    showInGstr1: true,
  },
  debit_note: {
    title: 'DEBIT NOTE',
    prefix: 'DN',
    isTaxable: true,
    requiresGst: true,
    showInGstr1: true,
  },
  purchase_order: {
    title: 'PURCHASE ORDER',
    prefix: 'PO',
    isTaxable: true,
    requiresGst: true,
    showInGstr1: false,
  },
  work_order: {
    title: 'WORK ORDER',
    prefix: 'WO',
    isTaxable: false,
    requiresGst: false,
    showInGstr1: false,
  }
};

export const getDocumentRule = (type: string | null | undefined): DocumentRule => {
  const normalizedType = (type || 'tax_invoice') as DocumentType;
  return DOCUMENT_RULES[normalizedType] || DOCUMENT_RULES.tax_invoice;
};
