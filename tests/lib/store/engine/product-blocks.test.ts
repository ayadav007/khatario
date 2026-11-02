import { buyButtonState, lowStockNote, pickPromptLabel, stickyBuyBarVisible, variantSizeLabel } from '@/components/store/engine/product/product-blocks';

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

describe('lowStockNote', () => {
  const sized = (stock: number, attributes: unknown = { Size: 'L' }) => ({
    current_stock: stock,
    variant_name: 'Black / L',
    attributes,
  });

  it('says only N left at or under the threshold', () => {
    expect(lowStockNote(sized(2), 3)).toBe('Only 2 left in L');
    expect(lowStockNote(sized(3), 3)).toBe('Only 3 left in L');
    expect(lowStockNote(sized(4), 3)).toBeNull();
    expect(lowStockNote(sized(0), 3)).toBeNull();
    expect(lowStockNote(sized(2), 0)).toBeNull();
    expect(lowStockNote({ current_stock: 2, variant_name: 'Red', attributes: { Colour: 'Red' } }, 3)).toBe('Only 2 left in Red');
  });

  it('finds the size under any key case or spacing, and falls back to the variant name', () => {
    expect(lowStockNote(sized(1, { ' SIZE ': ' XL ' }), 3)).toBe('Only 1 left in XL');
    expect(lowStockNote({ current_stock: 1, variant_name: 'Red', attributes: null }, 3)).toBe('Only 1 left in Red');
    expect(lowStockNote({ current_stock: 1, variant_name: 'Red', attributes: undefined }, 3)).toBe('Only 1 left in Red');
  });

  it('shows nothing without a variant', () => {
    expect(lowStockNote(null, 3)).toBeNull();
  });
});

describe('stickyBuyBarVisible', () => {
  it('shows the sticky bar only on phones when the buy buttons are out of view', () => {
    const bools = [false, true];
    let shown = 0;
    for (const enabled of bools)
      for (const phone of bools)
        for (const buyInView of bools)
          for (const hasProduct of bools) {
            const expected = enabled && phone && !buyInView && hasProduct;
            expect(stickyBuyBarVisible({ enabled, phone, buyInView, hasProduct })).toBe(expected);
            if (expected) shown += 1;
          }
    expect(shown).toBe(1);
    expect(stickyBuyBarVisible({ enabled: true, phone: true, buyInView: false, hasProduct: true })).toBe(true);
  });
});

describe('variantSizeLabel', () => {
  it('shows the size attribute, not the whole variant name', () => {
    expect(variantSizeLabel({ variant_name: 'Red / XL', attributes: { Colour: 'Red', Size: 'XL' } })).toBe('XL');
    expect(variantSizeLabel({ variant_name: 'Red / XL', attributes: { ' SIZE ': ' xl ' } })).toBe('xl');
  });

  it('falls back to the variant name when there is no size', () => {
    expect(variantSizeLabel({ variant_name: 'Red', attributes: { Colour: 'Red' } })).toBe('Red');
    expect(variantSizeLabel({ variant_name: ' Red ', attributes: null })).toBe('Red');
  });
});

describe('pickPromptLabel', () => {
  const variant = (id: string, attributes: unknown) => ({
    id,
    variant_name: id,
    selling_price: '100',
    current_stock: 3,
    attributes,
  });

  it('says Select size only when the variants have a size axis', () => {
    expect(pickPromptLabel([variant('a', { Size: 'S' }), variant('b', { Size: 'M' })])).toBe('Select size');
    expect(pickPromptLabel([variant('a', { Colour: 'Red', ' SIZE ': 'S' })])).toBe('Select size');
  });

  it('says Choose an option for colour-only or unnamed variants', () => {
    expect(pickPromptLabel([variant('a', { Colour: 'Red' }), variant('b', { Colour: 'Blue' })])).toBe('Choose an option');
    expect(pickPromptLabel([variant('a', null)])).toBe('Choose an option');
    expect(pickPromptLabel([])).toBe('Choose an option');
  });
});
