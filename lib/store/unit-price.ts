// Client-safe and pure. "₹60/kg" or "₹90/L" from a pack label such as "500 g" or "4 × 100 g". It answers only when the
// label is plainly a weight or a volume: a wrong per-unit price is worse than none, so anything else gives null.

const NUM = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
/** Weight and volume units, longest first so "kgs" is not read as "kg" followed by "s". */
const UNIT = String.raw`(?:kilograms?|kilos?|kgs?|grams?|gms?|g|millilitres?|milliliters?|mls?|litres?|liters?|ltrs?|lt|l)`;
const TIMES = String.raw`\s*[x×*]\s*`;
const COUNT = String.raw`\d+`;
const PACK = String.raw`(?:(${COUNT})${TIMES})?(${NUM})\s*(${UNIT})(?![a-z])(?:${TIMES}(${COUNT})(?!\d|\.\d))?`;

const WHOLE = new RegExp(`^${PACK}$`, 'i');
/** A number that starts a pack: not part of a longer number, a decimal or a word ("B12 g"). */
const IN_NAME = new RegExp(String.raw`(?<![\w.])${PACK}`, 'gi');
/** A name that sells several of something or a bundle: the weight in it may not be the whole pack. */
const BUNDLE = new RegExp(
  String.raw`\b(?:pack|set|combo|bundle|box|pair)\s+of\s+\d+(?!\d|\.\d)(?!\s*${UNIT}(?![a-z]))|\b(?:combo|bundle)\b`,
  'i',
);

function plain(n: number): string {
  return n.toLocaleString('en-IN');
}

/** Whole rupees from ₹10 up, one decimal below, with no trailing ".0". */
function formatRate(n: number): string {
  if (n >= 10) return plain(Math.round(n));
  return plain(Math.round(n * 10) / 10);
}

/**
 * The price for one kilo or one litre, e.g. `unitPrice('500 g', 30)` is "₹60/kg" and `unitPrice('200ml', 18)` is "₹90/L".
 * A pack may be several of one size ("4 × 100 g", "500g x 2"). Anything that is not a plain weight or volume
 * ("Pack of 2", "6 pcs", "2 × 6 pcs", "1 dozen") gives null, as does a price that is not above zero.
 */
export function unitPrice(label: string | null | undefined, price: number): string | null {
  if (typeof label !== 'string' || !Number.isFinite(price) || !(price > 0)) return null;
  const m = WHOLE.exec(label.trim());
  if (!m) return null;
  const count = Number(m[1] ?? 1) * Number(m[4] ?? 1);
  const amount = Number(m[2]);
  if (!(count > 0) || !(amount > 0)) return null;
  const unit = m[3].toLowerCase();
  const volume = /^(?:m?l|lt|ltrs?|lit|milli)/.test(unit);
  // Grams and millilitres are a thousandth of the kilo or litre.
  const thousandth = /^(?:g|gms?|grams?|mls?|milli)/.test(unit);
  const base = count * amount * (thousandth ? 0.001 : 1);
  const rate = price / base;
  if (!Number.isFinite(rate)) return null;
  return `₹${formatRate(rate)}/${volume ? 'L' : 'kg'}`;
}

/**
 * The last weight or volume in a product name ("Tomatoes, 1 kg" gives "1 kg"), for products that have no pack options.
 * Null when the name has none, or says it is a bundle ("Pack of 3", "combo"): the weight then may not be the whole pack.
 */
export function packLabelFromName(name: string): string | null {
  if (typeof name !== 'string' || BUNDLE.test(name)) return null;
  let last: string | null = null;
  for (const m of name.matchAll(IN_NAME)) last = m[0].trim();
  return last;
}
