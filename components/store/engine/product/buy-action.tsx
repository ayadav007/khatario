'use client';

import type { CSSProperties } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useEngineProduct } from './EngineProductContext';
import { buyButtonState } from './product-blocks';

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// Buttons follow the section's colour scheme (button / button text), else the store's primary colour.
export const BTN: CSSProperties = {
  background: 'var(--c-btn, var(--primary))',
  color: 'var(--c-btn-text, var(--on-primary, #fff))',
  borderRadius: 'var(--btn-radius, 10px)',
};

/**
 * What the buy buttons need from the product page, shared by the Buy buttons block and the phone Add to bag bar:
 * the button state (`buyButtonState`) and the cart line's quantity, with the page's add and quantity actions.
 * Null until the product is loaded.
 */
export function useBuyState() {
  const { product, offer, needsVariant, variant, cartItem, add, setQuantity } = useEngineProduct();
  if (!product || !offer) return null;
  const quantity = cartItem?.quantity ?? 0;
  const state = buyButtonState({
    canAdd: offer.canAdd,
    stock: offer.stock,
    needsVariant,
    variantChosen: variant != null,
    inCart: !!cartItem,
    quantity,
  });
  return { product, offer, needsVariant, variant, state, quantity, add, setQuantity };
}

/** The quantity stepper shown once the line is in the cart. */
export function BuyStepper({ quantity, stock, onChange }: { quantity: number; stock: number; onChange: (q: number) => void }) {
  return (
    <div className="inline-flex min-h-12 items-center" style={BTN}>
      <button
        type="button"
        className="flex h-12 w-12 items-center justify-center"
        aria-label="Decrease quantity"
        onClick={() => onChange(quantity - 1)}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-[2rem] text-center font-medium tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        className="flex h-12 w-12 items-center justify-center disabled:opacity-40"
        aria-label="Increase quantity"
        disabled={quantity >= stock}
        onClick={() => onChange(quantity + 1)}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
