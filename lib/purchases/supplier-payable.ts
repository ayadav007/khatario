/**
 * Amount actually owed to the supplier for a bill. Under reverse charge (s.9(3)/9(4)) the
 * recipient pays the GST to the government, so the supplier is owed the bill value less tax.
 */
export function supplierPayableAmount(
  grandTotal: number | string | null | undefined,
  taxTotal: number | string | null | undefined,
  isReverseCharge: boolean | null | undefined
): number {
  const grand = Number(grandTotal) || 0;
  if (!isReverseCharge) return grand;
  return Math.max(0, Math.round((grand - (Number(taxTotal) || 0)) * 100) / 100);
}
