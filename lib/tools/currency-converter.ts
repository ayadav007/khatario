/**
 * Approximate rupees for one unit of each currency (fallback table; no live feed yet).
 * The rate from A to B is (rupees per A) / (rupees per B), so INR -> USD is 1/83.
 */
export const RUPEES_PER_UNIT: Record<string, number> = {
  INR: 1,
  USD: 83.0,
  EUR: 90.0,
  GBP: 105.0,
  AED: 22.6,
  SAR: 22.1,
  JPY: 0.56,
  CNY: 11.5,
  AUD: 54.0,
  CAD: 61.0,
  SGD: 61.5,
  CHF: 92.0,
};

/** Units of `to` for one unit of `from`. Unknown codes count as one rupee. */
export function exchangeRate(from: string, to: string): number {
  if (from === to) return 1;
  return (RUPEES_PER_UNIT[from] ?? 1) / (RUPEES_PER_UNIT[to] ?? 1);
}

export function convertAmount(amount: number, from: string, to: string): number {
  return amount * exchangeRate(from, to);
}
