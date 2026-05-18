import { roundExclusiveUnitPrice } from '@/lib/numeric-precision';

/**
 * Purchase form: line total incl. GST =
 * qty * unit_price * (1 - discount%/100) * (1 + tax%/100)
 */
export function inclusiveLineTotal(
  quantity: number,
  unitPrice: number,
  discountPercent: number,
  taxRatePercent: number
): number {
  if (quantity <= 0) return 0;
  const d = Math.max(0, discountPercent) / 100;
  const t = Math.max(0, taxRatePercent) / 100;
  if (unitPrice < 0 && taxRatePercent <= 0) {
    return quantity * unitPrice * (1 - d);
  }
  if (unitPrice < 0) return 0;
  return quantity * unitPrice * (1 - d) * (1 + t);
}

/** Line total incl. GST when discount is a fixed rupee amount (not %). */
export function inclusiveLineTotalWithDiscountAmount(
  quantity: number,
  unitPrice: number,
  discountAmount: number,
  taxRatePercent: number,
  /** When true, subtract discount from tax-inclusive line value first (MRP / e‑commerce bills). */
  discountOffTaxInclusive = false
): number {
  if (quantity <= 0) return 0;
  const gross = quantity * unitPrice;
  const da = Math.max(0, discountAmount);
  const t = Math.max(0, taxRatePercent) / 100;
  if (unitPrice < 0 && taxRatePercent <= 0) {
    return quantity * unitPrice;
  }
  if (unitPrice < 0) return 0;
  if (discountOffTaxInclusive && da > 0 && t > 0) {
    const inclusiveList = gross * (1 + t);
    return Math.max(0, inclusiveList - da);
  }
  const taxable = Math.max(0, gross - da);
  return taxable * (1 + t);
}

/** Derive pre-discount unit price when line `amount` is tax-inclusive and discount is rupees. */
export function unitPriceFromInclusiveDiscountAmount(
  inclusiveAmount: number,
  quantity: number,
  discountAmount: number,
  taxRatePercent: number
): number {
  if (!inclusiveAmount || inclusiveAmount <= 0 || !quantity || quantity <= 0) return 0;
  const t = Math.max(0, taxRatePercent) / 100;
  const taxable = inclusiveAmount / (1 + t);
  return (taxable + Math.max(0, discountAmount)) / quantity;
}

/** Derive pre-discount unit price when line `amount` is tax-inclusive (what you pay incl. GST). */
export function unitPriceFromInclusiveLine(
  inclusiveAmount: number,
  quantity: number,
  discountPercent: number,
  taxRatePercent: number
): number {
  if (!inclusiveAmount || inclusiveAmount <= 0 || !quantity || quantity <= 0) return 0;
  const d = Math.max(0, discountPercent) / 100;
  const t = Math.max(0, taxRatePercent) / 100;
  const denom = quantity * (1 - d) * (1 + t);
  if (denom <= 0) return 0;
  return inclusiveAmount / denom;
}

/** When line `amount` is taxable (before GST) only. */
export function unitPriceFromTaxableLineAmount(
  taxableLineAmount: number,
  quantity: number,
  discountPercent: number
): number {
  if (!taxableLineAmount || taxableLineAmount <= 0 || !quantity || quantity <= 0) return 0;
  const d = Math.max(0, discountPercent) / 100;
  const denom = quantity * (1 - d);
  if (denom <= 0) return 0;
  return taxableLineAmount / denom;
}

/**
 * Many invoices put **taxable** value in the Amount column; others put **inclusive**.
 * Compare `amountRaw` to what the extracted list rate implies for taxable vs inclusive.
 */
export function deriveUnitPriceFromInvoiceLine(
  amountRaw: number,
  quantity: number,
  discountPercent: number,
  taxRatePercent: number,
  unitPriceRaw: number
): number {
  if (!amountRaw || amountRaw <= 0 || !quantity || quantity <= 0) {
    return unitPriceRaw > 0 ? roundExclusiveUnitPrice(unitPriceRaw) : 0;
  }

  const d = Math.max(0, discountPercent) / 100;
  const t = Math.max(0, taxRatePercent) / 100;
  const qty = quantity;
  const tol = Math.max(0.5, amountRaw * 0.015);

  const up = Math.max(0, unitPriceRaw);
  const taxableAtList = qty * up * (1 - d);
  const inclusiveAtList = taxableAtList * (1 + t);
  const inclusiveIfRateIsInclusive = qty * up * (1 - d);

  // If OCR rate is already tax-inclusive, convert it to exclusive for the purchase form.
  if (up > 0 && t > 0 && Math.abs(inclusiveIfRateIsInclusive - amountRaw) <= tol) {
    return roundExclusiveUnitPrice(unitPriceRaw / (1 + t));
  }

  if (up > 0 && Math.abs(inclusiveAtList - amountRaw) <= tol) {
    return roundExclusiveUnitPrice(unitPriceRaw);
  }
  if (up > 0 && Math.abs(taxableAtList - amountRaw) <= tol) {
    return roundExclusiveUnitPrice(unitPriceRaw);
  }

  const distTax = Math.abs(taxableAtList - amountRaw);
  const distInc = Math.abs(inclusiveAtList - amountRaw);

  if (distTax < distInc - 0.01) {
    return roundExclusiveUnitPrice(unitPriceFromTaxableLineAmount(amountRaw, qty, discountPercent));
  }

  return roundExclusiveUnitPrice(
    unitPriceFromInclusiveLine(amountRaw, qty, discountPercent, taxRatePercent),
  );
}
