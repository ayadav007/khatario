/**
 * Rupees for one unit of each currency, from the reference rates the Reserve Bank of India
 * shows on its home page (source: FBIL), "As at 1.00pm of November 12, 2026".
 * RBI quotes yen per 100 (INR / 100 JPY = 58.6600), so one yen is 0.5866 rupees.
 * Only currencies with an official reference rate are listed.
 * The rate from A to B is (rupees per A) / (rupees per B).
 */
export const RUPEES_PER_UNIT: Record<string, number> = {
  INR: 1,
  USD: 93.765,
  EUR: 103.8419,
  GBP: 124.2808,
  JPY: 0.5866,
  AED: 25.5288,
};

/** Date of the reference rates above (YYYY-MM-DD). */
export const CURRENCY_RATES_AS_OF = '2026-11-12';

/** The official page the rates were read from. */
export const CURRENCY_RATES_SOURCE = 'https://www.rbi.org.in/';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-11-12" -> "12 November 2026". */
export function formatRatesDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Units of `to` for one unit of `from`. Unknown codes count as one rupee. */
export function exchangeRate(from: string, to: string): number {
  if (from === to) return 1;
  return (RUPEES_PER_UNIT[from] ?? 1) / (RUPEES_PER_UNIT[to] ?? 1);
}

export function convertAmount(amount: number, from: string, to: string): number {
  return amount * exchangeRate(from, to);
}
