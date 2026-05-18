/** Mirrors `Gstr13bReconciliationResult` from `@/lib/gst/gstr1-3b-reconciliation` (API JSON). */

import type { ReconciliationUiInsights } from '@/lib/gst/gstr13b-client';

export type Gstr13bReconciliationMode = 'live_vs_live' | 'filed_vs_live' | 'filed_vs_filed';

export type ReconciliationExceptionType =
  | 'missing_invoice'
  | 'extra_invoice'
  | 'tax_mismatch'
  | 'date_mismatch'
  | 'cdn_mismatch';

export type ReconciliationException = {
  type: ReconciliationExceptionType;
  invoice_id?: string;
  document_id?: string;
  voucher_type?: 'invoice' | 'credit_note' | 'debit_note';
  difference?: number;
  details: string;
};

export type HeadCompare = {
  gstr1: number;
  gstr3b: number;
  difference: number;
  status: 'matched' | 'mismatch';
};

export type CategoryTaxBlock = {
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
};

export type CategoryCompare = {
  gstr1: CategoryTaxBlock;
  gstr3b: CategoryTaxBlock;
  difference: CategoryTaxBlock;
  note?: string;
};

export type InvoiceReconciliationRow = {
  voucher_key: string;
  voucher_type: 'invoice' | 'credit_note' | 'debit_note';
  document_id: string;
  status: 'matched' | 'missing_in_3b' | 'missing_in_1' | 'value_mismatch';
  gstr1: { igst: number; cgst: number; sgst: number; cess: number; taxable_value: number };
  ledger: { igst: number; cgst: number; sgst: number; cess: number };
  max_head_diff?: number;
};

export type Gstr13bReconciliationPayload = {
  status: 'matched' | 'mismatch';
  mode: Gstr13bReconciliationMode;
  gst_period: string;
  branch_id: string;
  meta: {
    gstr1_head_source: 'filed_snapshot' | 'live_generator';
    gstr3b_source: 'filed_snapshot' | 'live_generator';
    voucher_map_source: 'live_gstr1_generator';
    gstr1_snapshot_branch_id?: string;
    gstr1_filing_status?: string;
    gst_filing_status?: string;
  };
  head_wise: {
    igst: HeadCompare;
    cgst: HeadCompare;
    sgst: HeadCompare;
    cess: HeadCompare;
  };
  totals: { gstr1: number; gstr3b: number; difference: number };
  categories: {
    outward_taxable: CategoryCompare;
    zero_rated: CategoryCompare;
    exempt: CategoryCompare;
    nil_rated: CategoryCompare;
    inward_rcm: CategoryCompare;
    cdn_adjustments: CategoryCompare;
  };
  exceptions: ReconciliationException[];
  stats: {
    total_vouchers_compared: number;
    matched: number;
    mismatched: number;
    missing_in_ledger: number;
    missing_in_gstr1: number;
    b2cs_aggregated_rows: number;
  };
  vouchers: InvoiceReconciliationRow[];
  warnings: string[];
  /** Present when loaded via GET /api/reports/gst/reconciliation */
  insights?: ReconciliationUiInsights;
};

export type { ReconciliationUiInsights };
