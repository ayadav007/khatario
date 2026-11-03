// Pure helpers for the `main-product` blocks (no React, no server code).
import { variantOptions, type StoreVariantInput } from '@/lib/store/variant-options';
import { packPriceShowsMrp } from '@/lib/store/engine/card-packs';

/** One block the server hands the client: settings over their defaults, richtext already sanitised. */
export interface ProductBlockProps {
  id: string;
  type: string;
  settings: Record<string, unknown>;
}

export type BuyButtonState = 'add' | 'stepper' | 'sold_out' | 'choose';

/**
 * What the buy button shows, with the same rules as the classic product page: the stepper once the
 * line is in the cart; sold out only when there is no stock and no option is still to be chosen;
 * otherwise "Add to cart" when the offer can be added, else "Choose an option".
 */
export function buyButtonState(input: {
  canAdd: boolean;
  stock: number;
  needsVariant: boolean;
  variantChosen: boolean;
  inCart: boolean;
  quantity: number;
}): BuyButtonState {
  if (input.inCart && input.quantity > 0) return 'stepper';
  if (input.stock <= 0 && (!input.needsVariant || input.variantChosen)) return 'sold_out';
  return input.canAdd ? 'add' : 'choose';
}

/**
 * The chosen variant's size for display: its `size` attribute (any key case or spacing), else its variant name
 * (a colour-only variant is named "Red"). Empty when it has neither.
 */
export function variantSizeLabel(variant: { variant_name: string; attributes?: unknown }): string {
  const axes = variantOptions([variant as StoreVariantInput]);
  const size = axes.find((a) => a.key === 'size')?.values[0]?.value;
  return size ?? String(variant.variant_name ?? '').trim();
}

/** The sticky bar's button text while no variant is chosen: "Select size" only when the variants have a size axis. */
export function pickPromptLabel(variants: StoreVariantInput[]): string {
  return variantOptions(variants).some((a) => a.key === 'size') ? 'Select size' : 'Choose an option';
}

/**
 * The "Only N left in <size>" note under the size buttons: when the chosen variant has stock but no more than `threshold`.
 * The size is the variant's `size` attribute, found the way the picker finds it (any key case or spacing); a variant with
 * no size (colour only, or just a name) is named by its variant name. A threshold of 0 hides the note.
 */
export function lowStockNote(
  variant: { current_stock: number; variant_name: string; attributes?: unknown } | null,
  threshold: number,
): string | null {
  if (!variant || !(threshold > 0)) return null;
  const stock = Number(variant.current_stock);
  if (!Number.isFinite(stock) || stock <= 0 || stock > threshold) return null;
  const name = variantSizeLabel(variant);
  return name ? `Only ${stock} left in ${name}` : `Only ${stock} left`;
}

/** The phone "Add to bag" bar: only when the merchant turned it on, on a phone, with a product, and the page's buy buttons are out of view. */
export function stickyBuyBarVisible(input: {
  enabled: boolean;
  phone: boolean;
  buyInView: boolean;
  hasProduct: boolean;
}): boolean {
  return input.enabled && input.phone && input.hasProduct && !input.buyInView;
}

/**
 * "You save ₹N": the MRP less the price, only when the price on show is the product's own (the MRP belongs to it, not to a
 * pack at another price) and the MRP is above it. Null otherwise.
 */
export function youSave(price: number, productPrice: number, mrp: number | null): number | null {
  if (mrp == null || !packPriceShowsMrp(price, productPrice) || !(mrp > price)) return null;
  const saved = Math.round((mrp - price) * 100) / 100;
  return saved > 0 ? saved : null;
}

/** The struck MRP and "% off" show only when the MRP is above the price on show and that price is the product's own (not another pack's). */
export function showsMrp(price: number, productPrice: number, mrp: number | null): boolean {
  return mrp != null && mrp > price && packPriceShowsMrp(price, productPrice);
}
