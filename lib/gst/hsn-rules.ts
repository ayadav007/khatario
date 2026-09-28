/**
 * Notification 78/2020-CT (from 1 April 2021):
 *  - aggregate turnover up to Rs 5 crore: 4-digit HSN on B2B invoices, optional on B2C;
 *  - above Rs 5 crore: 6-digit HSN on every invoice.
 * SAC codes (99xxxx) follow the same digit count.
 */
export interface HsnRuleInput {
  hsn: string | null | undefined;
  isB2B: boolean;
  turnoverAbove5Cr: boolean;
}

export function requiredHsnDigits(isB2B: boolean, turnoverAbove5Cr: boolean): number {
  if (turnoverAbove5Cr) return 6;
  return isB2B ? 4 : 0;
}

export function hsnRuleError({ hsn, isB2B, turnoverAbove5Cr }: HsnRuleInput): string | null {
  const code = String(hsn ?? '').replace(/\s/g, '');
  const need = requiredHsnDigits(isB2B, turnoverAbove5Cr);
  if (!code) {
    return need > 0 ? `HSN/SAC with at least ${need} digits is required` : null;
  }
  if (!/^\d+$/.test(code)) return 'HSN/SAC must contain digits only';
  if (code.length > 8) return 'HSN/SAC cannot exceed 8 digits';
  if (need > 0 && code.length < need) {
    return `HSN/SAC ${code} needs at least ${need} digits${turnoverAbove5Cr ? ' (turnover above Rs 5 crore)' : ' on B2B invoices'}`;
  }
  return null;
}
