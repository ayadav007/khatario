// Pure helpers for the `main-product` blocks (no React, no server code).

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
