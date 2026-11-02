// Pure helpers for the `main-product` blocks (no React, no server code).
import { variantOptions, type StoreVariantInput } from '@/lib/store/variant-options';

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
  const axes = variantOptions([variant as StoreVariantInput]);
  const size = axes.find((a) => a.key === 'size')?.values[0]?.value;
  const name = size ?? String(variant.variant_name ?? '').trim();
  return name ? `Only ${stock} left in ${name}` : `Only ${stock} left`;
}
