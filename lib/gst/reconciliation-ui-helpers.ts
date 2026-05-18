import type {
  InvoiceReconciliationRow,
  ReconciliationException,
} from '@/lib/gst/gstr1-3b-reconciliation';

/** User-facing reason for voucher row (CA clarity). */
export function voucherMismatchReason(
  row: InvoiceReconciliationRow,
  exceptions: ReconciliationException[]
): string {
  const id = row.document_id;
  const forDoc = exceptions.filter((e) => e.invoice_id === id || e.document_id === id);
  const types = new Set(forDoc.map((e) => e.type));

  if (types.has('date_mismatch')) return 'Date mismatch';
  if (types.has('cdn_mismatch')) return 'CDN mismatch';
  if (row.status === 'missing_in_3b') return 'Missing in 3B';
  if (row.status === 'missing_in_1') return 'Missing in GSTR-1';
  if (row.status === 'value_mismatch') return 'Tax mismatch';
  if (types.has('tax_mismatch')) return 'Tax mismatch';
  if (types.has('missing_invoice')) return 'Missing in 3B';
  if (types.has('extra_invoice')) return 'Missing in GSTR-1';
  if (row.status === 'matched') return '—';
  return 'Review';
}
