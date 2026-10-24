const EMOJI_RULES: Array<[RegExp, string]> = [
  [/fruit|apple|banana|mango/i, '🍎'],
  [/veg|greens|sabzi|salad|spinach/i, '🥬'],
  [/egg/i, '🥚'],
  [/dairy|milk|paneer|curd|cheese|butter|yog/i, '🥛'],
  [/bak|bread|cake|bun/i, '🍞'],
  [/snack|chip|namkeen|biscuit|cookie/i, '🍪'],
  [/tea|coffee/i, '☕'],
  [/juice|beverage|drink|soda|water/i, '🥤'],
  [/sweet|chocolate|candy|mithai/i, '🍫'],
  [/rice|atta|flour|grain|staple|dal|pulse|cereal/i, '🌾'],
  [/oil|ghee/i, '🫒'],
  [/spice|masala|salt|chilli/i, '🌶️'],
  [/meat|chicken|mutton/i, '🍗'],
  [/fish|sea ?food|prawn/i, '🐟'],
  [/frozen|ice ?cream/i, '🍦'],
  [/baby|kid/i, '🍼'],
  [/pet/i, '🐾'],
  [/personal|care|beauty|soap|shampoo|hygiene/i, '🧴'],
  [/clean|household|home|detergent/i, '🧽'],
  [/dry ?fruit|nut|almond|cashew/i, '🥜'],
];

/** Emoji stand-in for a category tile when the merchant has not uploaded a category photo. */
export function groceryCategoryEmoji(name: string): string {
  for (const [re, emoji] of EMOJI_RULES) {
    if (re.test(name)) return emoji;
  }
  return '🛒';
}

/** Announcement text split on `·`, `|` or `•` into marquee items. */
export function marqueeItems(text: string): string[] {
  const parts = text
    .split(/\s*[·|•]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : text.trim() ? [text.trim()] : [];
}
