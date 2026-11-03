// Client-safe and pure. "₹60/kg" or "₹90/L" from a pack label such as "500 g" or "4 × 100 g". It answers only when the
// label is plainly a weight or a volume: a wrong per-unit price is worse than none, so anything else gives null.

const NUM = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
/** Weight and volume units, longest first so "kgs" is not read as "kg" followed by "s". */
const UNIT = String.raw`(?:kilograms?|kilos?|kgs?|grams?|gms?|g|millilitres?|milliliters?|mls?|litres?|liters?|ltrs?|lt|l)`;
const TIMES = String.raw`\s*[x×*]\s*`;
const COUNT = String.raw`\d+`;
const pack = (tail: string) => String.raw`(?:(${COUNT})${TIMES})?(${NUM})\s*(${UNIT})(?![a-z])(?:${TIMES}(${COUNT})(?!\d|\.\d)${tail})?`;

const WHOLE = new RegExp(`^${pack('')}$`, 'i');
/** Words that count what a "× N" multiplier counts: the multiplier is the pack size only when nothing else follows it. */
const COUNTABLE = String.raw`(?:pcs?|pieces?|bottles?|packets?|sachets?|cans?|cups?)`;
const TAIL = String.raw`(?=[\s)\].,;]*$|\s+${COUNTABLE}\b)`;
/** A number that starts a pack: not part of a longer number, a decimal or a word ("B12 g"). */
const IN_NAME = new RegExp(String.raw`(?<![\w.])${pack(TAIL)}`, 'gi');
const LEFTOVER_TIMES = new RegExp(String.raw`^${TIMES}\d`);
const NUMBER_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;
/**
 * A name that sells several of something, a bundle or a deal: the weight in it may not be the whole pack. "Pack of 1 kg"
 * is fine; "pack of 3", "pack of two", "6 pack", "3 pcs", "combo", "free" and "buy 1 get 1" are not.
 */
const BUNDLE = new RegExp(
  [
    String.raw`\b(?:pack|set|box|pair)\s+of\s+(?!\d+(?:\.\d+)?\s*${UNIT}(?![a-z]))[a-z0-9]`,
    String.raw`\b\d+\s*(?:packs?|pcs?|pieces?|nos|units)\b`,
    String.raw`\b${NUMBER_WORD}\s*packs?\b`,
    String.raw`\b(?:combo|bundle|free)\b`,
    String.raw`\bbuy\s+(?:\d+|${NUMBER_WORD})\s+get\b`,
  ].join('|'),
  'i',
);

function plain(n: number): string {
  return n.toLocaleString('en-IN');
}

/** Whole rupees from ₹10 up, one decimal below, with no trailing ".0". */
function formatRate(n: number): string {
  return plain(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
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
  const shown = formatRate(rate);
  if (shown === '0') return null;
  return `₹${shown}/${volume ? 'L' : 'kg'}`;
}

/**
 * The weight or volume in a product name ("Tomatoes, 1 kg" gives "1 kg"), for products that have no pack options. Null
 * when the name has none, more than one ("1 kg & 500 g", "1L + 200 ml free"), says it is a bundle or a deal ("pack of 3",
 * "6 pack", "combo", "buy 1 get 1") or has a "× N" that is not a count of the pack ("5 kg x 12 months"): the weight then
 * is not the whole pack.
 */
export function packLabelFromName(name: string): string | null {
  if (typeof name !== 'string' || BUNDLE.test(name)) return null;
  const found = [...name.matchAll(IN_NAME)];
  if (found.length !== 1) return null;
  const [m] = found;
  // A multiplier the pattern did not take ("x 12 months") means the weight is not the pack.
  if (LEFTOVER_TIMES.test(name.slice((m.index ?? 0) + m[0].length))) return null;
  return m[0].trim();
}
