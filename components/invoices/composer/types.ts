import type { InvoiceItemRow } from '@/lib/invoice-engine/calculateRow';

export type ComposerDocType = 'tax_invoice' | 'proforma_invoice' | 'bill_of_supply';

/** Rows on the invoice page carry a couple of display-only extras on top of the engine row. */
export type ComposerRow = InvoiceItemRow & { code?: string; mrp?: number };

export type ComposerPayment = {
  id: string;
  amount: number;
  mode: string;
  date: string;
  reference: string;
};

export type ComposerCharge = { id: string; purpose: string; amount: number };

export type ComposerAttachment = { id: string; name: string; url: string; size?: number };

export type ComposerExportState = {
  exportType: 'wp' | 'wop';
  portCode: string;
  shippingBillNumber: string;
  shippingBillDate: string;
  invoiceCurrency: string;
  exchangeRate: number | '';
  countryOfOrigin: string;
  portOfLoading: string;
  portOfDischarge: string;
  placeOfDelivery: string;
  incoterms: string;
  transportMode: string;
  awbNumber: string;
  blNumber: string;
  buyerTaxId: string;
};

export type ComposerMoreDetails = {
  purchaseOrderNumber: string;
  purchaseOrderDate: string;
  ewayBillNumber: string;
  ewayBillDate: string;
  referenceNumber: string;
  deliveryNote: string;
  paymentTerms: string;
  otherReferences: string;
  dispatchedThrough: string;
  destination: string;
  termsOfDelivery: string;
};

export type ComposerTotals = {
  itemSubtotal: number;
  totalDiscount: number;
  taxableAmount: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  totalTax: number;
  totalExtraCharges: number;
  roundOff: number;
  grandTotal: number;
};

export type PickerItem = {
  id: string;
  name: string;
  code?: string;
  barcode?: string;
  selling_price?: number;
  purchase_price?: number;
  tax_rate?: number;
  hsn_sac?: string;
  unit?: string;
  gst_included?: boolean;
  current_stock?: number;
  low_stock_threshold?: number;
  has_variants?: boolean;
  variants?: any[];
  variantId?: string;
  variantName?: string;
  _pickerNeedsVariant?: boolean;
};

export const rowKey = (itemId: string, variantId?: string | null) => `${itemId}::${variantId ?? ''}`;
