// Client-safe and pure. What a product card draws when a card design is active (spec §4 of
// docs/superpowers/specs/2026-11-01-store-product-cards-design.md). Theme's own never comes here: the tile keeps its old markup.
import type { StudioBadge } from '@/lib/store/studio-sections';
import { tileBadges } from './card-badges';
import { cardSchemeVars } from './color-schemes';
import { cardLookClasses, cardLookVars, nameAndPriceInRow, type CardLineId, type ProductCardSettings, type ResolvedCardLook } from './product-card';
import type { ColorScheme } from './types';

/** A card design is active: anything but Theme's own (and nothing off the engine). */
export function isDesignedCard(look: ResolvedCardLook | null | undefined): look is ResolvedCardLook {
  return !!look && look.design !== 'theme';
}

/** One block of the card's details: a line, or name and price sharing a row. */
export type CardUnit = CardLineId | 'name-price';

/** The lines that are on, in their order; name and price become one unit when they share a row. */
export function cardUnits(look: Pick<ProductCardSettings, 'lines' | 'name_price_row'>): CardUnit[] {
  const ids = look.lines.filter((l) => l.on).map((l) => l.id);
  if (!nameAndPriceInRow(look)) return ids;
  const out: CardUnit[] = [];
  for (const id of ids) {
    if (id === 'name') out.push('name-price');
    else if (id !== 'price') out.push(id);
  }
  return out;
}

export type CardDiscount = { kind: 'percent'; percent: number } | { kind: 'save'; amount: number };

/**
 * The discount beside the price: "20% off" (text and pill) or "Save ₹20". `off` is the tile's discount percent, already 0
 * when the store's offers are off; save needs an MRP above the price.
 */
export function cardDiscount(
  style: ProductCardSettings['discount_style'],
  price: number,
  mrp: number | null | undefined,
  off: number,
): CardDiscount | null {
  if (style === 'none' || !(off > 0)) return null;
  if (style === 'save') {
    const amount = Math.round((mrp ?? 0) - price);
    return amount > 0 ? { kind: 'save', amount } : null;
  }
  return { kind: 'percent', percent: off };
}

export interface CardRating {
  /** Five stars filled to `percent`. */
  stars: boolean;
  percent: number;
  /** The figure, e.g. "4.5" (number style). */
  number: string | null;
  /** The review count (count style). */
  count: number | null;
  label: string;
}

/** The rating line: absent without ratings, as today. */
export function cardRating(style: ProductCardSettings['rating_style'], rating: number, count: number): CardRating | null {
  if (!(count > 0 && rating > 0)) return null;
  return {
    stars: style !== 'number',
    percent: Math.round((Math.min(5, rating) / 5) * 100),
    number: style === 'number' ? rating.toFixed(1) : null,
    count: style === 'count' ? count : null,
    label: `Rated ${Math.round(rating * 10) / 10} out of 5, ${count} ${count === 1 ? 'review' : 'reviews'}`,
  };
}

/** The badges from the tile's list (a product's own badge first, as today): two pills, or one ribbon or corner. */
export function cardBadgeList(look: Pick<ResolvedCardLook, 'show_badges' | 'badge_shape'>, badges: StudioBadge[]): StudioBadge[] {
  if (!look.show_badges) return [];
  return badges.slice(0, look.badge_shape === 'pill' ? 2 : 1);
}

/**
 * The badges a designed card shows and whether the MRP is struck. The automatic "% OFF" badge is left out when the price
 * line already shows the discount (`discount`, the `cardDiscount` result: keyed on what is shown, so `save` without an
 * MRP keeps the badge). The strike follows `off` alone, as on today's tile.
 */
export function cardBadgeRow(
  look: Pick<ResolvedCardLook, 'show_badges' | 'badge_shape'>,
  input: { off: number; badges: StudioBadge[]; hideDiscountBadge?: boolean; discount: CardDiscount | null },
): { badges: StudioBadge[]; struck: boolean } {
  const { badges, struck } = tileBadges(input.off, input.badges, !!input.hideDiscountBadge || input.discount != null);
  return { badges: cardBadgeList(look, badges), struck };
}

/**
 * How an out-of-stock product shows. `label`: today's photo label and disabled button; `faded`: the card faded and no
 * button; `soldout_button`: a disabled "Sold out" button instead, or the label when the card shows no button (the store
 * hides listing buttons, `hasAdd` false; the buttons line is off; or the button style is none).
 */
export function cardOutOfStock(
  look: Pick<ProductCardSettings, 'oos_look' | 'lines' | 'button_style'>,
  outOfStock: boolean | undefined,
  hasAdd: boolean,
): { label: boolean; button: 'normal' | 'none' | 'soldout' } {
  if (!outOfStock) return { label: false, button: 'normal' };
  if (look.oos_look === 'faded') return { label: false, button: 'none' };
  const hasButton = hasAdd && look.button_style !== 'none' && look.lines.some((l) => l.id === 'buttons' && l.on);
  if (look.oos_look === 'soldout_button' && hasButton) return { label: false, button: 'soldout' };
  return { label: true, button: 'normal' };
}

/**
 * The card root of a designed card: `product pc-on`, the look's classes, `pc-box` (a card with a border, shadow or its
 * own scheme paints a box) or `pc-plain`, plus `hasAlt` and `pc-out`; the look's variables and its colour scheme's.
 */
export function designedCardRoot(
  look: ResolvedCardLook,
  schemes: readonly ColorScheme[],
  state: { outOfStock?: boolean; hasAlt: boolean },
): { className: string; style: Record<string, string> } {
  const boxed = look.border > 0 || look.shadow !== 'none' || !!look.color_scheme;
  const className = [
    'product',
    'pc-on',
    cardLookClasses(look),
    boxed ? 'pc-box' : 'pc-plain',
    state.hasAlt ? 'hasAlt' : '',
    state.outOfStock ? 'pc-out' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { className, style: { ...cardLookVars(look), ...cardSchemeVars(look.color_scheme, schemes) } };
}
