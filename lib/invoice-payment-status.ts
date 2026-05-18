/** Rupee/paise tolerance for DECIMAL and floating-point noise */
const INR_EPS = 0.01;

export type InvoicePaymentStatus = 'unpaid' | 'partially_paid' | 'paid';

/**
 * Derive payment status from invoice money columns. Prefer `balance_amount` when
 * present so it stays consistent with DB; otherwise use grand − paid.
 */
export function deriveInvoicePaymentStatus(
  grandTotal: number | string | null | undefined,
  paidAmount: number | string | null | undefined,
  balanceAmount?: number | string | null | undefined
): InvoicePaymentStatus {
  const grand = Number(grandTotal) || 0;
  const paid = Number(paidAmount) || 0;
  const balanceDue =
    balanceAmount != null && balanceAmount !== ''
      ? Number(balanceAmount)
      : grand - paid;
  const due = Number.isFinite(balanceDue) ? balanceDue : grand - paid;

  if (paid <= INR_EPS) return 'unpaid';
  if (due <= INR_EPS) return 'paid';
  return 'partially_paid';
}
