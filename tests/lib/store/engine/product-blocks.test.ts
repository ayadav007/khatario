import { buyButtonState } from '@/components/store/engine/product/product-blocks';

const base = { canAdd: true, stock: 5, needsVariant: false, variantChosen: false, inCart: false, quantity: 0 };

describe('main-product renders not-found and sold-out states (buyButtonState)', () => {
  it('adds a plain item in stock', () => {
    expect(buyButtonState(base)).toBe('add');
  });

  it('shows the stepper once the line is in the cart', () => {
    expect(buyButtonState({ ...base, inCart: true, quantity: 2 })).toBe('stepper');
    // An in-cart flag without a quantity is not a stepper.
    expect(buyButtonState({ ...base, inCart: true, quantity: 0 })).toBe('add');
  });

  it('is sold out for a plain item with no stock', () => {
    expect(buyButtonState({ ...base, canAdd: false, stock: 0 })).toBe('sold_out');
  });

  it('asks to choose while a variant is needed and none is chosen, even with no stock', () => {
    expect(buyButtonState({ ...base, canAdd: false, stock: 0, needsVariant: true })).toBe('choose');
  });

  it('is sold out only once the chosen variant has no stock', () => {
    expect(buyButtonState({ ...base, canAdd: false, stock: 0, needsVariant: true, variantChosen: true })).toBe('sold_out');
    expect(buyButtonState({ ...base, canAdd: true, stock: 3, needsVariant: true, variantChosen: true })).toBe('add');
  });
});
