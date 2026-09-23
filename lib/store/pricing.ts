export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineAmounts(input: {
  unitPrice: number;
  quantity: number;
  taxRate: number;
  gstIncluded: boolean;
}): { lineTotal: number; tax: number; taxable: number } {
  const qty = Math.max(0, input.quantity);
  const rate = Math.max(0, input.taxRate);
  const gross = roundMoney(input.unitPrice * qty);
  if (gross <= 0) return { lineTotal: 0, tax: 0, taxable: 0 };
  if (input.gstIncluded) {
    const tax = roundMoney(gross * (rate / (100 + rate)));
    return { lineTotal: gross, tax, taxable: roundMoney(gross - tax) };
  }
  const tax = roundMoney(gross * (rate / 100));
  return { lineTotal: roundMoney(gross + tax), tax, taxable: gross };
}

export function applyCouponDiscount(input: {
  subtotal: number;
  discountType: 'percent' | 'flat';
  discountValue: number;
  minOrderAmount: number;
}): { ok: boolean; discount: number; error?: string } {
  if (input.subtotal < input.minOrderAmount) {
    return {
      ok: false,
      discount: 0,
      error: `Minimum order for this coupon is ₹${input.minOrderAmount}`,
    };
  }
  let discount =
    input.discountType === 'percent'
      ? roundMoney(input.subtotal * (input.discountValue / 100))
      : roundMoney(input.discountValue);
  if (discount > input.subtotal) discount = input.subtotal;
  if (discount < 0) discount = 0;
  return { ok: true, discount };
}
